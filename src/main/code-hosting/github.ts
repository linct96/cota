import { z } from 'zod'
import type { HostingAdapter, ReviewScope } from './adapter'
import { combineChecks, reviewUrl } from './adapter'
import { HostingError, hostingRequest, type HostingRequest } from './cli-runner'
import type {
  CreateHostedReview,
  HostedReview,
  HostingComparison,
  HostingBranch,
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
  closed_at: z.string().nullable(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ id: z.number() }).nullable(),
  }),
  base: z.object({ ref: z.string(), repo: z.object({ id: z.number() }) }),
})
type Pull = z.infer<typeof pullSchema>
const endpoint = (repository: HostingRepository) =>
  `repos/${repository.path.split('/').map(encodeURIComponent).join('/')}`
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
    url: reviewUrl(scope.target, pull.number),
    checks: 'unknown',
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    mergedAt: pull.merged_at,
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
          `${endpoint(scope.target)}/pulls?state=closed&sort=updated&direction=desc&per_page=20&page=${page}&head=${encodeURIComponent(head)}`,
        ),
      )
    return {
      items: data
        .filter(
          (pull) =>
            pull.state === 'closed' &&
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
          ? data.commits[0]!.commit.message.split('\n')[0]
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
  async checks(scope: ReviewScope, current: HostedReview) {
    const prefix = `${endpoint(scope.source)}/commits/${encodeURIComponent(current.head)}`
    const [runs, status] = await Promise.all([
      this.request(scope.source, `${prefix}/check-runs?per_page=100`),
      this.request(scope.source, `${prefix}/status`),
    ])
    const parsedRuns = z
      .object({
        total_count: z.number(),
        check_runs: z.array(z.object({ status: z.string(), conclusion: z.string().nullable() })),
      })
      .parse(runs)
    const parsedStatus = z.object({ total_count: z.number(), state: z.string() }).parse(status)
    if (parsedRuns.total_count > parsedRuns.check_runs.length) return 'unknown' as const
    return combineChecks([
      ...parsedRuns.check_runs.map((run) =>
        run.status === 'queued'
          ? ('pending' as const)
          : run.status !== 'completed'
            ? ('running' as const)
            : ['success', 'neutral', 'skipped'].includes(run.conclusion || '')
              ? ('success' as const)
              : ('failure' as const),
      ),
      ...(parsedStatus.total_count
        ? [
            parsedStatus.state === 'success'
              ? ('success' as const)
              : parsedStatus.state === 'pending'
                ? ('pending' as const)
                : parsedStatus.state === 'failure' || parsedStatus.state === 'error'
                  ? ('failure' as const)
                  : ('unknown' as const),
          ]
        : []),
    ])
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
