import { GitPullRequest } from 'lucide-react'
import type { HostedReview } from '../../../../../shared/code-hosting'
import { Button } from '@/components/ui/button'
import { HostedReviewStatus } from './HostedReviewStatus'

export function HostedReviewItem({
  review,
  label,
  disabled,
  onOpen,
}: {
  review: HostedReview
  label: string
  disabled: boolean
  onOpen: () => void
}) {
  return (
    <div
      className="hosted-review-item flex min-w-0 flex-col gap-1.5 px-2 py-2"
      data-disabled={disabled}
    >
      <div className="hosted-review-header flex min-w-0 items-start justify-between gap-2">
        <div className="hosted-review-summary flex min-w-0 flex-wrap items-center gap-1.5">
          <GitPullRequest
            className="hosted-review-item-icon size-3.5 shrink-0 text-app-muted-foreground"
            aria-hidden="true"
          />
          <Button
            type="button"
            variant="link"
            size="sm"
            className="hosted-review-number min-w-0 px-0 font-mono tabular-nums"
            disabled={disabled}
            aria-label={`在网页打开 ${label} #${review.number}`}
            title={`在网页打开 ${label} #${review.number}`}
            onClick={onOpen}
          >
            #{review.number}
          </Button>
          <HostedReviewStatus review={review} />
        </div>
      </div>
      <div className="hosted-review-title min-w-0 truncate font-medium" title={review.title}>
        {review.title}
      </div>
      <div className="hosted-review-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-app-muted-foreground">
        <span
          className="hosted-review-branches min-w-0 basis-full truncate font-mono [unicode-bidi:plaintext]"
          title={`${review.sourceBranch} → ${review.targetBranch}`}
        >
          {review.sourceBranch} → {review.targetBranch}
        </span>
        {review.state !== 'open' && (
          <span className="hosted-review-ended shrink-0 tabular-nums">
            {review.state === 'merged' ? '合并于' : '关闭于'}{' '}
            {new Date(review.mergedAt || review.closedAt || review.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      {review.checksError && (
        <output className="hosted-review-checks-error text-muted-foreground">
          {review.checksError}
        </output>
      )}
    </div>
  )
}
