import type {
  CreateHostedReview,
  HostedReview,
  HostingCheckState,
  HostingRepository,
  HostedReviewHistory,
  HostingComparison,
  HostingBranch,
} from '../../shared/code-hosting'

export interface RemoteRepository {
  id: number
  path: string
  defaultBranch: string
}
export interface ReviewScope {
  source: HostingRepository
  target: HostingRepository
  sourceInfo: RemoteRepository
  targetInfo: RemoteRepository
  branch: string
}
export interface HostingAdapter {
  account(repository: HostingRepository): Promise<string>
  repository(repository: HostingRepository): Promise<RemoteRepository>
  branches(repository: HostingRepository): Promise<HostingBranch[]>
  listOpen(scope: ReviewScope): Promise<HostedReview[]>
  history(scope: ReviewScope, page: number): Promise<HostedReviewHistory>
  get(scope: ReviewScope, number: number): Promise<HostedReview>
  compare(scope: ReviewScope, sourceHead: string, targetHead: string): Promise<HostingComparison>
  branchHead(repository: HostingRepository, branch: string): Promise<string>
  checks(scope: ReviewScope, review: HostedReview): Promise<HostingCheckState>
  create(scope: ReviewScope, input: CreateHostedReview): Promise<HostedReview>
}
export function reviewUrl(repository: HostingRepository, number: number): string {
  return `https://${repository.host}/${repository.path}/${repository.provider === 'github' ? 'pull' : '-/merge_requests'}/${number}`
}
export function combineChecks(states: HostingCheckState[]): HostingCheckState {
  if (!states.length) return 'none'
  for (const state of ['failure', 'running', 'pending', 'unknown'] as const)
    if (states.includes(state)) return state
  return states.every((state) => state === 'none') ? 'none' : 'success'
}
