import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { unwrap } from '../../../../../shared/contracts'
import type { HostedReviewHistory, HostingSnapshot } from '../../../../../shared/code-hosting'
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
  const loadedSnapshot = useRef<number | undefined>(undefined)
  const loadedPages = useRef(0)
  useEffect(() => {
    // A hidden view may have discarded an in-flight page without clearing its loading state.
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(false)
    let disposed = false
    let reading = false
    async function read(page: number) {
      if (reading || !open || !active) return
      reading = true
      setLoading(true)
      setError(undefined)
      try {
        let next = unwrap(
          await window.desktop.codeHosting.history(target, snapshot.context.key, page),
        )
        // Revalidate the loaded range together so refreshing never drops pages or skips records.
        let pages = 1
        const items = [...next.items]
        while (!disposed && page === 1 && pages < loadedPages.current && next.nextPage) {
          next = unwrap(
            await window.desktop.codeHosting.history(target, snapshot.context.key, next.nextPage),
          )
          items.push(...next.items)
          pages++
        }
        if (!disposed) {
          loadedSnapshot.current = snapshot.fetchedAt
          loadedPages.current = page === 1 ? pages : loadedPages.current + 1
          setHistory((previous) => ({
            ...next,
            items: [
              ...new Map(
                [...(page === 1 ? [] : previous?.items || []), ...items].map((review) => [
                  review.number,
                  review,
                ]),
              ).values(),
            ],
          }))
        }
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
    if (loadedSnapshot.current !== snapshot.fetchedAt) void read(1)
    return () => {
      disposed = true
    }
  }, [open, active, target, snapshot.context.key, snapshot.fetchedAt])
  const items = history?.items.filter((review) => review.number !== snapshot.latestReview?.number)
  return (
    <SourceControlSection
      open={open}
      onOpenChange={onOpenChange}
      disabled={!active}
      title={
        <>
          <span className="hosted-review-history-label">历史评审记录</span>
          {!!items?.length && (
            <Badge variant="secondary" className="hosted-review-history-count">
              {items.length}
            </Badge>
          )}
        </>
      }
    >
      <div className="hosted-review-history-content min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 text-xs">
        <div className="hosted-review-history-flow flex flex-col gap-2">
          <LoadingContent pending={loading && !history} label="评审历史读取中..." showLabel>
            <div className="hosted-review-history-list flex flex-col gap-1">
              {items?.map((review) => (
                <HostedReviewItem
                  key={review.number}
                  review={review}
                  label={label}
                  disabled={disabled || loading}
                  onOpen={() => onOpen(review.number)}
                />
              ))}
              {history && !items?.length && (
                <p className="hosted-review-history-empty px-2 text-muted-foreground">
                  {history.nextPage ? '本页没有更早的记录，可继续加载。' : '暂无更早的评审记录。'}
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
              variant="project"
              className="hosted-review-history-more w-full"
              disabled={loading || !active}
              onClick={() => void load.current(error?.page || history?.nextPage || 1)}
            >
              {!error && (
                <ChevronDown
                  className="hosted-review-history-more-icon"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              )}
              {error ? '重试读取历史' : '加载更多'}
            </Button>
          )}
        </div>
      </div>
    </SourceControlSection>
  )
}
