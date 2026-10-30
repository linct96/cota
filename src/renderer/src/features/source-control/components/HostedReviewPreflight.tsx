import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewPreflight({
  preflight,
  preparing,
  initializing,
  busy,
  label,
  retryPreparation,
  unlockCreation,
  openReview,
}: Pick<
  HostedReviewCreation,
  | 'preflight'
  | 'preparing'
  | 'initializing'
  | 'busy'
  | 'label'
  | 'retryPreparation'
  | 'unlockCreation'
  | 'openReview'
>) {
  return (
    <div
      className={cn(
        'create-hosted-review-preflight flex min-h-5 flex-col gap-2',
        (initializing || preparing) && 'invisible',
      )}
      aria-live="polite"
      inert={initializing || preparing}
    >
      {preflight?.result?.message && (
        <p
          className={cn(
            'create-hosted-review-preflight-message text-xs',
            preflight.result.status === 'blocked' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {preflight.result.message}
        </p>
      )}
      {preflight?.error && (
        <p className="create-hosted-review-preflight-error text-xs text-destructive">
          {preflight.error}
        </p>
      )}
      {(preflight?.error || preflight?.result?.status === 'unknown') && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="create-hosted-review-retry self-start"
          disabled={busy || preparing}
          onClick={retryPreparation}
        >
          重新检查
        </Button>
      )}
      {preflight?.result?.creationBlocked && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="create-hosted-review-unlock self-start"
          disabled={busy}
          onClick={() => void unlockCreation()}
        >
          已在网页核对，解除保护…
        </Button>
      )}
      {preflight?.result?.existingReviews.map((review) => (
        <Button
          key={review.number}
          type="button"
          variant="outline"
          size="sm"
          className="create-hosted-review-existing min-w-0 justify-between"
          disabled={busy}
          onClick={() => void openReview(review.number)}
        >
          <span className="create-hosted-review-existing-title truncate">
            打开 {label} #{review.number} · {review.title}
          </span>
          <ExternalLink className="create-hosted-review-existing-icon shrink-0" />
        </Button>
      ))}
    </div>
  )
}
