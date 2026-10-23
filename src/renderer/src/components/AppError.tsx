import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { unwrap } from '../../../shared/contracts'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import { WindowControls } from './WindowControls'
import { errorDetails } from '../lib/error-details'

export function AppError({ error }: ErrorComponentProps) {
  const [closing, setClosing] = useState(false)
  const [cleanupError, setCleanupError] = useState<string>()

  async function forceClose() {
    if (closing) return
    setClosing(true)
    setCleanupError(undefined)
    try {
      unwrap(await window.desktop.forceExitApp())
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : String(error))
    } finally {
      setClosing(false)
    }
  }

  return (
    <div
      className="app-container app-error-page flex h-full flex-col bg-muted text-foreground"
      data-platform={window.desktop.platform}
    >
      <header className="app-error-titlebar title-bar flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-center">
        <span className="app-error-app-name text-xs text-app-muted-foreground">Cota</span>
        {window.desktop.platform === 'win32' && <WindowControls />}
      </header>
      <main className="app-error-content flex min-h-0 flex-1 overflow-auto">
        <Empty className="app-error-recovery rounded-none">
          <EmptyHeader className="app-error-header">
            <EmptyMedia variant="icon" className="app-error-media">
              <TriangleAlert className="app-error-icon" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="app-error-title">
              <h1 className="app-error-heading">界面暂时无法显示</h1>
            </EmptyTitle>
            <EmptyDescription className="app-error-description">
              强制关闭会结束当前应用的所有终端及后台任务，清理完成后关闭应用。未保存的内容可能丢失。
            </EmptyDescription>
          </EmptyHeader>
          <Button
            className="app-error-exit"
            variant="destructive"
            disabled={closing}
            aria-busy={closing}
            onClick={() => void forceClose()}
          >
            {closing ? '正在清理后台任务…' : '强制关闭'}
          </Button>
          {cleanupError && (
            <Alert variant="destructive" className="app-error-cleanup-failure w-full max-w-md">
              <AlertTitle className="app-error-cleanup-title">
                后台清理失败，应用暂未关闭
              </AlertTitle>
              <AlertDescription className="app-error-cleanup-message">
                {cleanupError} 请重试强制关闭。
              </AlertDescription>
            </Alert>
          )}
          <Alert
            variant="destructive"
            className="app-error-details max-h-48 w-full max-w-md shrink-0 gap-2 overflow-auto"
          >
            <AlertTitle className="app-error-details-title">错误详情</AlertTitle>
            <AlertDescription className="app-error-alert-description">
              <pre className="app-error-message whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
                {errorDetails(error)}
              </pre>
            </AlertDescription>
          </Alert>
        </Empty>
      </main>
    </div>
  )
}
