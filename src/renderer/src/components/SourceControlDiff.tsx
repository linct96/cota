import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Ellipsis,
  ExternalLink,
  FoldVertical,
  Rows2,
} from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { gitFileKey, type GitDiff, type GitDiffSelection } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { useWorkspace } from '../store'
import { useRightPanel } from '../lib/right-panel-store'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { ButtonGroup } from './ui/button-group'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import type { GitDiffEditorHandle } from './GitDiffEditor'

const DiffEditor = lazy(() => import('./GitDiffEditor'))

export function SourceControlDiff({
  workspace,
  active,
  selection: file,
}: {
  workspace: ProjectWorkspace
  active: boolean
  selection?: GitDiffSelection
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const opener = useWorkspace((state) =>
    state.preferences.openWith.find((entry) => entry.id !== 'finder'),
  )
  const worktreePath = useWorkspace(
    (state) => state.worktreeRecords.find((record) => record.id === workspace.worktreeId)?.path,
  )
  const [result, setResult] = useState<{ key: string; diff: GitDiff }>()
  const [stats, setStats] = useState<{ key: string; additions: number; deletions: number }>()
  const [error, setError] = useState<string>()
  const [sideBySide, setSideBySide] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const [showWhitespace, setShowWhitespace] = useState(false)
  const editor = useRef<GitDiffEditorHandle>(null)
  const [refresh, setRefresh] = useState(0)
  const panelOpen = useRightPanel((state) => state.open)
  const selection = file || session.selection
  const target = { projectPath: workspace.projectPath, workspaceId: workspace.id }
  const key = selection ? `${workspace.id}:${gitFileKey(selection)}` : ''
  const onStatsChange = useCallback(
    (stats: { additions: number; deletions: number }) => setStats({ key, ...stats }),
    [key],
  )

  useSourceControlWatch(
    target,
    active && !file && !panelOpen && !!selection && selection.area !== 'review',
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
  const rootPath = session.status?.rootPath || worktreePath || workspace.projectPath
  const fullPath = `${rootPath.replace(/[\\/]$/, '')}/${selection.path}`
  return (
    <section
      id={file ? undefined : `source-control-panel-${workspace.id}`}
      role={file ? undefined : 'tabpanel'}
      tabIndex={file ? undefined : 0}
      aria-labelledby={file ? undefined : `source-control-tab-${workspace.id}`}
      className="source-control-diff flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header className="source-control-diff-header flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="source-control-diff-heading flex min-w-0 flex-1 items-center gap-2">
          <h2 className="source-control-diff-path truncate text-xs font-medium" title={fullPath}>
            {fullPath}
          </h2>
          {!error && current?.kind === 'text' && stats?.key === key && (
            <span
              className="source-control-diff-stats flex shrink-0 items-center gap-1.5 text-xs tabular-nums"
              aria-label={`新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
            >
              <span className="source-control-file-additions">+{stats.additions}</span>
              <span className="source-control-file-deletions">-{stats.deletions}</span>
            </span>
          )}
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
        <div className="source-control-diff-actions flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="source-control-diff-previous"
            title="上一个变更"
            aria-label="上一个变更"
            disabled={!!error || !current || current.kind !== 'text'}
            onClick={() => editor.current?.goToDiff('previous')}
          >
            <ChevronUp className="source-control-diff-previous-icon" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="source-control-diff-next"
            title="下一个变更"
            aria-label="下一个变更"
            disabled={!!error || !current || current.kind !== 'text'}
            onClick={() => editor.current?.goToDiff('next')}
          >
            <ChevronDown className="source-control-diff-next-icon" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="source-control-diff-collapse"
            title="折叠未改动行"
            aria-label="折叠未改动行"
            disabled={!!error || !current || current.kind !== 'text'}
            onClick={() => editor.current?.collapseUnchangedRegions()}
          >
            <FoldVertical className="source-control-diff-collapse-icon" />
          </Button>
        </div>
        <ButtonGroup className="source-control-diff-mode shrink-0" aria-label="Diff 显示方式">
          <Button
            variant="outline"
            size="icon-sm"
            className="source-control-diff-split"
            title="并排显示"
            aria-label="并排显示"
            aria-pressed={sideBySide}
            onClick={() => setSideBySide(true)}
          >
            <Columns2 className="source-control-diff-split-icon" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="source-control-diff-inline"
            title="行内显示"
            aria-label="行内显示"
            aria-pressed={!sideBySide}
            onClick={() => setSideBySide(false)}
          >
            <Rows2 className="source-control-diff-inline-icon" />
          </Button>
        </ButtonGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="source-control-diff-more-trigger"
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label="更多 Diff 显示选项"
            title="更多显示选项"
            disabled={!!error || !current || current.kind !== 'text'}
          >
            <Ellipsis className="source-control-diff-more-icon" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="source-control-diff-more-menu" align="end">
            <DropdownMenuGroup className="source-control-diff-display-options">
              <DropdownMenuCheckboxItem
                className="source-control-diff-word-wrap"
                checked={wordWrap}
                onCheckedChange={setWordWrap}
                closeOnClick
              >
                自动换行
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="source-control-diff-show-whitespace"
                checked={showWhitespace}
                onCheckedChange={setShowWhitespace}
                closeOnClick
              >
                显示空白
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {error ? (
        <Alert variant="destructive" className="source-control-diff-error m-3 w-auto">
          <AlertDescription className="source-control-diff-error-detail whitespace-pre-wrap break-words select-text">
            {error}
          </AlertDescription>
        </Alert>
      ) : !current ? null : current.kind === 'unavailable' ? (
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
        <Suspense fallback={null}>
          <DiffEditor
            ref={editor}
            identity={key}
            path={selection.path}
            original={current.original}
            modified={current.modified}
            sideBySide={sideBySide}
            wordWrap={wordWrap}
            showWhitespace={showWhitespace}
            onStatsChange={onStatsChange}
          />
        </Suspense>
      )}
    </section>
  )
}
