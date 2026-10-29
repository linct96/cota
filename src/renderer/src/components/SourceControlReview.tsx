import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, GitCommitHorizontal } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { GitCommit, GitComparison, GitHistory } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { buildGitChangeTree } from '../lib/source-control-tree'
import { FileTypeIcon } from './FileTypeIcon'
import { SourceFileExplorer } from './SourceFileExplorer'
import { SourceControlFileStats } from './SourceControlFileStats'
import { FileTreeFile } from './ui/file-tree'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Badge } from './ui/badge'
import { SourceControlSection } from './SourceControlSection'

export function CommitList({
  commits,
  onSelect,
}: {
  commits: GitCommit[]
  onSelect: (commit: string) => void
}) {
  return (
    <div className="source-control-history-list flex min-w-0 flex-col gap-1">
      {commits.map((item) => (
        <Button
          key={item.oid}
          variant="ghost"
          className="source-control-history-commit h-auto w-full min-w-0 items-start justify-start py-1.5"
          title={item.subject}
          onClick={() => onSelect(item.oid)}
        >
          <span className="source-control-history-commit-icon-container flex h-lh shrink-0 items-center">
            <GitCommitHorizontal
              className="source-control-history-commit-icon"
              data-icon="inline-start"
            />
          </span>
          <span className="source-control-history-commit-content flex min-w-0 flex-1 flex-col gap-0.5 text-left">
            <span className="source-control-history-subject truncate">
              {item.subject || '（无提交标题）'}
            </span>
            <span className="source-control-history-metadata truncate text-app-muted-foreground">
              {item.oid.slice(0, 8)} · {item.author} ·{' '}
              <time className="source-control-history-date" dateTime={item.date}>
                {new Date(item.date).toLocaleDateString()}
              </time>
            </span>
          </span>
        </Button>
      ))}
    </div>
  )
}

export function ReviewFiles({
  workspaceId,
  comparison,
}: {
  workspaceId: string
  comparison: GitComparison
}) {
  const session = useSourceControl((state) => state.sessions[workspaceId] || EMPTY_SOURCE_CONTROL)
  const selectedDiff = session.activePinnedDiff || (session.preview ? session.selection : undefined)
  const nodes = useMemo(() => buildGitChangeTree(comparison.entries), [comparison])
  return (
    <div className="source-control-review-files flex min-w-0 flex-col gap-0.5">
      <SourceFileExplorer
        key={`${comparison.base}:${comparison.head}`}
        nodes={nodes}
        label={`${comparison.label}文件树`}
        selectedPath={
          selectedDiff?.area === 'review' &&
          selectedDiff.base === comparison.base &&
          selectedDiff.head === comparison.head
            ? selectedDiff.path
            : undefined
        }
        renderFile={(entry, name, itemProps) => {
          const selection = {
            ...entry,
            area: 'review' as const,
            base: comparison.base,
            head: comparison.head,
            label: comparison.label,
          }
          return (
            <FileTreeFile
              {...itemProps}
              path={entry.path}
              className="source-file-explorer-item source-control-review-file w-full min-w-0 justify-start gap-1.5"
              title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
              onClick={() => useSourceControl.getState().openDiff(workspaceId, selection)}
            >
              <ChevronRight
                className="source-file-explorer-chevron"
                data-visible="false"
                aria-hidden="true"
              />
              <FileTypeIcon path={entry.path} submodule={entry.submodule} />
              <span className="source-control-review-path min-w-0 flex-1 truncate text-left">
                {name}
              </span>
              <SourceControlFileStats stats={entry.stats} />
              <span className="source-control-review-status shrink-0 font-mono text-app-muted-foreground">
                {entry.status}
              </span>
            </FileTreeFile>
          )
        }}
      />
    </div>
  )
}

