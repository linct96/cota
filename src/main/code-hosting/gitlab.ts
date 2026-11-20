import { z } from 'zod'
import type { HostingAdapter, ReviewScope } from './adapter'
import { reviewUrl } from './adapter'
import { hostingRequest } from './cli-runner'
import type { HostingRequest } from './cli-runner'
import type {
  CreateHostedReview,
  HostedPipeline,
  HostedReview,
  HostingBranch,
  HostingCheckState,
  HostingComparison,
  HostingRepository,
} from '../../shared/code-hosting'

const mergeSchema = z.object({
  iid: z.number().int().positive(),
  title: z.string(),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  state: z.enum(['opened', 'locked', 'merged', 'closed']),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullable(),
  author: z
    .object({ username: z.string().trim().min(1) })
    .nullish()
    .catch(undefined),
  closed_at: z.string().nullable(),
  source_project_id: z.number().nullable(),
  target_project_id: z.number(),
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string().nullable(),
  merge_commit_sha: z.string().nullish(),
  squash_commit_sha: z.string().nullish(),
})
const pipelineSchema = z.object({
  iid: z.number().int().positive().optional(),
  project_id: z.number().int().positive().optional(),
  sha: z.string(),
  ref: z.string().optional(),
  source: z.string().optional(),
  status: z.string().min(1),
  created_at: z.string().optional(),
})
const pipelineCheckStates = new Map<string, HostingCheckState>([
  ['success', 'success'],
  ['skipped', 'success'],
  ['failed', 'failure'],
  ['canceled', 'failure'],
  ['running', 'running'],
  ['created', 'pending'],
  ['pending', 'pending'],
  ['preparing', 'pending'],
  ['waiting_for_resource', 'pending'],
  ['scheduled', 'pending'],
  ['manual', 'pending'],
])
const pipelineStagesSchema = z.object({
  data: z.object({
    project: z.object({
      pipeline: z.object({
        stages: z.object({
          nodes: z.array(z.object({ name: z.string().min(1), status: z.string().min(1) })),
          pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        }),
      }),
    }),
  }),
})
const pipelineStagesQuery = `query($path: ID!, $iid: ID!, $after: String) {
  project(fullPath: $path) {
    pipeline(iid: $iid) {
      stages(first: 100, after: $after) {
        nodes { name status }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`
const endpoint = (repository: HostingRepository) =>
  `projects/${encodeURIComponent(repository.path)}`
