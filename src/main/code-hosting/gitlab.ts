import { z } from 'zod'
import type { HostingAdapter, ReviewScope } from './adapter'
import { reviewUrl } from './adapter'
import { hostingRequest, type HostingRequest } from './cli-runner'
import type {
  CreateHostedReview,
  HostedReview,
  HostingCheckState,
  HostingComparison,
  HostingBranch,
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
  closed_at: z.string().nullable(),
  source_project_id: z.number().nullable(),
  target_project_id: z.number(),
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string().nullable(),
})
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
    url: reviewUrl(scope.target, merge.iid),
    checks: 'unknown',
    createdAt: merge.created_at,
    updatedAt: merge.updated_at,
    mergedAt: merge.merged_at,
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
          `${endpoint(scope.target)}/merge_requests?state=all&scope=all&order_by=updated_at&sort=desc&per_page=20&page=${page}&source_branch=${encodeURIComponent(scope.branch)}`,
        ),
      )
    return {
      items: data
        .filter(
          (merge) =>
            (merge.state === 'merged' || merge.state === 'closed') &&
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
        .filter((commit) => emails.has(commit.author_email.trim().toLowerCase()))
        .sort((a, b) => Date.parse(a.authored_date) - Date.parse(b.authored_date))[0]
    }
    let defaultTitle = commit?.title
    const issueId = scope.branch.match(/^(\d+)-/)?.[1]
    if (!defaultTitle && issueId) {
      const issue = await this.request(scope.target, `${endpoint(scope.target)}/issues/${issueId}`)
        .then((data) => z.object({ title: z.string(), confidential: z.boolean() }).parse(data))
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
  async checks(scope: ReviewScope, current: HostedReview): Promise<HostingCheckState> {
    const data = z
      .object({
        head_pipeline: z.object({ sha: z.string(), status: z.string() }).nullable().optional(),
      })
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/merge_requests/${current.number}`,
        ),
      )
    const pipeline = data.head_pipeline
    if (!pipeline) return 'none'
    if (pipeline.sha !== current.head) return 'unknown'
    switch (pipeline.status) {
      case 'success':
      case 'skipped':
        return 'success'
      case 'failed':
      case 'canceled':
        return 'failure'
      case 'running':
        return 'running'
      case 'created':
      case 'pending':
      case 'preparing':
      case 'waiting_for_resource':
      case 'scheduled':
      case 'manual':
        return 'pending'
      default:
        return 'unknown'
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
