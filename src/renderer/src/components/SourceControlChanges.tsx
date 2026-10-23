import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  ChevronRight,
  ExternalLink,
  FoldVertical,
  LoaderCircle,
  UnfoldVertical,
} from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { gitFileKey, type GitArea, type GitChange } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { useRightPanel } from '../lib/right-panel-store'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { useWorkspace } from '../store'
import { preferredWorkspaceOpener } from '../../../shared/open-with'
import { SourceControlDiff } from './SourceControlDiff'
import {
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  GitDiffOptions,
  type DiffDisplayOptions,
} from './GitDiffOptions'
import { FileTypeIcon } from './FileTypeIcon'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Separator } from './ui/separator'

const areaLabels: Record<GitArea, string> = {
  conflict: '合并冲突',
  staged: '已暂存',
  unstaged: '未暂存',
  untracked: '未跟踪',
}

const ChangeFile = memo(function ChangeFile({
  workspace,
  entry,
  active,
  scrollRoot,
  open,
  onOpenChange,
  options,
  onReady,
}: {
  workspace: ProjectWorkspace
  entry: GitChange
  active: boolean
  scrollRoot: RefObject<HTMLDivElement | null>
  open: boolean
  onOpenChange: (key: string, open: boolean) => void
  options: DiffDisplayOptions
  onReady: () => void
}) {
  const section = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(128)
  const [nearViewport, setNearViewport] = useState(false)
  const [focused, setFocused] = useState(false)
  const stats = entry.stats
  const renderDiff = active && (nearViewport || focused)
  const status = entry.status === '?' ? 'U' : entry.status
  const statusLabel = `${areaLabels[entry.area]}，${status}`

  useEffect(() => {
    if (!section.current) return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '800px 0px',
    })
    observer.observe(section.current)
    const sizeObserver = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height > 0) setBodyHeight(entry.contentRect.height)
    })
    if (body.current) sizeObserver.observe(body.current)
    return () => {
      observer.disconnect()
      sizeObserver.disconnect()
    }
  }, [scrollRoot])

  return (
    <Collapsible
      ref={section}
      open={open}
      onOpenChange={(open) => onOpenChange(gitFileKey(entry), open)}
      className="source-control-all-file flex shrink-0 flex-col"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <CollapsibleTrigger
        className="source-control-all-file-trigger group/all-file sticky top-0 z-10 w-full min-w-0 justify-start px-3"
        render={<Button variant="project" />}
        title={`${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
      >
        <ChevronRight
          className="source-control-all-file-toggle group-aria-expanded/all-file:rotate-90"
          data-icon="inline-start"
        />
        <FileTypeIcon path={entry.path} submodule={entry.submodule} />
        <span className="source-control-all-file-path min-w-0 flex-1 truncate text-left">
          {entry.path}
        </span>
        {stats && (
          <span
            className="source-control-all-file-stats flex shrink-0 gap-1.5 tabular-nums"
            aria-label={`新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
          >
            <span className="source-control-file-additions">+{stats.additions}</span>
            <span className="source-control-file-deletions">-{stats.deletions}</span>
          </span>
        )}
        <span
          className="source-control-all-file-status ml-2 shrink-0 font-mono text-muted-foreground"
          title={statusLabel}
          aria-label={statusLabel}
        >
          {status}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="source-control-all-file-content min-w-0">
        <div ref={body} className="source-control-all-file-body min-w-0">
          {renderDiff ? (
            <SourceControlDiff
              workspace={workspace}
              active={open}
              selection={entry}
              displayOptions={options}
              placeholderHeight={bodyHeight}
              onReady={onReady}
            />
          ) : (
            <div
              className="source-control-all-file-placeholder"
              style={{ height: bodyHeight }}
              aria-hidden="true"
            />
          )}
        </div>
      </CollapsibleContent>
      <Separator className="source-control-all-file-separator" />
    </Collapsible>
  )
})

