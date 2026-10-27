import { useEffect, useMemo, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { ArrowLeft, ChevronRight, GitCommitHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { GitComparison, GitHistory, GitReferences } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { buildGitChangeTree } from '../lib/source-control-tree'
import { createBranchFormSchema } from '../lib/form-schemas'
import { FileTypeIcon } from './FileTypeIcon'
import { SourceFileExplorer } from './SourceFileExplorer'
import { FileTreeFile } from './ui/file-tree'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Field, FieldLabel, FieldGroup, FieldDescription, FieldError } from './ui/field'
import { Separator } from './ui/separator'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxInput,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from './ui/combobox'

export function SourceControlReview({
  workspace,
  active,
  references,
  pending,
  onCreateBranch,
}: {
  workspace: ProjectWorkspace
  active: boolean
  references?: GitReferences
  pending: boolean
  onCreateBranch: (name: string, head: string) => Promise<boolean>
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
  const [branchOpen, setBranchOpen] = useState(false)
  const [createError, setCreateError] = useState<string>()
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
    session.baseRef ??
    (branches.find((entry) => entry.ref === 'refs/remotes/origin/main')?.ref ||
      branches.find((entry) => entry.ref === 'refs/heads/main')?.ref ||
      branches.find((entry) => entry.ref !== `refs/heads/${session.status?.branch}`)?.ref ||
      '')
  const branchForm = useForm({
    defaultValues: { name: '' },
    validationLogic: revalidateLogic({ mode: 'submit' }),
    validators: { onDynamic: createBranchFormSchema },
    onSubmit: async ({ value }) => {
      const name = value.name.trim()
      if (!head || pending || branches.some((branch) => branch.ref === `refs/heads/${name}`)) return
      setCreateError(undefined)
      // Freeze even an empty baseline so refreshing refs cannot select the new branch implicitly.
      useSourceControl.getState().update(workspace.id, { baseRef })
      try {
        if (await onCreateBranch(name, head)) {
          setBranchOpen(false)
          toast.success(`已创建本地分支「${name}」`)
        }
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : String(error))
      }
    },
  })
  const branchSearch = useStore(branchForm.store, (state) => state.values.name)
  const branchName = branchSearch.trim()
  const creating = useStore(branchForm.store, (state) => state.isSubmitting)
  const showCreate =
    !!head &&
    !!references &&
    !!branchName &&
    !branches.some((branch) => branch.ref === `refs/heads/${branchName}`)
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
            <Combobox
              items={branches}
              value={branches.find((branch) => branch.ref === baseRef) || null}
              itemToStringLabel={(branch) => branch.label}
              disabled={!references}
              open={branchOpen}
              inputValue={branchSearch}
              onInputValueChange={(value) => {
                branchForm.setFieldValue('name', value)
                setCreateError(undefined)
              }}
              onOpenChange={(open) => {
                if (creating) return
                if (open) {
                  branchForm.reset()
                  setCreateError(undefined)
                }
                setBranchOpen(open)
              }}
              onValueChange={(branch) => {
                if (branch && !pending && !creating)
                  useSourceControl.getState().update(workspace.id, { baseRef: branch.ref })
              }}
            >
              <ComboboxTrigger
                id={`base-${workspace.id}`}
                className="source-control-base-trigger w-full min-w-0 justify-between"
                render={<Button variant="outline" size="sm" />}
                aria-label="比较基准分支"
                disabled={pending || creating}
              >
                <span className="source-control-base-value min-w-0 flex-1 truncate text-left">
                  {branches.find((branch) => branch.ref === baseRef)?.label || '选择本地或远端分支'}
                </span>
              </ComboboxTrigger>
              <ComboboxContent className="source-control-base-content flex w-(--anchor-width) flex-col">
                <form
                  className="source-control-base-form flex min-h-0 flex-col overflow-hidden"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (showCreate && !pending && !creating) void branchForm.handleSubmit()
                  }}
                >
                  <FieldGroup className="source-control-base-search shrink-0 p-1">
                    <branchForm.Field name="name">
                      {(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                        return (
                          <Field
                            className="source-control-base-search-field"
                            data-invalid={invalid}
                          >
                            <FieldLabel
                              className="source-control-base-search-label sr-only"
                              htmlFor={`base-search-${workspace.id}`}
                            >
                              搜索分支或输入新分支名
                            </FieldLabel>
                            <ComboboxInput
                              id={`base-search-${workspace.id}`}
                              className="source-control-base-search-input"
                              placeholder="搜索分支或输入新分支名…"
                              disabled={pending || creating}
                              onBlur={field.handleBlur}
                              aria-invalid={invalid}
                              aria-describedby={`base-search-error-${workspace.id}`}
                            />
                            <FieldError
                              id={`base-search-error-${workspace.id}`}
                              className="source-control-base-search-error"
                              errors={invalid ? field.state.meta.errors : []}
                            />
                          </Field>
                        )
                      }}
                    </branchForm.Field>
                  </FieldGroup>
                  <ComboboxEmpty className="source-control-base-empty">
                    没有匹配的分支
                  </ComboboxEmpty>
                  <ComboboxList className="source-control-base-options min-h-0">
                    {(branch: GitReferences['branches'][number]) => (
                      <ComboboxItem
                        key={branch.ref}
                        value={branch}
                        className="source-control-base-option"
                        title={branch.label}
                        disabled={pending || creating}
                      >
                        <span className="source-control-base-option-label min-w-0 truncate">
                          {branch.ref.startsWith('refs/remotes/') ? '远端' : '本地'} ·{' '}
                          {branch.label}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  {showCreate && (
                    <>
                      <Separator className="source-control-base-create-separator" />
                      <Field className="source-control-base-create shrink-0 gap-1 p-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="source-control-base-create-button w-full min-w-0 justify-start"
                          disabled={pending || creating}
                          aria-busy={creating}
                          title={`创建本地分支「${branchName}」`}
                          aria-describedby={`base-create-help-${workspace.id}`}
                          onClick={() => void branchForm.handleSubmit()}
                        >
                          <Plus
                            className="source-control-base-create-icon"
                            data-icon="inline-start"
                          />
                          <span className="source-control-base-create-label min-w-0 truncate">
                            {creating ? '正在创建…' : `创建本地分支「${branchName}」`}
                          </span>
                        </Button>
                        <FieldDescription
                          id={`base-create-help-${workspace.id}`}
                          className="source-control-base-create-help px-2"
                        >
                          从当前 HEAD 创建，不切换分支或比较基准。
                        </FieldDescription>
                      </Field>
                    </>
                  )}
                  {createError && (
                    <Alert
                      variant="destructive"
                      className="source-control-base-create-error shrink-0"
                    >
                      <AlertDescription className="source-control-base-create-error-detail max-h-24 overflow-auto whitespace-pre-wrap break-words select-text">
                        {createError}
                      </AlertDescription>
                    </Alert>
                  )}
                </form>
              </ComboboxContent>
            </Combobox>
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
                      <FileTreeFile
                        {...itemProps}
                        path={entry.path}
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
                      </FileTreeFile>
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
