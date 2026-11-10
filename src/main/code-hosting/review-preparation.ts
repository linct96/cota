import type {
  HostedReview,
  HostedReviewPreparation,
  HostingComparison,
  PrepareHostedReview,
} from '../../shared/code-hosting'
import type { HostingAdapter, ReviewScope } from './adapter'

export async function prepareReview(
  input: PrepareHostedReview,
  adapter: HostingAdapter,
  scope: ReviewScope,
  creationBlocked: boolean,
  reviews: HostedReview[],
): Promise<HostedReviewPreparation> {
  const existingReviews = reviews.filter(
    (review) =>
      review.sourceBranch === input.sourceBranch && review.targetBranch === input.targetBranch,
  )
  if (existingReviews.length)
    return {
      status: existingReviews.length === 1 ? 'existing' : 'blocked',
      existingReviews,
      message:
        existingReviews.length === 1
          ? '该目标已有开放评审，将使用已有记录，不会重复创建。'
          : '该目标存在多个开放评审，请在网页核对；已阻止创建。',
    }
  const result = (
    status: HostedReviewPreparation['status'],
    message: string,
  ): HostedReviewPreparation => ({ status, message, existingReviews: [] })
  if (creationBlocked)
    return {
      ...result('blocked', '上次创建的结果尚未确认，已阻止重复提交。'),
      creationBlocked: true,
    }
  if (scope.sourceInfo.id === scope.targetInfo.id && scope.branch === input.targetBranch)
    return result('blocked', '来源分支和目标分支不能相同。')
  const [sourceHead, targetHead] = await Promise.all([
    adapter.branchHead(scope.source, scope.branch),
    adapter.branchHead(scope.target, input.targetBranch),
  ])
  const comparison = await adapter
    .compare(scope, sourceHead, targetHead)
    .catch((): HostingComparison => ({ status: 'unknown' }))
  if (comparison.status === 'unknown')
    return result('unknown', '无法确认远端差异，请刷新或在平台网页核对后创建。')
  if (comparison.status === 'empty')
    return result('empty', '远端来源与目标之间没有可评审差异，无需创建。')
  return {
    ...result('ready', ''),
    sourceHead,
    defaultTitle: comparison.defaultTitle,
    defaultDescription: comparison.defaultDescription,
  }
}
