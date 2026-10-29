import { z } from 'zod'
import type { Result, WorkspaceTarget } from './contracts'
import type { GitReferences } from './source-control'

export type HostingFailure =
  | 'cli'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'response'
  | 'rejected'

export const hostingProviderSchema = z.enum(['github', 'gitlab'])
export type HostingProvider = z.infer<typeof hostingProviderSchema>
export const hostingHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/,
    '请输入域名，可包含端口，不包含协议或路径。',
  )
  .refine((host) => {
    try {
      return new URL(`https://${host}`).host === host
    } catch {
      return false
    }
  }, 'Host 无效。')
export interface HostingRepository {
  provider: HostingProvider
  host: string
  path: string
}
export interface HostingContext {
  remotes: { name: string; repository: HostingRepository | null }[]
  source: HostingRepository | null
  target: HostingRepository | null
  branch: string | null
  sourceBranch: string | null
  head: string | null
  key: string
  reason?: string
}
export function resolveTargetBranchRef(
  context: HostingContext,
  references: GitReferences | undefined,
  targetBranch: string,
): string | undefined {
  if (!references || !context.target) return undefined
  for (const remote of context.remotes) {
    if (
      remote.repository?.provider !== context.target.provider ||
      remote.repository.host !== context.target.host ||
      remote.repository.path !== context.target.path
    )
      continue
    const ref = `refs/remotes/${remote.name}/${targetBranch}`
    if (references.branches.some((branch) => branch.ref === ref)) return ref
  }
  return undefined
}

export type HostingCheckState = 'pending' | 'running' | 'success' | 'failure' | 'unknown' | 'none'
export interface HostedReview {
  number: number
  title: string
  draft: boolean
  state: 'open' | 'merged' | 'closed'
  sourceBranch: string
  targetBranch: string
  head: string
  url: string
  checks: HostingCheckState
  checksError?: string
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
}
export interface HostedReviewHistory {
  items: HostedReview[]
  nextPage: number | null
  fetchedAt: number
}
export interface HostingComparison {
  status: 'changes' | 'empty' | 'unknown'
  defaultTitle?: string
  defaultDescription?: string
}
export interface HostingBranch {
  name: string
  date?: string
}
export interface HostedReviewBranchLists {
  sourceBranches: HostingBranch[]
  targetBranches: HostingBranch[]
  branchesStale: boolean
  branchesFetchedAt: number
}
export function hostingBranchesExpired(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= 60000
}
export interface HostedReviewCreationContext extends HostedReviewBranchLists {
  context: HostingContext
  account: string
  defaultBranch: string
}
export interface HostedReviewPreparation {
  sourceHead?: string
  creationBlocked?: boolean
  defaultTitle?: string
  defaultDescription?: string
  status: 'ready' | 'existing' | 'empty' | 'blocked' | 'unknown'
  message: string
  existingReviews: HostedReview[]
}
const hostingRepositorySchema = z.object({
  provider: hostingProviderSchema,
  host: hostingHostSchema,
  path: z.string().min(1).max(4096),
})
export const pendingHostedReviewSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  source: hostingRepositorySchema,
  target: hostingRepositorySchema,
  sourceBranch: z.string().min(1).max(1013),
  targetBranch: z.string().min(1).max(1013),
  sourceHead: z.string().min(1).max(256),
  account: z.string().min(1).max(256),
  startedAt: z.number().int().nonnegative(),
})
export type PendingHostedReview = z.infer<typeof pendingHostedReviewSchema>
export const hostingBranchSchema = z
  .string()
  .trim()
  .min(1, '请选择分支。')
  .max(1013)
  .refine((value) => !/[\s\p{Cc}]/u.test(value) && !value.startsWith('-'), '分支无效。')
export const prepareHostedReviewSchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    account: z.string().min(1).max(256),
    sourceBranch: hostingBranchSchema,
    targetBranch: hostingBranchSchema,
  })
  .strict()
export type PrepareHostedReview = z.infer<typeof prepareHostedReviewSchema>
export interface HostingSnapshot {
  context: HostingContext
  account: string
  defaultBranch: string
  activeReviews: HostedReview[]
  fetchedAt: number
  creationBlocked: boolean
}
export const createHostedReviewSchema = prepareHostedReviewSchema
  .extend({
    title: z
      .string()
      .trim()
      .min(1, '请输入标题。')
      .max(240, '标题最多 240 个字符。')
      .refine((value) => !/\p{Cc}/u.test(value), '标题不能包含控制字符。'),
    description: z
      .string()
      .max(65000, '描述最多 65,000 个字符。')
      .refine((value) => !value.includes('\0'), '描述不能包含空字符。'),
    draft: z.boolean(),
  })
  .strict()
export type CreateHostedReview = z.infer<typeof createHostedReviewSchema>
export type HostingConnection =
  | { status: 'connected'; account: string }
  | { status: 'disconnected' | 'cli-unavailable'; message: string }

export interface HostingAccount {
  host: string
  account: string
  active: boolean
  status: 'connected' | 'error'
}
export type HostingAccounts =
  | { status: 'detected'; accounts: HostingAccount[] }
  | { status: 'disconnected' | 'cli-unavailable'; message: string }

export interface CodeHostingAPI {
  context(target: WorkspaceTarget): Promise<Result<HostingContext>>
  accounts(provider: HostingProvider): Promise<Result<HostingAccounts>>
  connection(provider: HostingProvider, host: string): Promise<Result<HostingConnection>>
  inspect(target: WorkspaceTarget): Promise<Result<HostingSnapshot>>
  creationContext(target: WorkspaceTarget): Promise<Result<HostedReviewCreationContext>>
  refreshBranches(
    target: WorkspaceTarget,
    input: Pick<PrepareHostedReview, 'key' | 'account'>,
  ): Promise<Result<HostedReviewBranchLists>>
  history(target: WorkspaceTarget, key: string, page: number): Promise<Result<HostedReviewHistory>>
  prepare(
    target: WorkspaceTarget,
    input: PrepareHostedReview,
  ): Promise<Result<HostedReviewPreparation>>
  create(target: WorkspaceTarget, input: CreateHostedReview): Promise<Result<HostedReview>>
  open(target: WorkspaceTarget, number: number, sourceBranch?: string): Promise<Result<void>>
  clearCreation(target: WorkspaceTarget, key: string, sourceBranch?: string): Promise<Result<void>>
}
