import { CircleCheck, ExternalLink, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
      className="create-hosted-review-preflight flex min-h-5 flex-col gap-2"
      aria-live="polite"
      aria-busy={initializing || preparing}
    >
      {initializing || preparing ? (
        <p className="create-hosted-review-preflight-pending flex items-center gap-2 text-muted-foreground">
          <LoaderCircle
            className="create-hosted-review-preflight-spinner size-3.5 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {initializing ? '正在读取远端分支…' : '正在检查分支改动与已有评审…'}
        </p>
      ) : (
        <>
          {preflight?.result?.message &&
            (preflight.result.status === 'blocked' ? (
              <Alert variant="destructive" className="create-hosted-review-preflight-blocked">
                <AlertDescription className="create-hosted-review-preflight-blocked-description">
                  {preflight.result.message}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="create-hosted-review-preflight-message flex items-start gap-2 text-muted-foreground">
                {preflight.result.status === 'ready' && (
                  <CircleCheck
                    className="create-hosted-review-preflight-ready-icon mt-0.5 size-3.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                )}
                {preflight.result.message}
              </p>
            ))}
          {preflight?.error && (
            <Alert variant="destructive" className="create-hosted-review-preflight-error">
              <AlertDescription className="create-hosted-review-preflight-error-description">
                {preflight.error}
              </AlertDescription>
            </Alert>
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
              已在网页核对，解除保护
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
              <ExternalLink
                className="create-hosted-review-existing-icon shrink-0"
                data-icon="inline-end"
                aria-hidden="true"
              />
            </Button>
          ))}
        </>
      )}
    </div>
  )
}
