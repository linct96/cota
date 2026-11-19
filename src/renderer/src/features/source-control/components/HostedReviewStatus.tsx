import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { HostedReview } from '../../../../../shared/code-hosting'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const relativeTimeZh = new Intl.RelativeTimeFormat('zh-CN', { style: 'short' })
const timeUnits = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
] as const

export function formatReviewRelativeTime(date: string): string {
  const seconds = (Date.parse(date) - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return '时间未知'
  for (const [unit, duration] of timeUnits) {
    if (Math.abs(seconds) >= duration) {
      return relativeTimeZh.format(Math.trunc(seconds / duration), unit)
    }
  }
  return '刚刚'
}

export function hostedReviewStateLabel({ state, draft }: Pick<HostedReview, 'state' | 'draft'>) {
  if (state === 'merged') return '已合并'
  if (state === 'closed') return '已关闭'
  return draft ? '草稿' : '开放'
}

export function HostedReviewStateIcon({
  review,
  className,
}: {
  review: Pick<HostedReview, 'state' | 'draft'>
  className?: string
}) {
  if (review.state === 'merged') {
    return (
      <GitMerge
        className={cn(
          'hosted-review-state-icon size-3.5 shrink-0 text-app-muted-foreground',
          className,
        )}
        aria-hidden="true"
      />
    )
  }
  if (review.state === 'closed') {
    return (
      <GitPullRequestClosed
        className={cn('hosted-review-state-icon size-3.5 shrink-0 text-destructive', className)}
        aria-hidden="true"
      />
    )
  }
  if (review.draft) {
    return (
      <GitPullRequestDraft
        className={cn(
          'hosted-review-state-icon size-3.5 shrink-0 text-muted-foreground',
          className,
        )}
        aria-hidden="true"
      />
    )
  }
  return (
    <GitPullRequest
      className={cn('hosted-review-state-icon size-3.5 shrink-0 text-success', className)}
      aria-hidden="true"
    />
  )
}

export function HostedReviewStatus({ review }: { review: Pick<HostedReview, 'state' | 'draft'> }) {
  const label = hostedReviewStateLabel(review)
  if (review.state === 'merged') {
    return (
      <Badge variant="outline" className="hosted-review-state shrink-0 text-text-normal">
        <GitMerge className="hosted-review-state-badge-icon" aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  if (review.state === 'closed') {
    return (
      <Badge variant="destructive" className="hosted-review-state shrink-0">
        <GitPullRequestClosed className="hosted-review-state-badge-icon" aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  if (review.draft) {
    return (
      <Badge variant="secondary" className="hosted-review-state shrink-0">
        <GitPullRequestDraft className="hosted-review-state-badge-icon" aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  return (
    <Badge variant="success" className="hosted-review-state shrink-0">
      <GitPullRequest className="hosted-review-state-badge-icon" aria-hidden="true" />
      {label}
    </Badge>
  )
}
