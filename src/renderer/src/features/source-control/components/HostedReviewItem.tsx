import { ArrowUpRight } from 'lucide-react'
import type { HostedReview } from '../../../../../shared/code-hosting'
import { Button } from '@/components/ui/button'
import {
  HostedReviewStateIcon,
  formatReviewRelativeTime,
  hostedReviewStateLabel,
} from './HostedReviewStatus'

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
  const timestamp = review.mergedAt || review.closedAt || review.updatedAt
  const relativeTime = formatReviewRelativeTime(timestamp)

  return (
    <Button
      type="button"
      variant="ghost"
      className="hosted-review-item group/review-item h-auto w-full min-w-0 items-start justify-start gap-2 px-2 py-1.5 text-left"
      disabled={disabled}
      aria-label={`在网页打开 ${label} #${review.number}：${review.title}（${hostedReviewStateLabel(review)}）`}
      title={`${label} #${review.number} · ${review.title}\n${review.sourceBranch} → ${review.targetBranch}`}
      onClick={onOpen}
    >
      <span className="hosted-review-item-icon-slot mt-0.5 flex shrink-0 items-center">
        <HostedReviewStateIcon review={review} />
      </span>
      <span className="hosted-review-item-body flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="hosted-review-item-header flex min-w-0 items-center justify-between gap-1.5">
          <span className="hosted-review-title min-w-0 flex-1 truncate font-medium text-foreground">
            {review.title}
          </span>
          <ArrowUpRight
            className="hosted-review-item-external size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/review-item:opacity-100 group-focus-visible/review-item:opacity-100"
            aria-hidden="true"
          />
        </span>
        <span className="hosted-review-meta flex min-w-0 items-center gap-1.5 text-2xs text-app-muted-foreground">
          <span className="hosted-review-number shrink-0 font-mono tabular-nums">
            #{review.number}
          </span>
          <span className="text-muted-foreground/50" aria-hidden="true">
            ·
          </span>
          <span className="hosted-review-target min-w-0 truncate font-mono [unicode-bidi:plaintext]">
            {review.targetBranch}
          </span>
          <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">
            ·
          </span>
          <time
            className="hosted-review-time shrink-0 tabular-nums"
            dateTime={timestamp}
            title={new Date(timestamp).toLocaleString()}
          >
            {relativeTime}
          </time>
        </span>
      </span>
    </Button>
  )
}