export function SourceControlChanges({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const panelOpen = useRightPanel((state) => state.open)
  const opener = useWorkspace(preferredWorkspaceOpener)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string>()
  const [options, setOptions] = useState(DEFAULT_DIFF_DISPLAY_OPTIONS)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const setFileOpen = useCallback((key: string, open: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (open) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const [hasLoadedDiff, setHasLoadedDiff] = useState(false)
  const markReady = useCallback(() => setHasLoadedDiff(true), [])
  const scrollRoot = useRef<HTMLDivElement>(null)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )

  useSourceControlWatch(target, active && !panelOpen, () => setRefresh((value) => value + 1))
  useEffect(() => {
    if (!active || panelOpen) return
    let disposed = false
    window.desktop
      .gitStatus(target)
      .then(unwrap)
      .then((status) => {
        if (disposed) return
        useSourceControl.getState().update(workspace.id, { status, refreshed: Date.now() })
        setError(undefined)
      })
      .catch((error) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [active, panelOpen, refresh, workspace.id, target])

  const entries = session.status?.entries || []
  const stats = entries.reduce(
    (total, entry) => ({
      additions: total.additions + (entry.stats?.additions ?? 0),
      deletions: total.deletions + (entry.stats?.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  )
  const allCollapsed =
    entries.length > 0 && entries.every((entry) => collapsed.has(gitFileKey(entry)))
  const pending =
    !error && (!session.status || (!!entries.length && !allCollapsed && !hasLoadedDiff))
  const loading = useLoadingIndicator(pending)
  const busy = pending || loading
  return (
    <section className="source-control-all-changes relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {loading && (
        <output
          className="source-control-all-loading absolute inset-0 z-20 flex items-center justify-center"
          aria-label="正在加载全部变更"
        >
          <LoaderCircle
            className="source-control-all-loading-icon size-5 motion-safe:animate-spin"
            aria-hidden="true"
          />
        </output>
      )}
      <header
        inert={busy}
        className="source-control-all-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        <span className="source-control-all-count flex flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {entries.length} 项变更
          {entries.length > 0 && (
            <span
              className="source-control-all-stats inline-flex shrink-0 gap-1.5 tabular-nums"
              aria-label={`共新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
              title="汇总各项变更的文本行数，不含二进制及未提供统计的文件"
            >
              <span className="source-control-file-additions">+{stats.additions}</span>
              <span className="source-control-file-deletions">-{stats.deletions}</span>
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="source-control-all-toggle"
          disabled={!entries.length}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(entries.map(gitFileKey)))}
        >
          {allCollapsed ? (
            <UnfoldVertical className="source-control-all-expand-icon" data-icon="inline-start" />
          ) : (
            <FoldVertical className="source-control-all-collapse-icon" data-icon="inline-start" />
          )}
          {allCollapsed ? '全部展开' : '全部折叠'}
        </Button>
        {opener && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="source-control-all-open-editor"
            aria-label={`在 ${opener.name} 打开工作区`}
            title={`在 ${opener.name} 打开工作区`}
            onClick={() => {
              void window.desktop
                .openWorkspaceWith(target, opener.id)
                .then(unwrap)
                .catch((error) => setError(error instanceof Error ? error.message : String(error)))
            }}
          >
            <ExternalLink className="source-control-all-open-editor-icon" />
          </Button>
        )}
        <GitDiffOptions value={options} onChange={setOptions} disabled={!entries.length} />
      </header>
      <div
        ref={scrollRoot}
        id={`source-control-changes-panel-${workspace.id}`}
        role="tabpanel"
        aria-labelledby={`source-control-changes-tab-${workspace.id}`}
        aria-busy={busy}
        inert={busy}
        style={{ opacity: busy ? 0 : undefined }}
        tabIndex={0}
        className="source-control-all-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {error && (
          <Alert variant="destructive" className="source-control-all-error m-3 w-auto">
            <AlertDescription className="source-control-all-error-detail whitespace-pre-wrap break-words select-text">
              {error}
            </AlertDescription>
          </Alert>
        )}
        {session.status && !entries.length && (
          <Empty className="source-control-all-empty">
            <EmptyHeader className="source-control-all-empty-header">
              <EmptyTitle className="source-control-all-empty-title">工作区干净</EmptyTitle>
              <EmptyDescription className="source-control-all-empty-description">
                没有未提交的更改。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {entries.map((entry) => {
          const key = gitFileKey(entry)
          return (
            <ChangeFile
              key={key}
              workspace={workspace}
              entry={entry}
              active={active}
              scrollRoot={scrollRoot}
              open={!collapsed.has(key)}
              onOpenChange={setFileOpen}
              options={options}
              onReady={markReady}
            />
          )
        })}
      </div>
    </section>
  )
}
