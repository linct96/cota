import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, GitCommitHorizontal } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { GitComparison, GitHistory, GitReferences } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { buildGitChangeTree } from '../lib/source-control-tree'
import { FileTypeIcon } from './FileTypeIcon'
import { SourceFileExplorer } from './SourceFileExplorer'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Field, FieldLabel } from './ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from './ui/select'

export function SourceControlReview({
  workspace,
  active,
  references,
}: {
  workspace: ProjectWorkspace
  active: boolean
  references?: GitReferences
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const selectedDiff = session.activePinnedDiff || (session.preview ? session.selection : undefined)
  const [history, setHistory] = useState<GitHistory>()
  const [commit, setCommit] = useState('')
  const [result, setResult] = useState<{ key: string; comparison: GitComparison }>()
  const [error, setError] = useState<string>()
  const [historyError, setHistoryError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [morePending, setMorePending] = useState(false)
  const generation = useRef(0)
  const paging = useRef(false)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const mode = session.mode
  const head = session.status?.head
  const branches = references?.branches || []
  const baseRef =
    session.baseRef ||
    branches.find((entry) => entry.ref === 'refs/remotes/origin/main')?.ref ||
    branches.find((entry) => entry.ref === 'refs/heads/main')?.ref ||
    branches.find((entry) => entry.ref !== `refs/heads/${session.status?.branch}`)?.ref ||
    ''
  const comparisonKey = mode === 'history' ? `commit:${commit}` : `branch:${baseRef}:${head}`
  const comparison = !error && result?.key === comparisonKey ? result.comparison : undefined
  const nodes = useMemo(() => buildGitChangeTree(comparison?.entries || []), [comparison])

  useEffect(() => {
    const currentGeneration = generation
    const version = ++currentGeneration.current
    // Reset the previous IPC request's state before loading a new history snapshot.
    // oxlint-disable-next-line react/set-state-in-effect
    setHistoryError(undefined)
    if (!active || mode !== 'history') return
    setHistory(undefined)
    window.desktop
      .gitHistory(target, head ? { head } : {})
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
  }, [active, mode, head, target])

  const comparisonRefresh = mode === 'compare' ? session.refreshed : 0
  useEffect(() => {
    if (!active) return
    // Clear the previous IPC request's loading/error state before starting this comparison.
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
    setLoading(false)
    if ((mode === 'history' && !commit) || (mode === 'compare' && (!baseRef || !head))) return
    let disposed = false
    setLoading(true)
    window.desktop
      .gitCompare(
        target,
        mode === 'history' ? { kind: 'commit', commit } : { kind: 'branch', ref: baseRef },
      )
      .then(unwrap)
      .then((next) => {
        if (!disposed) setResult({ key: comparisonKey, comparison: next })
      })
      .catch((error) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, mode, commit, baseRef, head, comparisonRefresh, comparisonKey, target])

  async function loadMore() {
    if (!history?.head || paging.current) return
    const version = generation.current
    paging.current = true
    setMorePending(true)
    setHistoryError(undefined)
    try {
      const page = unwrap(
        await window.desktop.gitHistory(target, {
          head: history.head,
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
      paging.current = false
      setMorePending(false)
    }
  }

  return (
    <section
      className="source-control-review flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={mode === 'history' ? '提交历史' : '比较'}
      aria-busy={loading || morePending || (mode === 'history' && !history && !historyError)}
    >
      {mode === 'history' && commit && (
        <nav
          className="source-control-history-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
          aria-label="提交详情导航"
        >
          <Button
            variant="ghost"
            size="sm"
            className="source-control-history-back"
            onClick={() => setCommit('')}
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
      <div className="source-control-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-2 py-3">
        {mode === 'compare' && (
          <Field className="source-control-base-field px-1">
            <FieldLabel className="source-control-base-label" htmlFor={`base-${workspace.id}`}>
              比较基准
            </FieldLabel>
            <Select
              items={branches.map(({ ref, label }) => ({ value: ref, label }))}
              value={baseRef || null}
              disabled={!branches.length}
              onValueChange={(value) => {
                if (value) useSourceControl.getState().update(workspace.id, { baseRef: value })
              }}
            >
              <SelectTrigger
                id={`base-${workspace.id}`}
                className="source-control-base-trigger w-full min-w-0"
                aria-label="比较基准分支"
              >
                <SelectValue
                  className="source-control-base-value truncate"
                  placeholder="选择本地或远端分支"
                />
              </SelectTrigger>
              <SelectContent className="source-control-base-content">
                <SelectGroup className="source-control-base-options">
                  {branches.map(({ ref, label }) => (
                    <SelectItem key={ref} value={ref} className="source-control-base-option">
                      {ref.startsWith('refs/remotes/') ? `远端 · ${label}` : `本地 · ${label}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="source-control-base-help text-xs text-app-muted-foreground">
              仅比较共同祖先到 HEAD 的已提交改动，不含暂存区或工作文件；远端引用以最近一次 Fetch
              为准。
            </p>
          </Field>
        )}
        {(error || historyError) && (
          <Alert variant="destructive" className="source-control-review-error">
            <AlertDescription className="source-control-review-error-detail whitespace-pre-wrap break-words select-text">
              {error || historyError}
            </AlertDescription>
          </Alert>
        )}
        <LoadingContent
          pending={loading || (mode === 'history' && !commit && !history && !historyError)}
          label={mode === 'history' ? '正在加载提交历史' : '正在加载比较'}
        >
          {mode === 'history' && !commit && (
            <>
              {history && !history.commits.length && (
                <Empty className="source-control-history-empty">
                  <EmptyHeader className="source-control-history-empty-header">
                    <EmptyTitle className="source-control-history-empty-title">暂无提交</EmptyTitle>
                    <EmptyDescription className="source-control-history-empty-description">
                      完成首次提交后，历史会显示在这里。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {!!history?.commits.length && (
                <div className="source-control-history-list flex min-w-0 flex-col gap-1">
                  {history?.commits.map((item) => (
                    <Button
                      key={item.oid}
                      variant="ghost"
                      className="source-control-history-commit h-auto w-full min-w-0 items-start justify-start py-1.5"
                      title={item.subject}
                      onClick={() => setCommit(item.oid)}
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
              )}
              {history?.more && (
                <Button
                  variant="outline"
                  size="sm"
                  className="source-control-history-more"
                  disabled={morePending}
                  onClick={() => void loadMore()}
                >
                  加载更多
                </Button>
              )}
              {!!history?.commits.length && (
                <p className="source-control-history-limit px-2 text-xs text-app-muted-foreground">
                  当前 HEAD 的历史，每页 50 条，最多 10,000 条。
                </p>
              )}
            </>
          )}
          {mode === 'compare' && !head && (
            <p className="source-control-compare-unborn p-2 text-xs text-app-muted-foreground">
              当前分支还没有提交，暂不能比较。
            </p>
          )}
          {comparison && (
            <>
              {mode === 'compare' && (
                <p className="source-control-comparison-summary px-2 text-xs text-app-muted-foreground select-text">
                  {comparison.label}
                  <br className="source-control-comparison-break" />
                  {comparison.base?.slice(0, 8) || '空树'} → {comparison.head.slice(0, 8)} ·{' '}
                  {comparison.entries.length} 个文件
                </p>
              )}
              {!comparison.entries.length && (
                <p className="source-control-comparison-empty px-2 text-xs text-app-muted-foreground">
                  没有文件差异。
                </p>
              )}
              <div className="source-control-review-files flex min-w-0 flex-col gap-0.5">
                <SourceFileExplorer
                  key={comparisonKey}
                  nodes={nodes}
                  label={`${mode === 'history' ? '提交审阅' : '分支比较'}文件树`}
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
                      <Button
                        {...itemProps}
                        variant="project"
                        className="source-file-explorer-item source-control-review-file w-full min-w-0 justify-start gap-1.5"
                        title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
                        onClick={() =>
                          useSourceControl.getState().openDiff(workspace.id, selection)
                        }
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
                        <span className="source-control-review-status shrink-0 font-mono text-app-muted-foreground">
                          {entry.status}
                        </span>
                      </Button>
                    )
                  }}
                />
              </div>
            </>
          )}
        </LoadingContent>
      </div>
    </section>
  )
}
