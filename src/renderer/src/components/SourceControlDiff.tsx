import { lazy, Suspense, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { gitFileKey, type GitDiff } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { useWorkspace } from '../store'
import { useRightPanel } from '../lib/right-panel-store'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'

const DiffEditor = lazy(() => import('./GitDiffEditor'))
const areaLabels = {
  staged: 'HEAD → 暂存区',
  unstaged: '暂存区 → 工作文件',
  untracked: '新增文件',
  conflict: '合并冲突',
}

export function SourceControlDiff({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const opener = useWorkspace((state) =>
    state.preferences.openWith.find((entry) => entry.id !== 'finder'),
  )
  const [result, setResult] = useState<{ key: string; diff: GitDiff }>()
  const [error, setError] = useState<string>()
  const [sideBySide, setSideBySide] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const panelOpen = useRightPanel((state) => state.open)
  const selection = session.selection
  const target = { projectPath: workspace.projectPath, workspaceId: workspace.id }
  const key = selection ? `${workspace.id}:${gitFileKey(selection)}` : ''

  useSourceControlWatch(
    target,
    active && !panelOpen && !!selection && selection.area !== 'review',
    () => setRefresh((value) => value + 1),
  )

  useEffect(() => {
    if (!active || !selection) return
    let disposed = false
    setError(undefined)
    window.desktop
      .gitDiff(target, selection)
      .then(unwrap)
      .then((diff) => {
        if (!disposed) setResult({ key, diff })
      })
      .catch((error) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [
    active,
    key,
    selection?.area === 'review' ? 0 : session.refreshed,
    selection?.area === 'review' ? 0 : refresh,
  ])

  if (!selection) return null
  const current = result?.key === key ? result.diff : undefined
  return (
    <section
      id={`source-control-panel-${workspace.id}`}
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={`source-control-tab-${workspace.id}`}
      className="source-control-diff flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header className="source-control-diff-header flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="source-control-diff-heading min-w-0 flex-1">
          <h2
            className="source-control-diff-path truncate text-xs font-medium"
            title={selection.path}
          >
            {selection.path}
          </h2>
          <p className="source-control-diff-area text-xs text-muted-foreground">
            {selection.area === 'review'
              ? `${selection.label} · ${selection.base?.slice(0, 8) || '空树'} → ${selection.head.slice(0, 8)}`
              : areaLabels[selection.area]}
          </p>
        </div>
        {opener && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="source-control-open-editor"
            aria-label={`在 ${opener.name} 打开工作区`}
            title={`在 ${opener.name} 打开工作区`}
            onClick={() => {
              void window.desktop
                .openWorkspaceWith(target, opener.id)
                .then(unwrap)
                .catch((error) => setError(error.message))
            }}
          >
            <ExternalLink className="source-control-open-editor-icon" />
          </Button>
        )}
        <Tabs
          className="source-control-diff-mode"
          value={sideBySide ? 'split' : 'inline'}
          onValueChange={(value) => setSideBySide(value === 'split')}
        >
          <TabsList className="source-control-diff-mode-list" aria-label="Diff 显示方式">
            <TabsTrigger className="source-control-diff-split" value="split">
              并排
            </TabsTrigger>
            <TabsTrigger className="source-control-diff-inline" value="inline">
              行内
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      {error ? (
        <Alert variant="destructive" className="source-control-diff-error m-3 w-auto">
          <AlertDescription className="source-control-diff-error-detail whitespace-pre-wrap break-words select-text">
            {error}
          </AlertDescription>
        </Alert>
      ) : !current ? (
        <p className="source-control-diff-loading p-4 text-xs text-muted-foreground" role="status">
          正在读取文件…
        </p>
      ) : current.kind === 'unavailable' ? (
        <Empty className="source-control-diff-unavailable">
          <EmptyHeader className="source-control-diff-unavailable-header">
            <EmptyTitle className="source-control-diff-unavailable-title">
              无法显示文本 Diff
            </EmptyTitle>
            <EmptyDescription className="source-control-diff-unavailable-description">
              {current.reason}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Suspense
          fallback={
            <p
              className="source-control-editor-loading p-4 text-xs text-muted-foreground"
              role="status"
            >
              正在加载 Diff 编辑器…
            </p>
          }
        >
          <DiffEditor
            identity={key}
            path={selection.path}
            original={current.original}
            modified={current.modified}
            sideBySide={sideBySide}
          />
        </Suspense>
      )}
    </section>
  )
}
