import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AppExitProgress } from '../../../shared/contracts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'

export function ExitOverlay() {
  const [progress, setProgress] = useState<AppExitProgress | null>(null)
  const visible = useLoadingIndicator(!!progress)

  useEffect(() => window.desktop.onExitProgress(setProgress), [])

  return (
    <Dialog
      // Release immediately on failure so the error confirmation is not blocked by minimum loading time.
      open={!!progress && visible}
      onOpenChange={(open, details) => {
        if (!open) details.cancel()
      }}
    >
      <DialogContent className="app-exit-overlay" showCloseButton={false}>
        <div className="app-exit-status flex flex-col items-center gap-3 text-center">
          <LoaderCircle
            className="app-exit-spinner size-5 text-muted-foreground motion-safe:animate-spin"
            aria-hidden="true"
          />
          <DialogTitle className="app-exit-title">{progress?.title}</DialogTitle>
          <DialogDescription className="app-exit-description flex flex-col gap-1">
            <output className="app-exit-stage" aria-live="polite">
              {progress?.description}
            </output>
            {progress?.keepSessions && (
              <span className="app-exit-session-hint">
                终端、Agent 和服务继续运行，下次打开自动连接。
              </span>
            )}
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  )
}
