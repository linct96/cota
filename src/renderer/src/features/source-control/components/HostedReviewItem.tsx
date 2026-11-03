import { GitMerge, GitPullRequest } from 'lucide-react'
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
          <Badge variant="secondary" className="hosted-review-state shrink-0">
            {review.state === 'merged'
              ? '已合并'
              : review.state === 'closed'
                ? '已关闭'
                : review.draft
                  ? '草稿'
                  : '开放'}
          </Badge>
          {review.state === 'open' && (
            <Badge variant="secondary" className="hosted-review-checks shrink-0">
              {checkLabels[review.checks]}
            </Badge>
          )}
        </div>
        <div className="hosted-review-item-actions flex h-6 shrink-0 items-center gap-1">
          {onMerge && review.state === 'open' && !review.draft && (
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
          )}
        </div>
      </div>
      <div className="hosted-review-title min-w-0 truncate font-medium" title={review.title}>
        {review.title}
      </div>
      <div className="hosted-review-meta flex min-w-0 items-center justify-between gap-2 text-app-muted-foreground">
        <span
          className="hosted-review-branches min-w-0 truncate font-mono [unicode-bidi:plaintext]"
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
