import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FoldVertical } from 'lucide-react'
import { unwrap } from '../../../../../shared/contracts'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import { gitFileKey } from '../../../../../shared/source-control'
import type { GitDiff, GitDiffSelection } from '../../../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { useWorkspace } from '@/state/workspace'
import { preferredWorkspaceOpener } from '../../../../../shared/open-with'
import { useRightPanel } from '@/state/right-panel-store'
import { useSourceControlWatch } from '@/features/source-control/hooks/use-source-control-watch'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LoadingContent } from '@/components/LoadingContent'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { abbreviateHomePath, cn } from '@/lib/utils'
import { scheduleGitDiff } from '@/features/source-control/lib/git-diff-loader'
import { errorDetails } from '@/lib/error-details'
import { DEFAULT_DIFF_DISPLAY_OPTIONS, GitDiffOptions } from './GitDiffOptions'
import type { DiffDisplayOptions } from './GitDiffOptions'
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
  const [conflictView, setConflictView] = useState<{ key: string; mode: 'sides' | 'working' }>()
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
  const conflictMode = conflictView?.key === key ? conflictView.mode : 'sides'
  const diffKey = selection?.area === 'conflict' ? `${key}:${conflictMode}` : key
  const onStatsChange = useCallback(
    (nextStats: { additions: number; deletions: number }) => {
      setStats({ key: diffKey, ...nextStats })
      onReady?.()
    },
    [diffKey, onReady],
  )
  const onEditorError = useCallback(
    (cause: unknown) => {
      console.error('[monaco] Diff 编辑器失败', cause)
      loadedVersion.current = ''
      setError(errorDetails(cause))
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
      .catch((cause) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : String(cause))
        onReady?.()
      })
    return () => {
      controller.abort()
    }
  }, [active, key, selection, target, statusRefresh, watchRefresh, onReady, embedded])

  if (!selection) return null
  const current = result?.key === key ? result.diff : undefined
  const conflict = current?.kind === 'conflict' ? current : undefined
  const hasText = !!current && current.kind !== 'unavailable'
  const original = conflict
    ? conflict.ours
    : current?.kind === 'text'
      ? current.original
      : undefined
  const modified = conflict
    ? conflictMode === 'sides'
      ? conflict.theirs
      : conflict.working
    : current?.kind === 'text'
      ? current.modified
      : undefined
  const originalLabel = conflict ? `Git stage 2${original === null ? '（不存在）' : ''}` : '更改前'
  const modifiedLabel = conflict
    ? `${conflictMode === 'sides' ? 'Git stage 3' : '工作区'}${modified === null ? '（不存在）' : ''}`
    : '更改后'
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
      identity={diffKey}
      embedded={embedded}
      initialHeight={placeholderHeight}
      path={selection.path}
      original={original ?? ''}
      modified={modified ?? ''}
      originalLabel={originalLabel}
      modifiedLabel={modifiedLabel}
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
            <h2
              className="source-control-diff-path truncate text-xs font-medium"
              title={abbreviateHomePath(fullPath)}
            >
              {abbreviateHomePath(fullPath)}
            </h2>
            {!error && hasText && stats?.key === diffKey && (
              <span
                className="source-control-diff-stats flex shrink-0 items-center gap-1.5 text-xs tabular-nums"
                aria-label={`新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
              >
                <span className="source-control-file-additions text-source-control-stat-added">
                  +{stats.additions}
                </span>
                <span className="source-control-file-deletions text-source-control-stat-removed">
                  -{stats.deletions}
                </span>
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
                  .catch((cause) => setError(cause.message))
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
              disabled={!!error || !hasText}
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
              disabled={!!error || !hasText}
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
              disabled={!!error || !hasText}
              onClick={() => editor.current?.collapseUnchangedRegions()}
            >
              <FoldVertical className="source-control-diff-collapse-icon" />
            </Button>
          </div>
          <GitDiffOptions value={options} onChange={setOptions} disabled={!!error || !hasText} />
        </header>
      )}
      {!error && conflict && (
        <div className="source-control-conflict-toolbar flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
          <ToggleGroup
            className="source-control-conflict-views"
            aria-label="冲突对比视图"
            variant="outline"
            size="sm"
            spacing={0}
            value={[conflictMode]}
            onValueChange={([mode]) => {
              if (mode === 'sides' || mode === 'working') setConflictView({ key, mode })
            }}
          >
            <ToggleGroupItem className="source-control-conflict-sides" value="sides">
              冲突双方
            </ToggleGroupItem>
            <ToggleGroupItem className="source-control-conflict-working" value="working">
              当前处理结果
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="source-control-conflict-labels flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="source-control-conflict-original-label">
              {sideBySide ? '左侧' : '原始侧'}：{originalLabel}
            </span>
            <span className="source-control-conflict-modified-label">
              {sideBySide ? '右侧' : '比较侧'}：{modifiedLabel}
            </span>
          </div>
        </div>
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