export function CommitHistoryContent({
  workspace,
  active,
  head,
  base,
  render,
}: {
  workspace: ProjectWorkspace
  active: boolean
  head?: string | null
  base?: string
  render?: (history: GitHistory | undefined, content: ReactNode) => ReactNode
}) {
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const [history, setHistory] = useState<GitHistory>()
  const [historyError, setHistoryError] = useState<string>()
  const [historyRetry, setHistoryRetry] = useState(0)
  const [morePending, setMorePending] = useState(false)
  const generation = useRef(0)
  const paging = useRef<number | undefined>(undefined)
  const [detailRequest, setDetailRequest] = useState({ commit: '' })
  const [details, setDetails] = useState<{
    request: typeof detailRequest
    comparison?: GitComparison
    error?: string
  }>()
  const commit = detailRequest.commit
  const detail = details?.request === detailRequest ? details : undefined
  const comparison = detail?.comparison
  const error = detail?.error || historyError
  const busy = active && (morePending || (!history && !historyError) || (!!commit && !detail))

  useEffect(() => {
    const currentGeneration = generation
    const version = ++currentGeneration.current
    // Invalidate old pages before loading a new history or comparison snapshot.
    paging.current = undefined
    // oxlint-disable-next-line react/set-state-in-effect
    setMorePending(false)
    setHistoryError(undefined)
    if (!active) return
    setHistory(undefined)
    window.desktop
      .gitHistory(target, { head: head ?? undefined, base })
      .then(unwrap)
      .then((page) => {
        if (version === generation.current) setHistory(page)
      })
      .catch((error) => {
        if (version === generation.current)
          setHistoryError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      currentGeneration.current++
    }
  }, [active, head, base, historyRetry, target])

  useEffect(() => {
    if (!active || !commit) return
    let disposed = false
    window.desktop
      .gitCompare(target, { kind: 'commit', commit })
      .then(unwrap)
      .then((next) => {
        if (!disposed) setDetails({ request: detailRequest, comparison: next })
      })
      .catch((error) => {
        if (!disposed)
          setDetails({
            request: detailRequest,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      disposed = true
    }
  }, [active, detailRequest, commit, target])

  async function loadMore() {
    if (!active || !history?.head || !history.more || paging.current !== undefined) return
    const version = generation.current
    paging.current = version
    setMorePending(true)
    setHistoryError(undefined)
    try {
      const page = unwrap(
        await window.desktop.gitHistory(target, {
          head: history.head,
          base,
          offset: history.commits.length,
        }),
      )
      if (version === generation.current)
        setHistory((current) =>
          current?.head === page.head
            ? { ...page, commits: [...current.commits, ...page.commits] }
            : current,
        )
    } catch (error) {
      if (version === generation.current)
        setHistoryError(error instanceof Error ? error.message : String(error))
    } finally {
      if (paging.current === version) {
        paging.current = undefined
        setMorePending(false)
      }
    }
  }

  const content = (
    <div
      className="source-control-commit-history flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-busy={busy}
    >
      {commit && (
        <nav
          className="source-control-history-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
          aria-label="提交详情导航"
        >
          <Button
            variant="ghost"
            size="sm"
            className="source-control-history-back"
            onClick={() => setDetailRequest({ commit: '' })}
          >
            <ArrowLeft className="source-control-history-back-icon" data-icon="inline-start" />
            返回列表
          </Button>
          {comparison && (
            <span className="source-control-history-range min-w-0 truncate text-xs text-app-muted-foreground select-text">
              {comparison.base?.slice(0, 8) || '空树'} → {comparison.head.slice(0, 8)}
            </span>
          )}
        </nav>
      )}
      <div className="source-control-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain px-2 pt-3 pb-2">
        {error && (
          <Alert variant="destructive" className="source-control-review-error">
            <AlertDescription className="source-control-review-error-detail whitespace-pre-wrap break-words select-text">
              {error}
            </AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="source-control-history-retry"
              disabled={busy}
              onClick={() => {
                if (detail?.error) setDetailRequest({ ...detailRequest })
                else if (history) void loadMore()
                else setHistoryRetry((value) => value + 1)
              }}
            >
              重试
            </Button>
          </Alert>
        )}
        <LoadingContent
          pending={busy}
          label={
            commit ? '正在加载提交改动' : base ? '正在加载比较范围内的提交' : '正在加载提交历史'
          }
        >
          {!commit && (
            <>
              {history && !history.commits.length && (
                <Empty className="source-control-history-empty">
                  <EmptyHeader className="source-control-history-empty-header">
                    <EmptyTitle className="source-control-history-empty-title">
                      {base ? '暂无提交差异' : '暂无提交'}
                    </EmptyTitle>
                    <EmptyDescription className="source-control-history-empty-description">
                      {base ? '当前比较范围内没有新增提交。' : '完成首次提交后，历史会显示在这里。'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {!!history?.commits.length && (
                <CommitList
                  commits={history.commits}
                  onSelect={(commit) => setDetailRequest({ commit })}
                />
              )}
              {history?.more && (
                <Button
                  variant="outline"
                  size="sm"
                  className="source-control-history-more mt-2"
                  disabled={morePending}
                  onClick={() => void loadMore()}
                >
                  加载更多
                </Button>
              )}
            </>
          )}
          {comparison && (
            <>
              <p className="source-control-commit-description px-2 py-1 text-xs text-app-muted-foreground">
                {comparison.label}
              </p>
              {!comparison.entries.length && (
                <p className="source-control-comparison-empty px-2 text-xs text-app-muted-foreground">
                  此提交没有文件改动。
                </p>
              )}
              <ReviewFiles workspaceId={workspace.id} comparison={comparison} />
            </>
          )}
        </LoadingContent>
      </div>
    </div>
  )
  return render ? render(history, content) : content
}

export function ComparisonCommits({
  workspace,
  comparison,
  open,
  onOpenChange,
}: {
  workspace: ProjectWorkspace
  comparison: GitComparison
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <CommitHistoryContent
      workspace={workspace}
      active
      head={comparison.head}
      base={comparison.base ?? undefined}
      render={(history, content) => (
        <SourceControlSection
          open={open}
          onOpenChange={onOpenChange}
          title={
            <>
              <span className="source-control-comparison-commits-label">Commit 对比</span>
              {history && (
                <Badge variant="secondary" className="source-control-comparison-commits-count">
                  {history.commits.length}
                  {history.more ? '+' : ''}
                </Badge>
              )}
            </>
          }
        >
          {content}
        </SourceControlSection>
      )}
    />
  )
}