function review(scope: ReviewScope, merge: z.infer<typeof mergeSchema>): HostedReview {
  if (
    merge.source_project_id !== scope.sourceInfo.id ||
    merge.target_project_id !== scope.targetInfo.id ||
    merge.source_branch !== scope.branch
  )
    throw new Error('MR 的来源项目或分支与所选来源不匹配。')
  return {
    number: merge.iid,
    title: merge.title,
    draft: merge.draft || merge.work_in_progress || false,
    state: merge.state === 'merged' ? 'merged' : merge.state === 'closed' ? 'closed' : 'open',
    sourceBranch: merge.source_branch,
    targetBranch: merge.target_branch,
    head: merge.sha || '',
    mergedHead: merge.merge_commit_sha || merge.squash_commit_sha || undefined,
    url: reviewUrl(scope.target, merge.iid),
    checks: 'unknown',
    createdAt: merge.created_at,
    updatedAt: merge.updated_at,
    mergedAt: merge.merged_at,
    authorUsername: merge.author?.username,
    closedAt: merge.closed_at,
  }
}
export class GitLabAdapter implements HostingAdapter {
  constructor(private readonly request: HostingRequest = hostingRequest) {}
  async account(repository: HostingRepository) {
    return z.object({ username: z.string().min(1) }).parse(await this.request(repository, 'user'))
      .username
  }
  async repository(repository: HostingRepository) {
    const data = z
      .object({
        id: z.number().int().positive(),
        path_with_namespace: z.string(),
        default_branch: z.string().nullable(),
      })
      .parse(await this.request(repository, endpoint(repository)))
    if (data.path_with_namespace !== repository.path)
      throw new Error('项目已改名或发生重定向，请在终端更新 Git 远端地址。')
    return { id: data.id, path: data.path_with_namespace, defaultBranch: data.default_branch || '' }
  }
  async branches(repository: HostingRepository): Promise<HostingBranch[]> {
    const branches: HostingBranch[] = []
    for (let page = 1; page <= 100; page++) {
      const data = z
        .array(
          z.object({
            name: z.string().min(1),
            commit: z.object({ committed_date: z.string().nullable().optional() }),
          }),
        )
        .parse(
          await this.request(
            repository,
            `${endpoint(repository)}/repository/branches?per_page=100&page=${page}`,
          ),
        )
      branches.push(
        ...data.map((branch) => ({
          name: branch.name,
          date: branch.commit.committed_date ?? undefined,
        })),
      )
      if (data.length < 100) return branches
    }
    throw new Error('远端分支超过读取上限，请在平台网页创建 MR。')
  }
  async listOpen(scope: ReviewScope) {
    const data = z
      .array(mergeSchema)
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/merge_requests?state=opened&scope=all&per_page=100&source_branch=${encodeURIComponent(scope.branch)}`,
        ),
      )
    if (data.length >= 100) throw new Error('关联 MR 过多，请在网页中确认。')
    const matches = data.filter(
      (merge) =>
        merge.source_project_id === scope.sourceInfo.id &&
        merge.target_project_id === scope.targetInfo.id &&
        merge.source_branch === scope.branch,
    )
    return matches.map((merge) => review(scope, merge))
  }
  async history(scope: ReviewScope, page: number) {
    const data = z
      .array(mergeSchema)
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/merge_requests?state=all&scope=all&order_by=created_at&sort=desc&per_page=20&page=${page}&source_branch=${encodeURIComponent(scope.branch)}`,
        ),
      )
    return {
      items: data
        .filter(
          (merge) =>
            merge.source_project_id === scope.sourceInfo.id &&
            merge.target_project_id === scope.targetInfo.id &&
            merge.source_branch === scope.branch,
        )
        .map((merge) => review(scope, merge)),
      nextPage: data.length === 20 ? page + 1 : null,
      fetchedAt: Date.now(),
    }
  }
  async get(scope: ReviewScope, number: number) {
    return review(
      scope,
      mergeSchema.parse(
        await this.request(scope.target, `${endpoint(scope.target)}/merge_requests/${number}`),
      ),
    )
  }
  async merge(scope: ReviewScope, current: HostedReview): Promise<HostedReview> {
    return review(
      scope,
      mergeSchema.parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/merge_requests/${current.number}/merge`,
          { sha: current.head, squash: false, should_remove_source_branch: false },
          'PUT',
        ),
      ),
    )
  }
  async compare(
    scope: ReviewScope,
    sourceHead: string,
    targetHead: string,
  ): Promise<HostingComparison> {
    const data = z
      .object({
        compare_timeout: z.boolean().optional(),
        commits: z.array(
          z.object({
            title: z.string(),
            message: z.string(),
            author_email: z.string(),
            authored_date: z.iso.datetime({ offset: true }),
          }),
        ),
        diffs: z.array(
          z.object({
            diff: z.string(),
            collapsed: z.boolean().optional(),
            too_large: z.boolean().optional(),
          }),
        ),
      })
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/repository/compare?from=${encodeURIComponent(targetHead)}&to=${encodeURIComponent(sourceHead)}&straight=false`,
        ),
      )
    if (data.compare_timeout || data.diffs.some((diff) => diff.too_large || diff.collapsed))
      return { status: 'unknown' }
    let commit = data.commits.length === 1 ? data.commits[0] : undefined
    if (data.commits.length > 1) {
      const [userData, emailData] = await Promise.all([
        this.request(scope.source, 'user'),
        this.request(scope.source, 'user/emails'),
      ])
      const user = z
        .object({
          username: z.string().min(1),
          email: z.string().nullable().optional(),
          public_email: z.string().nullable().optional(),
          commit_email: z.string().nullable().optional(),
        })
        .parse(userData)
      const addresses = z
        .array(z.object({ email: z.string(), confirmed_at: z.string().nullable() }))
        .parse(emailData)
      const emails = new Set(
        [
          user.email,
          user.public_email,
          user.commit_email,
          ...addresses.filter((address) => address.confirmed_at).map((address) => address.email),
        ].flatMap((email) => (email ? [email.trim().toLowerCase()] : [])),
      )
      commit = data.commits
        .filter((candidateCommit) => emails.has(candidateCommit.author_email.trim().toLowerCase()))
        .sort((a, b) => Date.parse(a.authored_date) - Date.parse(b.authored_date))[0]
    }
    let defaultTitle = commit?.title
    const issueId = scope.branch.match(/^(\d+)-/)?.[1]
    if (!defaultTitle && issueId) {
      const issue = await this.request(scope.target, `${endpoint(scope.target)}/issues/${issueId}`)
        .then((response) =>
          z.object({ title: z.string(), confidential: z.boolean() }).parse(response),
        )
        .catch(() => undefined)
      if (issue && !issue.confidential) defaultTitle = `Resolve "${issue.title}"`
    }
    defaultTitle ||= scope.branch
      .replace(/[_-]/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^./u, (letter) => letter.toUpperCase())
    return {
      status: data.diffs.length ? 'changes' : 'empty',
      defaultTitle,
      defaultDescription: commit?.message.split('\n').slice(1).join('\n').trim() ?? '',
    }
  }
  async branchHead(repository: HostingRepository, branch: string) {
    return z
      .object({ commit: z.object({ id: z.string() }) })
      .parse(
        await this.request(
          repository,
          `${endpoint(repository)}/repository/branches/${encodeURIComponent(branch)}`,
        ),
      ).commit.id
  }
  async preMergePipeline(
    scope: ReviewScope,
    current: HostedReview,
  ): Promise<HostedPipeline | undefined> {
    const mergedAt = Date.parse(current.mergedAt ?? '')
    if (current.state !== 'merged' || !current.head || !Number.isFinite(mergedAt)) return undefined
    const beforeMerge = (pipeline: z.infer<typeof pipelineSchema>) =>
      Date.parse(pipeline.created_at ?? '') < mergedAt
    const data = await this.readHeadPipeline(scope, current)
    const head = data.head_pipeline
    if (
      data.sha === current.head &&
      head &&
      beforeMerge(head) &&
      (head.sha === current.head || this.isMergeRef(head, current))
    ) {
      return this.pipelineWithStages(head, this.pipelineRepository(scope, head.project_id))
    }

    // The MR's head pipeline can be replaced by a run created after merge.
    // shortcut: read up to 500 MR pipelines; extend if older matching runs need to be recovered.
    for (let page = 1; page <= 5; page++) {
      const pipelines = z
        .array(pipelineSchema)
        .parse(
          await this.request(
            scope.target,
            `${endpoint(scope.target)}/merge_requests/${current.number}/pipelines?per_page=100&page=${page}`,
          ),
        )
      // Without the authoritative head pointer, an older synthetic SHA cannot be tied to this revision.
      const pipeline = pipelines.find((entry) => entry.sha === current.head && beforeMerge(entry))
      if (pipeline)
        return this.pipelineWithStages(
          pipeline,
          this.pipelineRepository(scope, pipeline.project_id),
        )
      if (pipelines.length < 100) break
    }
    return undefined
  }

  async mergedPipeline(
    scope: ReviewScope,
    current: HostedReview,
  ): Promise<HostedPipeline | undefined> {
    if (current.state !== 'merged' || !current.mergedHead) return undefined
    const query = new URLSearchParams({
      ref: current.targetBranch,
      sha: current.mergedHead,
      order_by: 'id',
      sort: 'desc',
      per_page: '1',
    })
    const pipelines = z
      .array(pipelineSchema)
      .parse(await this.request(scope.target, `${endpoint(scope.target)}/pipelines?${query}`))
    const mergedAt = Date.parse(current.mergedAt ?? '')
    const pipeline = pipelines.find(
      (entry) =>
        entry.sha === current.mergedHead &&
        entry.ref === current.targetBranch &&
        (entry.created_at && Number.isFinite(mergedAt)
          ? Date.parse(entry.created_at) >= mergedAt
          : current.head !== current.mergedHead),
    )
    if (!pipeline) return undefined
    return this.pipelineWithStages(pipeline, scope.target)
  }

  private async pipelineWithStages(
    pipeline: z.infer<typeof pipelineSchema>,
    repository?: HostingRepository,
  ): Promise<HostedPipeline> {
    const stages =
      pipeline.iid && repository
        ? await this.pipelineStages(repository, pipeline.iid).catch(() => undefined)
        : undefined
    return { status: pipeline.status, stages }
  }

  private async pipelineStages(repository: HostingRepository, iid: number) {
    const stages: NonNullable<HostedPipeline['stages']> = []
    let after: string | null = null
    const seen = new Set<string>()
    for (;;) {
      const response = await this.request(repository, 'graphql', {
        query: pipelineStagesQuery,
        variables: { path: repository.path, iid: String(iid), after },
      })
      const result = pipelineStagesSchema.parse(response).data.project.pipeline.stages
      stages.push(...result.nodes)
      if (!result.pageInfo.hasNextPage) return stages
      after = result.pageInfo.endCursor
      if (!after || seen.has(after)) throw new Error('流水线阶段分页无效。')
      seen.add(after)
    }
  }
  private async readHeadPipeline(scope: ReviewScope, current: HostedReview) {
    return z
      .object({ sha: z.string().nullish(), head_pipeline: pipelineSchema.nullish() })
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/merge_requests/${current.number}`,
        ),
      )
  }

  private isMergeRef(pipeline: z.infer<typeof pipelineSchema>, current: HostedReview) {
    // GitLab's merged-results and merge-train pipelines run on synthetic commits.
    return (
      pipeline.source === 'merge_request_event' &&
      ['merge', 'train'].some(
        (ref) => pipeline.ref === `refs/merge-requests/${current.number}/${ref}`,
      )
    )
  }

  private pipelineRepository(scope: ReviewScope, projectId?: number) {
    if (
      projectId === scope.targetInfo.id ||
      (!projectId && scope.sourceInfo.id === scope.targetInfo.id)
    )
      return scope.target
    return projectId === scope.sourceInfo.id ? scope.source : undefined
  }

  async checks(
    scope: ReviewScope,
    current: HostedReview,
  ): Promise<Pick<HostedReview, 'checks' | 'pipeline'>> {
    const data = await this.readHeadPipeline(scope, current)
    if (data.sha && data.sha !== current.head) return { checks: 'unknown' }
    const pipeline = data.head_pipeline
    if (!pipeline) return { checks: 'none' }
    if (
      pipeline.sha !== current.head &&
      !(data.sha === current.head && this.isMergeRef(pipeline, current))
    )
      return { checks: 'unknown' }
    return {
      checks: pipelineCheckStates.get(pipeline.status) ?? 'unknown',
      pipeline: await this.pipelineWithStages(
        pipeline,
        this.pipelineRepository(scope, pipeline.project_id),
      ),
    }
  }
  async create(scope: ReviewScope, input: CreateHostedReview) {
    const merge = mergeSchema.parse(
      await this.request(scope.source, `${endpoint(scope.source)}/merge_requests`, {
        title:
          input.draft && !/^(?:Draft|WIP):/i.test(input.title)
            ? `Draft: ${input.title}`
            : input.title,
        description: input.description,
        source_branch: scope.branch,
        target_branch: input.targetBranch,
        target_project_id: scope.targetInfo.id,
      }),
    )
    return review(scope, merge)
  }
}
