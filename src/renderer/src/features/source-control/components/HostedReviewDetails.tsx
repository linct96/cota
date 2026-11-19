import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  GitCompareArrows,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  Upload,
} from 'lucide-react'
import type { HostedReview } from '../../../../../shared/code-hosting'
import { Button } from '@/components/ui/button'
import { HostedReviewStatus, formatReviewRelativeTime } from './HostedReviewStatus'

export function HostedReviewDetails({
  review,
  label,
  account,
  unpushed,
  targetRef,
  disabled,
  onOpen,
  onMerge,
  onCompare,
}: {
  review: HostedReview
  label: string
  account?: string
  unpushed: boolean
  targetRef?: string
  disabled: boolean
  onOpen: () => void
  onMerge: () => void
  onCompare: () => void
}) {
  const createdRel = formatReviewRelativeTime(review.createdAt)
  const endedAt = review.mergedAt || review.closedAt || review.updatedAt
  const endedRel = formatReviewRelativeTime(endedAt)
  const canMerge = review.state === 'open' && !review.draft
  const checksFailed = review.checks === 'failure'

  function renderChecksRow() {
    if (review.checks === 'success') {
      return (
        <div className="hosted-review-readiness-row flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-success">
          <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">远端检查已通过</span>
        </div>
      )
    }
    if (review.checks === 'running') {
      return (
        <div className="hosted-review-readiness-row flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-foreground">
          <LoaderCircle
            className="size-3.5 shrink-0 text-(--dot-status-working) motion-safe:animate-spin"
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">远端检查运行中…</span>
        </div>
      )
    }
    if (review.checks === 'pending') {
      return (
        <div className="hosted-review-readiness-row flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-warning">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">远端检查等待中</span>
        </div>
      )
    }
    if (review.checks === 'failure') {
      return (
        <div className="hosted-review-readiness-row flex items-center justify-between gap-2 border-t border-border px-2.5 py-2 text-xs text-destructive">
          <div className="flex min-w-0 items-center gap-2">
            <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">远端检查失败</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="hosted-review-checks-detail shrink-0"
            disabled={disabled}
            onClick={onOpen}
          >
            详情
          </Button>
        </div>
      )
    }
    if (review.checks === 'unknown') {
      return (
        <div className="hosted-review-readiness-row flex flex-col gap-1 border-t border-border px-2.5 py-2 text-xs">
          <div className="flex items-center gap-2 text-warning">
            <CircleHelp className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">检查状态未确认</span>
          </div>
          {review.checksError && (
            <output className="hosted-review-details-checks-error pl-5.5 text-2xs text-muted-foreground wrap-anywhere">
              {review.checksError}
            </output>
          )}
        </div>
      )
    }
    return (
      <div className="hosted-review-readiness-row flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">无远端检查项</span>
      </div>
    )
  }

  return (
    <article className="hosted-review-details flex min-w-0 flex-col gap-3">
      <header className="hosted-review-details-header flex min-w-0 flex-col gap-1.5">
        <div className="hosted-review-details-meta-top flex min-w-0 items-center justify-between gap-2">
          <div className="hosted-review-details-status flex min-w-0 flex-wrap items-center gap-1.5">
            <HostedReviewStatus review={review} />
            <span className="hosted-review-details-number font-mono text-2xs text-muted-foreground tabular-nums">
              #{review.number}
            </span>
            <span className="text-2xs text-muted-foreground/50" aria-hidden="true">
              ·
            </span>
            <time
              className="hosted-review-details-created-time text-2xs text-muted-foreground tabular-nums"
              dateTime={review.createdAt}
              title={`创建于 ${new Date(review.createdAt).toLocaleString()}`}
            >
              {createdRel}
            </time>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="hosted-review-details-link shrink-0"
            disabled={disabled}
            aria-label={`在网页打开 ${label} #${review.number}`}
            title={`在网页打开 ${label} #${review.number}`}
            onClick={onOpen}
          >
            <ArrowUpRight className="hosted-review-details-link-icon" aria-hidden="true" />
          </Button>
        </div>

        <h3 className="hosted-review-details-title text-sm leading-snug font-semibold wrap-anywhere select-text">
          {review.title}
        </h3>

        <p
          className="hosted-review-details-branches flex min-w-0 items-center gap-1 font-mono text-2xs text-app-muted-foreground"
          title={`${review.sourceBranch} → ${review.targetBranch}`}
        >
          <span className="hosted-review-details-source min-w-0 truncate select-text [unicode-bidi:plaintext]">
            {review.sourceBranch}
          </span>
          <ArrowRight
            className="hosted-review-details-direction size-3 shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          />
          <span className="hosted-review-details-target min-w-0 truncate text-foreground select-text [unicode-bidi:plaintext]">
            {review.targetBranch}
          </span>
        </p>
      </header>

      <section
        className="hosted-review-readiness overflow-hidden rounded-lg border border-border bg-background"
        aria-label={review.state === 'open' ? '合并就绪检查' : '评审结果'}
      >
        <div className="hosted-review-readiness-header flex items-center justify-between gap-2 bg-muted/45 px-2.5 py-1.5 text-2xs font-medium text-app-muted-foreground">
          <span>{review.state === 'open' ? '合并就绪检查' : '评审结果'}</span>
          {account && (
            <span className="hosted-review-readiness-account truncate font-mono">@{account}</span>
          )}
        </div>

        {review.state === 'open' ? (
          <>
            {unpushed ? (
              <div className="hosted-review-unpushed flex items-center justify-between gap-2 border-t border-border px-2.5 py-2 text-xs text-warning">
                <div className="flex min-w-0 items-center gap-2">
                  <Upload className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="hosted-review-unpushed-text min-w-0 truncate">
                    本地有未推送提交
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="hosted-review-compare-inline shrink-0"
                  disabled={disabled || !targetRef}
                  title={
                    !targetRef
                      ? '目标仓库的分支引用尚未获取，请先 Fetch 后再比较。'
                      : '与目标分支比较差异'
                  }
                  onClick={onCompare}
                >
                  比较
                </Button>
              </div>
            ) : (
              <div className="hosted-review-synced flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-success">
                <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">本地与远端提交一致</span>
              </div>
            )}

            {renderChecksRow()}

            {review.draft && (
              <div className="hosted-review-draft-notice flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
                <GitPullRequestDraft className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">草稿状态不可直接合并</span>
              </div>
            )}
          </>
        ) : review.state === 'merged' ? (
          <div className="hosted-review-ended flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-success">
            <GitMerge className="size-3.5 shrink-0" aria-hidden="true" />
            <span
              className="min-w-0 truncate tabular-nums"
              title={`合并于 ${new Date(endedAt).toLocaleString()}`}
            >
              已于 {endedRel} 合并到 {review.targetBranch}
            </span>
          </div>
        ) : (
          <div className="hosted-review-ended flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
            <GitPullRequestClosed className="size-3.5 shrink-0" aria-hidden="true" />
            <span
              className="min-w-0 truncate tabular-nums"
              title={`关闭于 ${new Date(endedAt).toLocaleString()}`}
            >
              已于 {endedRel} 关闭
            </span>
          </div>
        )}
      </section>

      <footer className="hosted-review-details-actions flex items-center gap-1.5">
        {canMerge ? (
          <Button
            type="button"
            variant={checksFailed ? 'outline' : 'default'}
            className="hosted-review-details-merge min-w-0 flex-1"
            disabled={disabled || !review.head}
            aria-label={`合并 ${label} #${review.number}`}
            onClick={onMerge}
          >
            <GitMerge
              className="hosted-review-details-merge-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            <span className="truncate tabular-nums">
              {checksFailed ? '忽略检查并合并' : `合并 ${label} #${review.number}`}
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="hosted-review-details-open-primary min-w-0 flex-1"
            disabled={disabled}
            onClick={onOpen}
          >
            <span className="truncate tabular-nums">在网页查看 #{review.number}</span>
            <ArrowUpRight
              className="hosted-review-details-open-icon"
              data-icon="inline-end"
              aria-hidden="true"
            />
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          className="hosted-review-compare-button shrink-0"
          disabled={disabled || !targetRef}
          title={
            !targetRef ? '目标仓库的分支引用尚未获取，请先 Fetch 后再比较。' : '与目标分支比较差异'
          }
          onClick={onCompare}
        >
          <GitCompareArrows
            className="hosted-review-compare-icon"
            data-icon="inline-start"
            aria-hidden="true"
          />
          比较
        </Button>
      </footer>
    </article>
  )
}
