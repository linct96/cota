import { z } from 'zod'
import type { HostingAdapter, ReviewScope } from './adapter'
import { combineChecks, reviewUrl } from './adapter'
import { HostingError, hostingRequest } from './cli-runner'
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

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  default_branch: z.string(),
})
const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  draft: z.boolean().optional(),
  state: z.enum(['open', 'closed']),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullable(),
  merge_commit_sha: z.string().nullish(),
  closed_at: z.string().nullable(),
  user: z.object({ login: z.string() }).nullish(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ id: z.number() }).nullable(),
  }),
  base: z.object({ ref: z.string(), repo: z.object({ id: z.number() }) }),
})
const jobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
})
const checkRunSchema = jobSchema.extend({
  started_at: z.string().nullable(),
  check_suite: z.object({ id: z.number() }),
})
const commitStatusSchema = z.object({
  context: z.string(),
  state: z.string(),
  created_at: z.string(),
})
const workflowRunSchema = jobSchema.extend({
  name: z.string().nullish(),
  workflow_id: z.number().int().positive(),
  event: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  created_at: z.string(),
})
type Pull = z.infer<typeof pullSchema>
const endpoint = (repository: HostingRepository) =>
  `repos/${repository.path.split('/').map(encodeURIComponent).join('/')}`

function jobStatus(job: Pick<z.infer<typeof jobSchema>, 'status' | 'conclusion'>) {
  switch (job.status) {
    case 'queued':
    case 'pending':
    case 'requested':
    case 'waiting':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      switch (job.conclusion) {
        case 'success':
        case 'neutral':
        case 'skipped':
          return job.conclusion
        case 'cancelled':
          return 'canceled'
        case 'action_required':
          return 'manual'
        default:
          return job.conclusion ? 'failed' : 'unknown'
      }
    default:
      return 'unknown'
  }
}

function checkState(status: string): HostingCheckState {
  switch (status) {
    case 'running':
    case 'pending':
    case 'success':
      return status
    case 'neutral':
    case 'skipped':
      return 'success'
    case 'failed':
    case 'failure':
    case 'error':
    case 'canceled':
    case 'manual':
      return 'failure'
    default:
      return 'unknown'
  }
}

function pipelineStatus(checks: HostingCheckState) {
  return checks === 'failure' ? 'failed' : checks
}

