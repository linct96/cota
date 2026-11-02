import { ExternalLink, GitMerge, GitPullRequest } from 'lucide-react'
import { type HostedReview } from '../../../../../shared/code-hosting'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const checkLabels = {
  pending: '检查等待中',
  running: '检查进行中',
  success: '检查通过',
  failure: '检查失败',
  unknown: '检查状态未知',
  none: '无检查记录',
}

export function HostedReviewItem({
  review,
  label,
  disabled,
  onOpen,
  onMerge,
}: {
  review: HostedReview
  label: string
  disabled: boolean
  onOpen: () => void
  onMerge?: () => void
}) {
  return (
    <div className="hosted-review-item flex min-w-0 flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={onOpen}
        title={`${label} #${review.number} · ${review.title}`}
        className="hosted-review-open group/hosted-review-item h-auto w-full min-w-0 flex-col items-stretch justify-start gap-1 px-2 py-1.5 text-left"
      >
        <span className="hosted-review-summary flex min-w-0 items-center gap-1.5">
          <GitPullRequest
            className="hosted-review-item-icon size-3.5 shrink-0 text-app-muted-foreground"
            aria-hidden="true"
          />
          <span className="hosted-review-number shrink-0 font-mono text-app-muted-foreground">
            #{review.number}
          </span>
          <span className="hosted-review-title min-w-0 flex-1 truncate font-medium">
            {review.title}
          </span>
          <Badge variant="secondary" className="hosted-review-state shrink-0">
            {review.state === 'merged'
              ? '已合并'
              : review.state === 'closed'
                ? '已关闭'
                : review.draft
                  ? '草稿'
                  : '开放'}
          </Badge>
          <ExternalLink
            className="hosted-review-open-icon size-3 shrink-0 text-app-muted-foreground opacity-60 transition-opacity group-hover/hosted-review-item:opacity-100"
            aria-hidden="true"
          />
        </span>
        <span className="hosted-review-meta flex min-w-0 items-center justify-between gap-2 pl-5 text-app-muted-foreground">
          <span
            className="hosted-review-branches min-w-0 truncate font-mono"
            title={`${review.sourceBranch} → ${review.targetBranch}`}
          >
            {review.sourceBranch} → {review.targetBranch}
          </span>
          {review.state === 'open' ? (
            <Badge
              variant={review.checks === 'failure' ? 'destructive' : 'outline'}
              className="hosted-review-checks shrink-0"
            >
              {checkLabels[review.checks]}
            </Badge>
          ) : (
            <span className="hosted-review-ended shrink-0 tabular-nums">
              {review.state === 'merged' ? '合并于' : '关闭于'}{' '}
              {new Date(
                review.mergedAt || review.closedAt || review.updatedAt,
              ).toLocaleDateString()}
            </span>
          )}
        </span>
      </Button>
      {onMerge && review.state === 'open' && !review.draft && (
        <div className="hosted-review-item-actions flex justify-end px-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="hosted-review-merge"
            disabled={disabled || !review.head}
            aria-label={`合并 ${label} #${review.number}`}
            onClick={onMerge}
          >
            <GitMerge
              className="hosted-review-merge-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            合并
          </Button>
        </div>
      )}
      {review.checksError && (
        <output className="hosted-review-checks-error px-2 text-muted-foreground">
          {review.checksError}
        </output>
      )}
    </div>
  )
}
