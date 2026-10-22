import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { fileParent, type FilePreview as Preview } from '../../../shared/file-explorer'
import { useFileWatch } from '../lib/use-file-watch'
import { FileTypeIcon } from './FileTypeIcon'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'

const Editor = lazy(() => import('./FilePreviewEditor'))

export function FilePreview({
  workspace,
  path,
  active,
}: {
  workspace: ProjectWorkspace
  path: string
  active: boolean
}) {
  const [result, setResult] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [restart, setRestart] = useState(0)
  const reload = useRef<(() => void) | undefined>(undefined)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const watchError = useFileWatch(
    target,
    [fileParent(path)],
    active,
    () => reload.current?.(),
    restart,
  )

  useEffect(() => {
    if (!active) return
    let disposed = false
    let running = false
    let pending = false
    async function read() {
      if (running) {
        pending = true
        return
      }
      running = true
      setError(undefined)
      try {
        const next = unwrap(await window.desktop.readFile(target, path))
        if (!disposed) setResult(next)
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        running = false
        if (pending && !disposed) {
          pending = false
          void read()
        }
      }
    }
    reload.current = () => {
      void read()
    }
    void read()
    return () => {
      disposed = true
      reload.current = undefined
    }
  }, [active, target, path])

  return (
    <section
      id={`source-control-panel-${workspace.id}`}
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={`source-control-tab-${workspace.id}`}
      className="file-preview flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header className="file-preview-header flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2">
        <FileTypeIcon path={path} />
        <h2 className="file-preview-path min-w-0 flex-1 truncate text-xs font-medium" title={path}>
          {path}
        </h2>
        <span className="file-preview-readonly shrink-0 text-xs text-app-muted-foreground">
          只读
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="file-preview-refresh"
          aria-label="刷新文件并重新连接监听"
          title="刷新文件"
          onClick={() => {
            reload.current?.()
            setRestart((value) => value + 1)
          }}
        >
          <RefreshCw className="file-preview-refresh-icon" />
        </Button>
      </header>
      {watchError && (
        <Alert className="file-preview-watch-error m-3 w-auto">
          <AlertDescription className="file-preview-watch-error-description">
            {watchError}
          </AlertDescription>
        </Alert>
      )}
      {error ? (
        <Alert variant="destructive" className="file-preview-error m-3 w-auto">
          <AlertDescription className="file-preview-error-description">
            {error} 请刷新或重新选择文件。
          </AlertDescription>
        </Alert>
      ) : result?.kind === 'text' ? (
        <Suspense
          fallback={
            <output className="file-preview-editor-loading p-4 text-app-muted-foreground">
              正在加载预览…
            </output>
          }
        >
          <Editor identity={`${workspace.id}:${path}`} path={path} text={result.content} />
        </Suspense>
      ) : result ? (
        <Empty className="file-preview-unavailable rounded-none">
          <EmptyHeader className="file-preview-unavailable-header">
            <EmptyTitle className="file-preview-unavailable-title">
              {result.kind === 'link' ? '符号链接' : '无法预览'}
            </EmptyTitle>
            <EmptyDescription className="file-preview-unavailable-description break-all">
              {result.kind === 'link'
                ? `链接目标：${result.target}。为避免越界读取，不跟随链接。`
                : result.reason}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <output className="file-preview-loading p-4 text-app-muted-foreground">
          正在读取文件…
        </output>
      )}
    </section>
  )
}