function review(scope: ReviewScope, pull: Pull): HostedReview {
  if (
    pull.head.repo?.id !== scope.sourceInfo.id ||
    pull.base.repo.id !== scope.targetInfo.id ||
    pull.head.ref !== scope.branch
  )
    throw new Error('PR 的来源仓库或分支与所选来源不匹配。')
  return {
    number: pull.number,
    title: pull.title,
    draft: pull.draft || false,
    state: pull.merged_at ? 'merged' : pull.state === 'open' ? 'open' : 'closed',
    sourceBranch: pull.head.ref,
    targetBranch: pull.base.ref,
    head: pull.head.sha,
    mergedHead: pull.merged_at ? (pull.merge_commit_sha ?? undefined) : undefined,
    url: reviewUrl(scope.target, pull.number),
    checks: 'unknown',
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    mergedAt: pull.merged_at,
    authorUsername: pull.user?.login,
    closedAt: pull.closed_at,
  }
}
export class GitHubAdapter implements HostingAdapter {
  constructor(private readonly request: HostingRequest = hostingRequest) {}
  async account(repository: HostingRepository) {
    return z.object({ login: z.string().min(1) }).parse(await this.request(repository, 'user'))
      .login
  }
  async repository(repository: HostingRepository) {
    const data = repositorySchema.parse(await this.request(repository, endpoint(repository)))
    if (data.full_name.toLowerCase() !== repository.path.toLowerCase())
      throw new Error('仓库已改名或发生重定向，请在终端更新 Git 远端地址。')
    return { id: data.id, path: data.full_name, defaultBranch: data.default_branch }
  }
  async branches(repository: HostingRepository): Promise<HostingBranch[]> {
    const branches: HostingBranch[] = []
    const [owner, name] = repository.path.split('/')
    let cursor: string | null = null
    for (let page = 1; page <= 100; page++) {
      const response = z
        .object({
          errors: z.array(z.unknown()).optional(),
          data: z
            .object({
              repository: z
                .object({
                  refs: z.object({
                    nodes: z.array(
                      z.object({
                        name: z.string().min(1),
                        target: z
                          .object({ committedDate: z.string().nullable().optional() })
                          .nullable(),
                      }),
                    ),
                    pageInfo: z.object({
                      hasNextPage: z.boolean(),
                      endCursor: z.string().nullable(),
                    }),
                  }),
                })
                .nullable(),
            })
            .nullable()
            .optional(),
        })
        .parse(
          await this.request(repository, 'graphql', {
            query: `query($owner: String!, $name: String!, $cursor: String) {
              repository(owner: $owner, name: $name) {
                refs(refPrefix: "refs/heads/", first: 100, after: $cursor, orderBy: {field: ALPHABETICAL, direction: ASC}) {
                  nodes { name target { ... on Commit { committedDate } } }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }`,
            variables: { owner, name, cursor },
          }),
        )
      if (response.errors?.length || !response.data?.repository)
        throw new HostingError('response', '远端分支读取失败，请检查账号权限后重试。')
      const { nodes, pageInfo } = response.data.repository.refs
      branches.push(
        ...nodes.map((branch) => ({
          name: branch.name,
          date: branch.target?.committedDate ?? undefined,
        })),
      )
      if (!pageInfo.hasNextPage) return branches
      if (!pageInfo.endCursor || pageInfo.endCursor === cursor)
        throw new HostingError('response', '远端分支分页信息无效，请重试。')
      cursor = pageInfo.endCursor
    }
    throw new Error('远端分支超过读取上限，请在平台网页创建 PR。')
  }
  async listOpen(scope: ReviewScope) {
    const head = `${scope.sourceInfo.path.split('/')[0]}:${scope.branch}`
    const data = z
      .array(pullSchema)
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/pulls?state=open&per_page=100&head=${encodeURIComponent(head)}`,
        ),
      )
    if (data.length >= 100) throw new Error('关联 PR 过多，请在网页中确认。')
    const matches = data.filter(
      (pull) =>
        pull.state === 'open' &&
        pull.head.repo?.id === scope.sourceInfo.id &&
        pull.base.repo.id === scope.targetInfo.id &&
        pull.head.ref === scope.branch,
    )
    return matches.map((pull) => review(scope, pull))
  }
  async history(scope: ReviewScope, page: number) {
    const head = `${scope.sourceInfo.path.split('/')[0]}:${scope.branch}`
    const data = z
      .array(pullSchema)
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/pulls?state=all&sort=created&direction=desc&per_page=20&page=${page}&head=${encodeURIComponent(head)}`,
        ),
      )
    return {
      items: data
        .filter(
          (pull) =>
            pull.head.repo?.id === scope.sourceInfo.id &&
            pull.base.repo.id === scope.targetInfo.id &&
            pull.head.ref === scope.branch,
        )
        .map((pull) => review(scope, pull)),
      nextPage: data.length === 20 ? page + 1 : null,
      fetchedAt: Date.now(),
    }
  }
  async get(scope: ReviewScope, number: number) {
    return review(
      scope,
      pullSchema.parse(
        await this.request(scope.target, `${endpoint(scope.target)}/pulls/${number}`),
      ),
    )
  }
  async merge(scope: ReviewScope, current: HostedReview): Promise<HostedReview> {
    const result = z
      .object({ merged: z.boolean() })
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/pulls/${current.number}/merge`,
          { sha: current.head, merge_method: 'merge' },
          'PUT',
        ),
      )
    if (!result.merged)
      throw new HostingError('rejected', '平台未合并 PR，请检查审批、检查及仓库合并规则。')
    return this.get(scope, current.number)
  }
  async compare(
    scope: ReviewScope,
    sourceHead: string,
    targetHead: string,
  ): Promise<HostingComparison> {
    const data = z
      .object({
        files: z.array(z.object({ filename: z.string() })).optional(),
        commits: z
          .array(
            z.object({
              commit: z.object({ message: z.string() }),
              parents: z.array(z.unknown()).optional(),
            }),
          )
          .optional(),
      })
      .parse(
        await this.request(
          scope.target,
          `${endpoint(scope.target)}/compare/${encodeURIComponent(targetHead)}...${encodeURIComponent(sourceHead)}`,
        ),
      )
    if (!data.files || data.files.length >= 300) return { status: 'unknown' }
    const descriptionCommit =
      data.commits?.length === 1
        ? data.commits[0]
        : data.commits?.find(
            ({ commit, parents }) =>
              (parents?.length ?? 0) < 2 && commit.message.split('\n').slice(1).join('\n').trim(),
          )
    return {
      status: data.files.length ? 'changes' : 'empty',
      defaultTitle:
        data.commits?.length === 1
          ? data.commits[0].commit.message.split('\n')[0]
          : scope.branch.replace(/[_-]/g, ' '),
      defaultDescription:
        descriptionCommit?.commit.message.split('\n').slice(1).join('\n').trim() ?? '',
    }
  }
  async branchHead(repository: HostingRepository, branch: string) {
    return z
      .object({ commit: z.object({ sha: z.string() }) })
      .parse(
        await this.request(
          repository,
          `${endpoint(repository)}/branches/${encodeURIComponent(branch)}`,
        ),
      ).commit.sha
  }
  checks(scope: ReviewScope, current: HostedReview) {
    return this.commitChecks(scope.source, current.head)
  }
  async preMergePipeline(scope: ReviewScope, current: HostedReview) {
    const mergedAt = Date.parse(current.mergedAt ?? '')
    if (current.state !== 'merged' || !Number.isFinite(mergedAt)) return undefined
    return (await this.commitChecks(scope.source, current.head, mergedAt)).pipeline
  }
  async mergedPipeline(
    scope: ReviewScope,
    current: HostedReview,
  ): Promise<HostedPipeline | undefined> {
    const mergedAt = Date.parse(current.mergedAt ?? '')
    if (current.state !== 'merged' || !current.mergedHead || !Number.isFinite(mergedAt))
      return undefined
    const target = endpoint(scope.target)
    const query = new URLSearchParams({
      head_sha: current.mergedHead,
      branch: current.targetBranch,
      event: 'push',
      created: `>=${new Date(mergedAt).toISOString()}`,
      per_page: '100',
    })
    const result = z
      .object({ total_count: z.number(), workflow_runs: z.array(workflowRunSchema) })
      .parse(await this.request(scope.target, `${target}/actions/runs?${query}`))
    // shortcut: show unknown beyond one page; paginate if repositories exceed 100 runs per merge.
    if (result.total_count > result.workflow_runs.length) return { status: 'unknown' }
    const workflows = new Map<number, z.infer<typeof workflowRunSchema>>()
    for (const run of result.workflow_runs) {
      const created = Date.parse(run.created_at)
      if (
        run.event !== 'push' ||
        run.head_sha !== current.mergedHead ||
        run.head_branch !== current.targetBranch ||
        !(created >= mergedAt)
      )
        continue
      const previous = workflows.get(run.workflow_id)
      // A later push of the same SHA must not replace the run triggered by the merge.
      if (!previous || created < Date.parse(previous.created_at))
        workflows.set(run.workflow_id, run)
    }
    const runs = [...workflows.values()]
    if (!runs.length) return undefined
    const status =
      runs.length === 1
        ? jobStatus(runs[0])
        : pipelineStatus(combineChecks(runs.map((run) => checkState(jobStatus(run)))))
    const stages = await Promise.all(
      runs.map(async (run) => {
        const jobPage = z
          .object({ total_count: z.number(), jobs: z.array(jobSchema) })
          .parse(
            await this.request(
              scope.target,
              `${target}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
            ),
          )
        // shortcut: keep the workflow status but hide partial lists over 100 jobs.
        if (jobPage.total_count > jobPage.jobs.length) return undefined
        return jobPage.jobs.map((job) => ({
          id: `job:${job.id}`,
          name: runs.length > 1 && run.name ? `${run.name} · ${job.name}` : job.name,
          status: jobStatus(job),
        }))
      }),
    ).catch(() => undefined)
    return {
      status,
      stages: stages?.every((jobs) => jobs !== undefined) ? stages.flat() : undefined,
    }
  }
  private async commitChecks(
    repository: HostingRepository,
    head: string,
    before?: number,
  ): Promise<Pick<HostedReview, 'checks' | 'pipeline'>> {
    const prefix = `${endpoint(repository)}/commits/${encodeURIComponent(head)}`
    const [runs, status] = await Promise.all([
      this.request(
        repository,
        `${prefix}/check-runs?per_page=100${before === undefined ? '' : '&filter=all'}`,
      ),
      this.request(repository, `${prefix}/status?per_page=100`),
    ])
    const parsedRuns = z
      .object({ total_count: z.number(), check_runs: z.array(checkRunSchema) })
      .parse(runs)
    const parsedStatus = z
      .object({ total_count: z.number(), state: z.string(), statuses: z.array(commitStatusSchema) })
      .parse(status)
    const partialStatuses = parsedStatus.total_count > parsedStatus.statuses.length
    // shortcut: never show a misleading partial list; paginate if checks exceed 100 per commit.
    if (
      parsedRuns.total_count > parsedRuns.check_runs.length ||
      (before !== undefined && partialStatuses)
    )
      return { checks: 'unknown', pipeline: { status: 'unknown' } }

    const checkRuns = new Map<string, z.infer<typeof checkRunSchema>>()
    for (const run of parsedRuns.check_runs) {
      // Without a start time, a check on a shared source/merge SHA cannot be attributed safely.
      if (before !== undefined && !(Date.parse(run.started_at ?? '') < before)) continue
      const key = `${run.check_suite.id}:${run.name}`
      const previous = checkRuns.get(key)
      if (!previous || run.id > previous.id) checkRuns.set(key, run)
    }
    const contexts = parsedStatus.statuses.filter(
      (entry) => before === undefined || Date.parse(entry.created_at) < before,
    )
    const stages = [
      ...[...checkRuns.values()].map((run) => ({
        id: `check:${run.id}`,
        name: run.name,
        status: jobStatus(run),
      })),
      ...contexts.map((entry) => ({
        id: `status:${entry.context}`,
        name: entry.context,
        status: pipelineStatus(checkState(entry.state)),
      })),
    ]
    const checks = combineChecks([
      ...stages.map((stage) => checkState(stage.status)),
      ...(before === undefined && parsedStatus.total_count ? [checkState(parsedStatus.state)] : []),
    ])
    return {
      checks,
      pipeline:
        checks === 'none'
          ? undefined
          : {
              status: pipelineStatus(checks),
              stages: partialStatuses ? undefined : stages,
            },
    }
  }
  async create(scope: ReviewScope, input: CreateHostedReview) {
    const pull = pullSchema.parse(
      await this.request(scope.target, `${endpoint(scope.target)}/pulls`, {
        title: input.title,
        body: input.description,
        draft: input.draft,
        base: input.targetBranch,
        head:
          scope.sourceInfo.id === scope.targetInfo.id
            ? scope.branch
            : `${scope.sourceInfo.path.split('/')[0]}:${scope.branch}`,
        ...(scope.sourceInfo.id !== scope.targetInfo.id
          ? { head_repo: scope.sourceInfo.path.split('/')[1] }
          : {}),
      }),
    )
    return review(scope, pull)
  }
}
