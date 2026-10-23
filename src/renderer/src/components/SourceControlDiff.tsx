import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FoldVertical } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { gitFileKey, type GitDiff, type GitDiffSelection } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { useWorkspace } from '../store'
import { preferredWorkspaceOpener } from '../../../shared/open-with'
import { useRightPanel } from '../lib/right-panel-store'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { Button } from './ui/button'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { cn } from '../lib/utils'
import { scheduleGitDiff } from '../lib/git-diff-loader'
import { errorDetails } from '../lib/error-details'
import {
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  GitDiffOptions,
  type DiffDisplayOptions,
} from './GitDiffOptions'
import type { GitDiffEditorHandle } from './GitDiffEditor'

const DiffEditor = lazy(() => import('./GitDiffEditor'))

export function SourceControlDiff({
  workspace,
  active,
  selection: file,
  displayOptions,
  placeholderHeight = 128,
  onReady,
}: {
  workspace: ProjectWorkspace
  active: boolean
  selection?: GitDiffSelection
  displayOptions?: DiffDisplayOptions
  placeholderHeight?: number
  onReady?: () => void
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const opener = useWorkspace(preferredWorkspaceOpener)
  const worktreePath = useWorkspace(
    (state) => state.worktreeRecords.find((record) => record.id === workspace.worktreeId)?.path,
  )
  const [result, setResult] = useState<{ key: string; diff: GitDiff }>()
  const [stats, setStats] = useState<{ key: string; additions: number; deletions: number }>()
  const [error, setError] = useState<string>()
  const loadedVersion = useRef('')
  const [options, setOptions] = useState(DEFAULT_DIFF_DISPLAY_OPTIONS)
  const embedded = !!displayOptions
  const { sideBySide, wordWrap, showWhitespace } = displayOptions || options
  const editor = useRef<GitDiffEditorHandle>(null)
  const [refresh, setRefresh] = useState(0)
  const panelOpen = useRightPanel((state) => state.open)
  const selection = file || session.activePinnedDiff || session.selection
  const pinnedKey = session.activePinnedDiff
    ? encodeURIComponent(gitFileKey(session.activePinnedDiff))
    : undefined
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const key = selection ? `${workspace.id}:${gitFileKey(selection)}` : ''
  const onStatsChange = useCallback(
    (stats: { additions: number; deletions: number }) => {
      setStats({ key, ...stats })
      onReady?.()
    },
    [key, onReady],
  )
  const onEditorError = useCallback(
    (error: unknown) => {
      console.error('[monaco] Diff 编辑器失败', error)
      loadedVersion.current = ''
      setError(errorDetails(error))
      onReady?.()
    },
    [onReady],
  )

  useSourceControlWatch(
    target,
    active && !file && !panelOpen && !!selection && selection.area !== 'review',
    () => setRefresh((value) => value + 1),
  )

  const statusRefresh = selection?.area === 'review' ? 0 : session.refreshed
  const watchRefresh = selection?.area === 'review' ? 0 : refresh
  useEffect(() => {
    if (!active || !selection) return
    const version = JSON.stringify([target.projectPath, key, statusRefresh, watchRefresh])
    // Nearby collapsed files stay warm; leaving the viewport unmounts this cache.
    if (embedded && loadedVersion.current === version) return
    const controller = new AbortController()
    // An explicit reload retries IPC and clears the previous read error.
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
    scheduleGitDiff(() => window.desktop.gitDiff(target, selection), controller.signal)
      .then(unwrap)
      .then((diff) => {
        if (controller.signal.aborted) return
        loadedVersion.current = version
        setResult({ key, diff })
        if (diff.kind === 'unavailable') onReady?.()
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setError(error instanceof Error ? error.message : String(error))
        onReady?.()
      })
    return () => {
      controller.abort()
    }
  }, [active, key, selection, target, statusRefresh, watchRefresh, onReady, embedded])

  if (!selection) return null
  const current = result?.key === key ? result.diff : undefined
  const rootPath = session.status?.rootPath || worktreePath || workspace.projectPath
  const fullPath = `${rootPath.replace(/[\\/]$/, '')}/${selection.path}`
  const placeholder = (
    <div
      className="source-control-diff-placeholder shrink-0"
      style={{ height: placeholderHeight }}
      aria-hidden="true"
    />
  )
  const content = error ? (
    <Alert variant="destructive" className="source-control-diff-error m-3 w-auto">
      <AlertDescription className="source-control-diff-error-detail whitespace-pre-wrap break-words select-text">
        {error}
      </AlertDescription>
    </Alert>
  ) : !current ? (
    embedded ? (
      placeholder
    ) : null
  ) : current.kind === 'unavailable' ? (
    <Empty className="source-control-diff-unavailable">
      <EmptyHeader className="source-control-diff-unavailable-header">
        <EmptyTitle className="source-control-diff-unavailable-title">无法显示文本 Diff</EmptyTitle>
        <EmptyDescription className="source-control-diff-unavailable-description">
          {current.reason}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <DiffEditor
      ref={editor}
      identity={key}
      embedded={embedded}
      initialHeight={placeholderHeight}
      path={selection.path}
      original={current.original}
      modified={current.modified}
      sideBySide={sideBySide}
      wordWrap={wordWrap}
      showWhitespace={showWhitespace}
      onStatsChange={onStatsChange}
      onError={onEditorError}
    />
  )
  return (
    <section
      id={
        file
          ? undefined
          : pinnedKey
            ? `source-control-pinned-panel-${workspace.id}-${pinnedKey}`
            : `source-control-panel-${workspace.id}`
      }
      role={file ? undefined : 'tabpanel'}
      tabIndex={file ? undefined : 0}
      aria-labelledby={
        file
          ? undefined
          : pinnedKey
            ? `source-control-pinned-tab-${workspace.id}-${pinnedKey}`
            : `source-control-tab-${workspace.id}`
      }
      className={cn(
        'source-control-diff flex min-h-0 min-w-0 flex-col',
        embedded ? 'shrink-0' : 'flex-1 overflow-hidden',
      )}
    >
      {!embedded && (
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
          <GitDiffOptions
            value={options}
            onChange={setOptions}
            disabled={!!error || !current || current.kind !== 'text'}
          />
        </header>
      )}
      {embedded ? (
        <Suspense fallback={placeholder}>{content}</Suspense>
      ) : (
        <LoadingContent pending={!error && !current} label="正在加载变更">
          {content}
        </LoadingContent>
      )}
    </section>
  )
}
