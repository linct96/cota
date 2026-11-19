import { AlertCircle, ExternalLink, GitPullRequest, LoaderCircle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewStatusIndicator({
  creation,
  preflight,
  preparing,
  initializing,
  branchesUnavailable,
}: Pick<
  HostedReviewCreation,
  'creation' | 'preflight' | 'preparing' | 'initializing' | 'branchesUnavailable'
>) {
  if (initializing || preparing) {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <LoaderCircle
          className="create-hosted-review-status-spinner size-3 shrink-0 motion-safe:animate-spin"
          aria-hidden="true"
        />
        {initializing ? '读取中' : '检查中'}
      </span>
    )
  }

  if (branchesUnavailable || preflight?.error) {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-destructive" />
        {branchesUnavailable ? '分支失效' : '检查失败'}
      </span>
    )
  }

  if (creation && (!creation.sourceBranches.length || !creation.targetBranches.length)) {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-warning"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-warning" />
        无远端分支
      </span>
    )
  }

  const status = preflight?.result?.status
  if (status === 'ready') {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-success" />
        可创建
      </span>
    )
  }

  if (status === 'existing') {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-warning"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-warning" />
        已存在
      </span>
    )
  }

  if (status === 'empty') {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-warning"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-warning" />
        无差异
      </span>
    )
  }

  if (status === 'unknown') {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-warning"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-warning" />
        未确认
      </span>
    )
  }

  if (status === 'blocked') {
    return (
      <span
        className="create-hosted-review-status-indicator inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive"
        aria-live="polite"
      >
        <span className="create-hosted-review-status-dot size-1.5 rounded-full bg-destructive" />
        已阻止
      </span>
    )
  }

  return null
}

export function HostedReviewPreflight({
  creation,
  preflight,
  preparing,
  initializing,
  busy,
  label,
  branchError,
  branchesUnavailable,
  retryPreparation,
  unlockCreation,
  openReview,
}: Pick<
  HostedReviewCreation,
  | 'creation'
  | 'preflight'
  | 'preparing'
  | 'initializing'
  | 'busy'
  | 'label'
  | 'branchError'
  | 'branchesUnavailable'
  | 'retryPreparation'
  | 'unlockCreation'
  | 'openReview'
>) {
  if (initializing || preparing) return null

  const status = preflight?.result?.status
  const emptyRemoteBranches =
    !!creation && (!creation.sourceBranches.length || !creation.targetBranches.length)
  const hasBranchIssue = !!branchError || branchesUnavailable
  const hasPreflightBanner =
    !!preflight?.error || (!!status && status !== 'ready') || emptyRemoteBranches

  if (!hasBranchIssue && !hasPreflightBanner) return null

  return (
    <div className="create-hosted-review-preflight shrink-0" aria-live="polite">
      {hasBranchIssue && (
        <div
          role="alert"
          className="create-hosted-review-branches-error flex items-center gap-2 border-b border-border bg-destructive/8 px-4 py-2 text-xs text-destructive"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="create-hosted-review-branches-error-description min-w-0 flex-1 wrap-anywhere">
            {branchError || '所选分支在远端已不存在，请重新选择或刷新。'}
          </span>
        </div>
      )}

      {emptyRemoteBranches && !hasBranchIssue && (
        <output className="create-hosted-review-preflight-empty-branches flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">暂无远端分支，请先推送后刷新。</span>
        </output>
      )}

      {preflight?.error && (
        <div
          role="alert"
          className="create-hosted-review-preflight-error flex items-center justify-between gap-3 border-b border-border bg-destructive/8 px-4 py-2 text-xs text-destructive"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="create-hosted-review-preflight-error-description min-w-0 wrap-anywhere">
              {preflight.error}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="create-hosted-review-retry shrink-0 bg-background text-foreground"
            disabled={busy || preparing}
            onClick={retryPreparation}
          >
            重新检查
          </Button>
        </div>
      )}

      {preflight?.result && status === 'existing' && (
        <output className="create-hosted-review-preflight-existing flex items-center justify-between gap-3 border-b border-border bg-warning/10 px-4 py-2 text-xs">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitPullRequest className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
            {preflight.result.existingReviews[0] ? (
              <p className="min-w-0 truncate text-foreground">
                <span className="font-medium tabular-nums">
                  {label} #{preflight.result.existingReviews[0].number} 已开放
                </span>
                <span className="mx-1.5 text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className="text-text-normal">
                  {preflight.result.existingReviews[0].title}
                </span>
              </p>
            ) : (
              <span className="min-w-0 text-warning">{preflight.result.message}</span>
            )}
          </div>
          {preflight.result.existingReviews[0] && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="create-hosted-review-existing shrink-0 bg-background"
              disabled={busy}
              onClick={() => void openReview(preflight.result!.existingReviews[0].number)}
            >
              网页查看
              <ExternalLink
                className="create-hosted-review-existing-icon shrink-0"
                data-icon="inline-end"
                aria-hidden="true"
              />
            </Button>
          )}
        </output>
      )}

      {preflight?.result && status === 'blocked' && (
        <div
          role="alert"
          className="create-hosted-review-preflight-blocked flex flex-col gap-2 border-b border-border bg-destructive/8 px-4 py-2 text-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-destructive">
              {preflight.result.creationBlocked ? (
                <Lock className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="create-hosted-review-preflight-blocked-description min-w-0 wrap-anywhere">
                {preflight.result.message}
              </span>
            </div>
            {preflight.result.creationBlocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="create-hosted-review-unlock shrink-0 bg-background text-foreground"
                disabled={busy}
                onClick={() => void unlockCreation()}
              >
                解除保护
              </Button>
            )}
          </div>
          {preflight.result.existingReviews.length > 0 && (
            <div className="create-hosted-review-existing-list flex flex-wrap gap-1.5 pl-5.5">
              {preflight.result.existingReviews.map((review) => (
                <Button
                  key={review.number}
                  type="button"
                  variant="outline"
                  size="xs"
                  className="create-hosted-review-existing max-w-full min-w-0 bg-background"
                  disabled={busy}
                  onClick={() => void openReview(review.number)}
                >
                  <span className="create-hosted-review-existing-title truncate tabular-nums">
                    #{review.number} · {review.title}
                  </span>
                  <ExternalLink
                    className="create-hosted-review-existing-icon shrink-0"
                    data-icon="inline-end"
                    aria-hidden="true"
                  />
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {preflight?.result && (status === 'empty' || status === 'unknown') && (
        <output className="create-hosted-review-preflight-message flex items-center justify-between gap-3 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 wrap-anywhere">{preflight.result.message}</span>
          </div>
          {status === 'unknown' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="create-hosted-review-retry shrink-0 bg-background text-foreground"
              disabled={busy || preparing}
              onClick={retryPreparation}
            >
              重新检查
            </Button>
          )}
        </output>
      )}
    </div>
  )
}
