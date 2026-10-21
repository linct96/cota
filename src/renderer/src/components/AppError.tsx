import type { ErrorComponentProps } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import { WindowControls } from './WindowControls'

export function AppError({ error, reset }: ErrorComponentProps) {
  return (
    <div
      className="app-container app-error-page flex h-full flex-col bg-background text-foreground"
      data-platform={window.desktop.platform}
    >
      <header className="app-error-titlebar title-bar flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-center">
        <span className="app-error-app-name text-xs text-muted-foreground">Cota</span>
        {window.desktop.platform === 'win32' && <WindowControls />}
      </header>
      <main className="app-error-content flex min-h-0 flex-1 overflow-auto">
        <Empty className="app-error-recovery rounded-none">
          <EmptyHeader className="app-error-header">
            <EmptyMedia variant="icon" className="app-error-media">
              <TriangleAlert className="app-error-icon" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="app-error-title" role="heading" aria-level={1}>
              界面暂时无法显示
            </EmptyTitle>
            <EmptyDescription className="app-error-description">
              可以重试恢复界面，或退出应用。退出前会确认是否结束运行中的终端。
            </EmptyDescription>
          </EmptyHeader>
          <div className="app-error-actions flex flex-wrap justify-center gap-2">
            <Button className="app-error-retry" onClick={reset}>
              重试
            </Button>
            <Button
              className="app-error-exit"
              variant="outline"
              onClick={() => window.desktop.closeWindow()}
            >
              退出应用
            </Button>
          </div>
          <details className="app-error-details w-full max-w-md text-left text-xs text-muted-foreground">
            <summary className="app-error-details-toggle cursor-pointer py-1">错误详情</summary>
            <pre className="app-error-message mt-2 max-h-40 overflow-auto whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
        </Empty>
      </main>
    </div>
  )
}
