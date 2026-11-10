import { ArrowUpRight, GitMerge } from 'lucide-react'
import type { HostedReview } from '../../../../../shared/code-hosting'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { HostedReviewStatus } from './HostedReviewStatus'

export function HostedReviewDetails({
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
  onMerge: () => void
}) {
  const endedAt = review.mergedAt || review.closedAt || review.updatedAt
  return (
    <article className="hosted-review-details flex min-w-0 flex-col gap-4">
      <header className="hosted-review-details-header flex min-w-0 flex-col gap-2">
        <div className="hosted-review-details-status flex min-w-0 flex-wrap items-center gap-1.5">
          <HostedReviewStatus review={review} />
        </div>
        <h3 className="hosted-review-details-title text-sm leading-relaxed font-semibold wrap-anywhere select-text">
          {review.title}
        </h3>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="hosted-review-details-link self-start px-0"
          disabled={disabled}
          aria-label={`在网页打开 ${label} #${review.number}`}
          title={`在网页打开 ${label} #${review.number}`}
          onClick={onOpen}
        >
          <span className="hosted-review-details-number tabular-nums">
            {label} #{review.number}
          </span>
          <ArrowUpRight
            className="hosted-review-details-link-icon"
            data-icon="inline-end"
            aria-hidden="true"
          />
        </Button>
      </header>
      <dl className="hosted-review-details-metadata grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-xs/relaxed">
        <dt className="hosted-review-details-source-label text-muted-foreground">来源</dt>
        <dd
          className="hosted-review-details-source truncate font-mono select-text [unicode-bidi:plaintext]"
          title={review.sourceBranch}
        >
          {review.sourceBranch}
        </dd>
        <dt className="hosted-review-details-target-label text-muted-foreground">目标</dt>
        <dd
          className="hosted-review-details-target truncate font-mono select-text [unicode-bidi:plaintext]"
          title={review.targetBranch}
        >
          {review.targetBranch}
        </dd>
        <dt className="hosted-review-details-created-label text-muted-foreground">创建于</dt>
        <dd className="hosted-review-details-created tabular-nums">
          <time className="hosted-review-details-created-time" dateTime={review.createdAt}>
            {new Date(review.createdAt).toLocaleDateString()}
          </time>
        </dd>
        {review.state !== 'open' && (
          <>
            <dt className="hosted-review-details-ended-label text-muted-foreground">
              {review.state === 'merged' ? '合并于' : '关闭于'}
            </dt>
            <dd className="hosted-review-details-ended tabular-nums">
              <time className="hosted-review-details-ended-time" dateTime={endedAt}>
                {new Date(endedAt).toLocaleDateString()}
              </time>
            </dd>
          </>
        )}
      </dl>
      {review.checksError && (
        <output className="hosted-review-details-checks-error text-muted-foreground wrap-anywhere">
          {review.checksError}
        </output>
      )}
      {review.state === 'open' && !review.draft && (
        <>
          <Separator className="hosted-review-details-separator" />
          <footer className="hosted-review-details-actions flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hosted-review-details-merge"
              disabled={disabled || !review.head}
              aria-label={`合并 ${label} #${review.number}`}
              onClick={onMerge}
            >
              <GitMerge
                className="hosted-review-details-merge-icon"
                data-icon="inline-start"
                aria-hidden="true"
              />
              合并
            </Button>
          </footer>
        </>
      )}
    </article>
  )
}
