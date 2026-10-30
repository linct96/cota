import { useEffect, useRef, useState } from 'react'
import { unwrap } from '../../../../../shared/contracts'
import { type HostedReviewHistory, type HostingSnapshot } from '../../../../../shared/code-hosting'
import { LoadingContent } from '@/components/LoadingContent'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SourceControlSection } from './SourceControlSection'
import { HostedReviewItem } from './HostedReviewItem'

export function HostedReviewHistoryPanel({
  snapshot,
  target,
  active,
  disabled,
  label,
  open,
  onOpenChange,
  onOpen,
}: {
  snapshot: HostingSnapshot
  target: { projectPath: string; workspaceId: string }
  active: boolean
  disabled: boolean
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: (number: number) => void
}) {
  const [history, setHistory] = useState<HostedReviewHistory>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; page: number }>()
  const load = useRef<(page: number) => Promise<void>>(async () => {})
  useEffect(() => {
    let disposed = false
    let reading = false
    async function read(page: number) {
      if (reading || !open || !active) return
      reading = true
      setLoading(true)
      setError(undefined)
      try {
        const next = unwrap(
          await window.desktop.codeHosting.history(target, snapshot.context.key, page),
        )
        if (!disposed)
          setHistory((previous) => ({
            ...next,
            items:
              page === 1
                ? next.items
                : [
                    ...new Map(
                      [...(previous?.items || []), ...next.items].map((review) => [
                        review.number,
                        review,
                      ]),
                    ).values(),
                  ],
          }))
      } catch (cause) {
        if (!disposed)
          setError({
            page,
            message: cause instanceof Error ? cause.message : '历史读取失败，请重试。',
          })
      } finally {
        reading = false
        if (!disposed) setLoading(false)
      }
    }
    load.current = read
    void read(1)
    return () => {
      disposed = true
    }
  }, [open, active, target, snapshot.context.key, snapshot.fetchedAt])
  return (
    <SourceControlSection
      open={open}
      onOpenChange={onOpenChange}
      disabled={!active}
      title={
        <>
          <span className="hosted-review-history-label">同名来源分支历史</span>
          {history && (
            <Badge variant="secondary" className="hosted-review-history-count">
              {history.items.length}
            </Badge>
          )}
        </>
      }
    >
      <div className="hosted-review-history-content flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 py-3 text-xs">
        <p className="hosted-review-history-note px-2 text-muted-foreground">
          包含同仓库、同名来源分支的已合并与已关闭记录；同名重建的分支也可能包含在内。
        </p>
        <LoadingContent pending={loading} label="评审历史读取中..." showLabel>
          <div className="hosted-review-history-list flex flex-col gap-1">
            {history?.items.map((review) => (
              <HostedReviewItem
                key={review.number}
                review={review}
                label={label}
                disabled={disabled || loading}
                onOpen={() => onOpen(review.number)}
              />
            ))}
            {history && !history.items.length && (
              <p className="hosted-review-history-empty px-2 text-muted-foreground">
                {history.nextPage ? '本页没有匹配记录，可继续加载。' : '暂无匹配的历史记录。'}
              </p>
            )}
          </div>
        </LoadingContent>
        {error && (
          <Alert variant="destructive" className="hosted-review-history-error">
            <AlertDescription className="hosted-review-history-error-description">
              {error.message}
            </AlertDescription>
          </Alert>
        )}
        {(error || history?.nextPage) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hosted-review-history-more self-start"
            disabled={loading || !active}
            onClick={() => void load.current(error?.page || history?.nextPage || 1)}
          >
            {error ? '重试读取历史' : '加载更多'}
          </Button>
        )}
      </div>
    </SourceControlSection>
  )
}
