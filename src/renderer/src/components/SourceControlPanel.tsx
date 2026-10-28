import { useEffect, useMemo, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Upload,
  CloudDownload,
  FileDiff,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  LoaderCircle,
  Square,
  Undo2,
} from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import {
  gitFileKey,
  type GitArea,
  type GitChange,
  type GitMutation,
  type GitReferences,
} from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { createSourceControlRefreshQueue } from '../lib/source-control-refresh'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { useCommitMessageGeneration } from '../lib/use-commit-message-generation'
import { commitMessageFormSchema } from '../lib/form-schemas'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { buildGitChangeTree } from '../lib/source-control-tree'
import { cn } from '../lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from './ui/field'
import { Alert, AlertDescription } from './ui/alert'
import { Separator } from './ui/separator'
import { Textarea } from './ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { SourceControlBranchPicker } from './SourceControlBranchPicker'
import { SourceControlReview } from './SourceControlReview'
import { SourceFileExplorer } from './SourceFileExplorer'
import { FileTreeActions, FileTreeFile } from './ui/file-tree'
import { FileTypeIcon } from './FileTypeIcon'

const groups: { area: GitArea; label: string }[] = [
  { area: 'conflict', label: '合并冲突' },
  { area: 'staged', label: '已暂存' },
  { area: 'unstaged', label: '未暂存' },
  { area: 'untracked', label: '未跟踪' },
]
const labels: Record<string, string> = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '重命名',
  C: '复制',
  T: '类型变更',
  '?': '未跟踪',
}

export function SourceControlPanel({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const update = useSourceControl((state) => state.update)
  const selectedDiff = session.activePinnedDiff || (session.preview ? session.selection : undefined)
  const [error, setError] = useState<string>()
  const [readError, setReadError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const syncLoading = useLoadingIndicator(syncing)
  const [messageExpanded, setMessageExpanded] = useState(false)
  const [references, setReferences] = useState<GitReferences>()
  const [referencesError, setReferencesError] = useState<string>()
  const [dialogError, setDialogError] = useState<string>()
  const currentError = error || readError || referencesError
  useEffect(() => {
    // Preserve asynchronous IPC errors in the dismissible dialog until the user closes it.
    // oxlint-disable-next-line react/set-state-in-effect
    if (currentError) setDialogError(currentError)
  }, [currentError])
  const readTask = useRef<Promise<void> | undefined>(undefined)
  const writing = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const status = session.status
  const changeGroups = useMemo(
    () =>
      groups.map((group) => {
        const entries = (status?.entries || []).filter((entry) => entry.area === group.area)
        return { ...group, entries, nodes: buildGitChangeTree(entries) }
      }),
    [status?.entries],
  )
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const form = useForm({
    defaultValues: { message: session.draft },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: commitMessageFormSchema },
    onSubmitMeta: { push: false },
    onSubmit: async ({ value, meta }) => {
      if (
        !value.message.trim() ||
        !status ||
        !status.entries.some((entry) => entry.area === 'staged') ||
        status.entries.some((entry) => entry.area === 'conflict')
      )
        return
      const message = value.message.trim()
      form.setFieldValue('message', message)
      update(workspace.id, { draft: message })
      const committed = await mutate({
        ...target,
        action: 'commit',
        message,
        indexVersion: status.indexVersion,
      })
      if (!committed || !meta.push || !mounted.current) return
      const current = useSourceControl.getState().sessions[workspace.id]?.status
      if (
        !current?.head ||
        !current.branch ||
        current.branch !== status.branch ||
        current.tracking?.remote !== status.tracking?.remote ||
        current.tracking?.branch !== status.tracking?.branch ||
        current.upstream !== status.upstream
      ) {
        setError('提交已成功，但未能确认最新分支或上游状态，未执行推送。请刷新后重试推送。')
        return
      }
      const identity = { ...target, branch: current.branch, head: current.head }
      const pushed = await mutate(
        current.tracking
          ? { ...identity, action: 'push', tracking: current.tracking }
          : { ...identity, action: 'publish', remote: selectedRemote },
      )
      if (mounted.current) {
        if (pushed) toast.success('提交并推送成功', { description: workspace.name })
        else toast.warning('提交已成功，未完成推送。', { description: workspace.name })
      }
    },
  })
  const generation = useCommitMessageGeneration(target)

  async function refresh() {
    if (writing.current) return
    try {
      const next = unwrap(await window.desktop.gitStatus(target))
      if (!mounted.current) return
      update(workspace.id, { status: next, refreshed: Date.now() })
      setReadError(undefined)
    } catch (error) {
      if (mounted.current) {
        update(workspace.id, { status: undefined })
        setReadError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  // Queue initialization stores callbacks; refs are only read when the queue runs.
  // oxlint-disable-next-line react/refs
  const [refreshQueue] = useState(() =>
    createSourceControlRefreshQueue(
      () => (readTask.current = refresh()),
      () => mounted.current && activeRef.current && !document.hidden && !writing.current,
    ),
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      refreshQueue.cancel()
    }
  }, [refreshQueue])
  useEffect(() => () => refreshQueue.cancel(), [active, refreshQueue])
  useSourceControlWatch(target, active, refreshQueue.request)

  useEffect(() => {
    if (!active) return
    let disposed = false
    window.desktop
      .gitReferences(target)
      .then(unwrap)
      .then((next) => {
        if (!disposed) {
          setReferences(next)
          setReferencesError(undefined)
        }
      })
      .catch((error) => {
        if (!disposed) {
          setReferences(undefined)
          setReferencesError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      disposed = true
    }
  }, [active, target, session.refreshed])

  async function mutate(input: GitMutation) {
    if (writing.current) return false
    writing.current = true
    setPending(true)
    setSyncing(input.action === 'sync')
    setError(undefined)
    try {
      await generation.cancel()
      // Keep background reads silent without overlapping them with writes.
      await readTask.current
      if (!mounted.current) return false
      const done = unwrap(await window.desktop.gitMutate(input))
      if (
        done &&
        input.action === 'commit' &&
        useSourceControl.getState().sessions[workspace.id]?.draft === input.message
      ) {
        update(workspace.id, { draft: '' })
        if (mounted.current && form.getFieldValue('message') === input.message)
          form.reset({ message: '' })
      }
      if (!mounted.current) return false
      if (done && (input.action === 'switch-branch' || input.action === 'create-and-switch-branch'))
        update(workspace.id, {
          selection: undefined,
          preview: false,
          activePinnedDiff: undefined,
        })
      return done
    } catch (error) {
      if (input.action === 'create-branch' || input.action === 'create-and-switch-branch')
        throw error
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      // Refresh partial writes too, without hiding a commit/hook failure behind a successful status read.
      try {
        if (mounted.current) {
          const next = unwrap(await window.desktop.gitStatus(target))
          if (mounted.current) {
            update(workspace.id, { status: next, refreshed: Date.now() })
            setReadError(undefined)
          }
        }
      } catch (error) {
        if (mounted.current) {
          update(workspace.id, { status: undefined })
          setReadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        writing.current = false
        if (mounted.current) {
          setPending(false)
          setSyncing(false)
        }
        refreshQueue.flush()
      }
    }
  }

  const disabled = pending || !status
  const stageable =
    status?.entries.filter(
      (entry) => (entry.area === 'unstaged' || entry.area === 'untracked') && !entry.submodule,
    ) || []
  const filesAction = (action: 'stage' | 'unstage' | 'discard', entries: GitChange[]) =>
    void mutate({ ...target, action, files: entries.map(({ path, area }) => ({ path, area })) })
  const selectedRemote =
    references?.remotes.find((entry) => entry === status?.tracking?.remote) ||
    references?.remotes.find((entry) => entry === 'origin') ||
    references?.remotes[0] ||
    ''
  const hasTracking = !!status?.tracking
  const networkDisabled = disabled || !references
  const pushDisabled =
    networkDisabled ||
    !status?.branch ||
    (hasTracking
      ? !references?.remotes.includes(status.tracking!.remote)
      : !selectedRemote || !!status.upstream)
  const hasConflicts = status?.entries.some((entry) => entry.area === 'conflict')
  const commitDisabled =
    disabled || hasConflicts || !status?.entries.some((entry) => entry.area === 'staged')
  const syncDisabled = pushDisabled || !status?.head || !status.tracking || hasConflicts
  async function remoteAction(action: 'fetch' | 'pull' | 'push' | 'publish' | 'sync') {
    if (action === 'fetch') return mutate({ ...target, action, remote: selectedRemote })
    if (!status?.branch || !status.head) return
    const identity = { branch: status.branch, head: status.head }
    if (action === 'publish')
      return mutate({ ...target, ...identity, action, remote: selectedRemote })
    if (status.tracking)
      return mutate({ ...target, ...identity, action, tracking: status.tracking })
  }

  return (
    <section
      className="source-control-panel flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={`${workspace.name} 源代码管理`}
      aria-busy={pending || (!status && !error && !readError)}
    >
      <Tabs
        value={session.mode}
        onValueChange={(value) => {
          if (value === 'changes' || value === 'history' || value === 'compare')
            update(workspace.id, { mode: value })
        }}
        className="source-control-sections flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="source-control-header flex shrink-0 flex-col">
          <TabsList
            variant="line"
            className="source-control-section-tabs"
            aria-label="源代码管理视图"
          >
            <TabsTrigger className="source-control-changes-tab" value="changes">
              更改
            </TabsTrigger>
            <TabsTrigger className="source-control-history-tab" value="history">
              历史
            </TabsTrigger>
            <TabsTrigger className="source-control-compare-tab" value="compare">
              比较
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="changes"
          className="source-control-changes-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <nav
            className="source-control-changes-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
            aria-label="更改操作"
          >
            <Button
              variant="ghost"
              size="sm"
              className="source-control-view-all"
              disabled={disabled || !status?.entries.length}
              onClick={() => useSourceControl.getState().openChanges(workspace.id)}
            >
              <FileDiff className="source-control-view-all-icon" data-icon="inline-start" />
              查看全部变更
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="source-control-stage-all"
              disabled={disabled || !stageable.length}
              title="暂存所有未暂存和未跟踪文件，不含冲突文件与子模块"
              onClick={() => filesAction('stage', stageable)}
            >
              <Plus className="source-control-stage-all-icon" data-icon="inline-start" />
              暂存全部
            </Button>
          </nav>
          <div className="source-control-files min-h-0 flex-1 overflow-auto px-2 py-2">
            {status && status.entries.length === 0 && (
              <Empty className="source-control-clean">
                <EmptyHeader className="source-control-clean-header">
                  <EmptyMedia variant="icon" className="source-control-clean-media">
                    <Check className="source-control-clean-icon" />
                  </EmptyMedia>
                  <EmptyTitle className="source-control-clean-title">工作区干净</EmptyTitle>
                  <EmptyDescription className="source-control-clean-description">
                    没有未提交的更改。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {changeGroups.map(({ area, label, entries, nodes }) => {
              if (!entries.length) return null
              const targets = entries.filter((entry) => !entry.submodule)
              return (
                <Collapsible defaultOpen key={area} className="source-control-group mb-2">
                  <div className="source-control-group-header flex items-center gap-1 px-1 py-1">
                    <CollapsibleTrigger className="source-control-group-trigger group/source-control-group flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium">
                      <ChevronRight
                        className="source-control-group-toggle-icon size-3 shrink-0 group-aria-expanded/source-control-group:rotate-90"
                        aria-hidden="true"
                      />
                      <span className="source-control-group-label">{label}</span>
                      <Badge variant="secondary" className="source-control-group-count">
                        {entries.length}
                      </Badge>
                    </CollapsibleTrigger>
                    {(area === 'unstaged' || area === 'untracked') && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="source-control-group-discard"
                        aria-label={`放弃 ${targets.length} 个${label}文件的更改`}
                        title="放弃该组全部更改（需确认）"
                        disabled={disabled || !targets.length}
                        onClick={() => filesAction('discard', targets)}
                      >
                        <Undo2 className="source-control-discard-icon" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="source-control-group-stage"
                      aria-label={`${area === 'staged' ? '取消暂存' : '暂存'}${targets.length} 个${label}文件`}
                      title={
                        area === 'staged'
                          ? '取消暂存该组全部文件'
                          : area === 'conflict'
                            ? '暂存以标记已解决'
                            : '暂存该组全部文件'
                      }
                      disabled={disabled || !targets.length}
                      onClick={() => filesAction(area === 'staged' ? 'unstage' : 'stage', targets)}
                    >
                      {area === 'staged' ? (
                        <Minus className="source-control-unstage-icon" />
                      ) : (
                        <Plus className="source-control-stage-icon" />
                      )}
                    </Button>
                  </div>
                  <CollapsibleContent className="source-control-group-files flex flex-col gap-0.5">
                    <SourceFileExplorer
                      nodes={nodes}
                      label={`${label}文件树`}
                      selectedPath={selectedDiff?.area === area ? selectedDiff.path : undefined}
                      renderDirectoryActions={(directoryEntries, path) => {
                        const targets = directoryEntries.filter((entry) => !entry.submodule)
                        return (
                          <>
                            {(area === 'unstaged' || area === 'untracked') && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="source-control-directory-discard"
                                aria-label={`放弃 ${path} 下 ${targets.length} 个${label}文件的更改`}
                                title="放弃该目录及子目录的更改（需确认）"
                                disabled={disabled || !targets.length}
                                onClick={() => filesAction('discard', targets)}
                              >
                                <Undo2 className="source-control-directory-discard-icon" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="source-control-directory-stage"
                              aria-label={`${area === 'staged' ? '取消暂存' : '暂存'} ${path} 下 ${targets.length} 个${label}文件`}
                              title={
                                area === 'staged'
                                  ? '取消暂存该目录及子目录的文件'
                                  : area === 'conflict'
                                    ? '暂存该目录及子目录的文件以标记已解决'
                                    : '暂存该目录及子目录的文件'
                              }
                              disabled={disabled || !targets.length}
                              onClick={() =>
                                filesAction(area === 'staged' ? 'unstage' : 'stage', targets)
                              }
                            >
                              {area === 'staged' ? (
                                <Minus className="source-control-directory-unstage-icon" />
                              ) : (
                                <Plus className="source-control-directory-stage-icon" />
                              )}
                            </Button>
                          </>
                        )
                      }}
                      renderFile={(entry, name, itemProps) => {
                        const key = gitFileKey(entry)
                        return (
                          <div
                            key={key}
                            className="source-control-file-row flex min-w-0 items-center gap-1 pr-1"
                            data-selected={selectedDiff && gitFileKey(selectedDiff) === key}
                          >
                            <FileTreeFile
                              {...itemProps}
                              path={entry.path}
                              className="source-file-explorer-item source-control-file-open min-w-0 flex-1 justify-start gap-1.5"
                              title={`${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
                              onClick={() =>
                                useSourceControl.getState().openDiff(workspace.id, {
                                  path: entry.path,
                                  area: entry.area,
                                })
                              }
                            >
                              <ChevronRight
                                className="source-file-explorer-chevron"
                                data-visible="false"
                                aria-hidden="true"
                              />
                              <FileTypeIcon path={entry.path} submodule={entry.submodule} />
                              <span className="source-control-file-path min-w-0 flex-1 truncate text-left">
                                {name}
                              </span>
                              {entry.submodule && (
                                <span className="source-control-submodule text-app-muted-foreground">
                                  子模块
                                </span>
                              )}
                            </FileTreeFile>
                            <FileTreeActions className="source-control-file-trailing grid items-center">
                              <div className="source-control-file-summary flex items-center justify-end gap-1.5">
                                <span
                                  className="source-control-file-stats"
                                  aria-label={
                                    entry.stats
                                      ? `新增 ${entry.stats.additions} 行，删除 ${entry.stats.deletions} 行`
                                      : entry.stats === null
                                        ? '二进制文件'
                                        : '行数统计暂不可用'
                                  }
                                  title={entry.stats === undefined ? '行数统计暂不可用' : undefined}
                                >
                                  {entry.stats ? (
                                    <>
                                      {entry.stats.additions > 0 && (
                                        <span className="source-control-file-additions">
                                          +{entry.stats.additions}
                                        </span>
                                      )}
                                      {entry.stats.deletions > 0 && (
                                        <span className="source-control-file-deletions">
                                          -{entry.stats.deletions}
                                        </span>
                                      )}
                                    </>
                                  ) : entry.stats === null ? (
                                    '二进制'
                                  ) : (
                                    '—'
                                  )}
                                </span>
                                <span
                                  className="source-control-file-status shrink-0 font-mono text-app-muted-foreground"
                                  aria-label={labels[entry.status] || '冲突'}
                                  title={labels[entry.status] || '冲突'}
                                >
                                  {entry.status === '?' ? 'U' : entry.status}
                                </span>
                              </div>
                              <div className="source-control-file-actions flex items-center gap-0.5">
                                {(area === 'unstaged' || area === 'untracked') && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="source-control-file-discard"
                                    aria-label={`放弃 ${entry.path} 的更改`}
                                    title="放弃更改（需确认）"
                                    disabled={disabled || entry.submodule}
                                    onClick={() => filesAction('discard', [entry])}
                                  >
                                    <Undo2 className="source-control-file-discard-icon" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="source-control-file-stage"
                                  aria-label={`${area === 'staged' ? '取消暂存' : '添加暂存'} ${entry.path}`}
                                  title={area === 'staged' ? '取消暂存' : '添加暂存'}
                                  disabled={disabled || entry.submodule}
                                  onClick={() =>
                                    filesAction(area === 'staged' ? 'unstage' : 'stage', [entry])
                                  }
                                >
                                  {area === 'staged' ? (
                                    <Minus className="source-control-file-unstage-icon" />
                                  ) : (
                                    <Plus className="source-control-file-stage-icon" />
                                  )}
                                </Button>
                              </div>
                            </FileTreeActions>
                          </div>
                        )
                      }}
                    />
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
          <div className="source-control-context">
            <div className="source-control-branch-row flex min-w-0 items-center justify-between gap-1">
              {status && (
                <>
                  <SourceControlBranchPicker
                    status={status}
                    references={references}
                    pending={pending}
                    onSwitch={(ref) => {
                      void mutate({
                        ...target,
                        action: 'switch-branch',
                        ref,
                        branch: status.branch,
                        head: status.head,
                      })
                    }}
                    onCreate={(name) =>
                      status.head
                        ? mutate({
                            ...target,
                            action: 'create-and-switch-branch',
                            name,
                            branch: status.branch,
                            head: status.head,
                          })
                        : Promise.resolve(false)
                    }
                  />
                  <ButtonGroup
                    className="source-control-network-buttons shrink-0"
                    aria-label="远端操作"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="source-control-sync"
                      disabled={syncDisabled || syncLoading}
                      aria-busy={syncing || syncLoading}
                      aria-label={syncing || syncLoading ? '正在同步' : undefined}
                      onClick={() => void remoteAction('sync')}
                    >
                      <RefreshCw
                        className={cn(
                          'source-control-sync-icon',
                          syncLoading && 'motion-safe:animate-spin',
                        )}
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      同步
                      {status.upstream && (status.ahead > 0 || status.behind > 0) && (
                        <span className="source-control-sync-counts flex shrink-0 items-center gap-0.5 tabular-nums">
                          {status.ahead > 0 && (
                            <>
                              <ArrowUp className="source-control-ahead-icon" aria-hidden="true" />
                              {status.ahead}
                            </>
                          )}
                          {status.behind > 0 && (
                            <>
                              <ArrowDown
                                className="source-control-behind-icon"
                                aria-hidden="true"
                              />
                              {status.behind}
                            </>
                          )}
                        </span>
                      )}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="source-control-network-menu-trigger"
                        render={<Button variant="outline" size="icon-sm" />}
                        aria-label="更多远端操作"
                        disabled={disabled}
                      >
                        <ChevronDown className="source-control-network-menu-icon" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="source-control-network-menu" align="end">
                        <DropdownMenuGroup className="source-control-network-menu-actions">
                          <DropdownMenuItem
                            className="source-control-pull"
                            disabled={syncDisabled}
                            title={
                              hasConflicts
                                ? '请先解决现有合并冲突。'
                                : '从上游拉取，仅允许快进，不自动 stash；本地更改可能被覆盖时由 Git 拒绝合并。'
                            }
                            onClick={() => void remoteAction('pull')}
                          >
                            <ArrowDown className="source-control-pull-icon" />
                            拉取
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="source-control-push"
                            disabled={pushDisabled || !status.head}
                            title={
                              status.tracking
                                ? `推送至 ${status.tracking.remote}/${status.tracking.branch}`
                                : `发布到 ${selectedRemote}/${status.branch || ''}`
                            }
                            onClick={() => void remoteAction(hasTracking ? 'push' : 'publish')}
                          >
                            <Upload className="source-control-push-icon" />
                            {hasTracking ? '推送' : '发布分支'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="source-control-fetch"
                            disabled={networkDisabled || !selectedRemote}
                            title={`从 ${selectedRemote || '远端'} 获取分支，不改工作文件`}
                            onClick={() => void remoteAction('fetch')}
                          >
                            <CloudDownload className="source-control-fetch-icon" />
                            Fetch
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>
                </>
              )}
            </div>
          </div>
        </TabsContent>
        {session.mode !== 'changes' && (
          <TabsContent
            value={session.mode}
            className="source-control-review-content flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <SourceControlReview
              workspace={workspace}
              active={active}
              references={references}
              pending={pending}
              onCreateBranch={(name, head) =>
                mutate({ ...target, action: 'create-branch', name, head })
              }
            />
          </TabsContent>
        )}
        {session.mode === 'changes' && (
          <>
            <Separator className="source-control-commit-separator" />
            <Collapsible
              className="source-control-commit flex shrink-0 flex-col gap-2 px-2 py-1.5"
              open={messageExpanded}
              onOpenChange={setMessageExpanded}
              render={
                <form
                  className="source-control-commit-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    void form.handleSubmit()
                  }}
                />
              }
            >
              <CollapsibleContent className="source-control-commit-content" keepMounted>
                <FieldGroup className="source-control-commit-fields">
                  <form.Field name="message">
                    {(field) => {
                      const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field
                          className="source-control-commit-field"
                          data-disabled={pending}
                          data-invalid={invalid}
                        >
                          <FieldLabel
                            className="source-control-commit-label sr-only"
                            htmlFor={`commit-${workspace.id}`}
                          >
                            提交信息
                          </FieldLabel>
                          <Textarea
                            id={`commit-${workspace.id}`}
                            name={field.name}
                            aria-label="提交信息"
                            className="source-control-commit-message max-h-32 select-text"
                            placeholder="描述本次更改…"
                            maxLength={20000}
                            value={field.state.value}
                            aria-invalid={invalid}
                            aria-describedby={`commit-description-${workspace.id}${invalid ? ` commit-error-${workspace.id}` : ''}`}
                            disabled={pending}
                            onBlur={field.handleBlur}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              update(workspace.id, { draft: event.target.value })
                            }}
                          />
                          <FieldDescription
                            id={`commit-description-${workspace.id}`}
                            className="source-control-commit-description"
                            aria-live="polite"
                            aria-atomic="true"
                          >
                            {generation.state === 'running'
                              ? '正在使用 Pi 生成提交信息…'
                              : generation.state === 'stopping'
                                ? '正在停止生成…'
                                : '仅提交已暂存的更改。'}
                          </FieldDescription>
                          {invalid && (
                            <FieldError
                              id={`commit-error-${workspace.id}`}
                              className="source-control-commit-error"
                              errors={field.state.meta.errors}
                            />
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                </FieldGroup>
                {generation.feedback && (
                  <Alert
                    className="source-control-generation-feedback"
                    variant={generation.feedback.error ? 'destructive' : 'default'}
                  >
                    <AlertDescription className="source-control-generation-feedback-description">
                      {generation.feedback.message}
                    </AlertDescription>
                  </Alert>
                )}
              </CollapsibleContent>
              <div className="source-control-commit-actions flex min-w-0 items-center justify-between gap-1">
                <CollapsibleTrigger
                  className="source-control-commit-toggle"
                  render={<Button type="button" variant="ghost" size="icon-sm" />}
                  aria-label={messageExpanded ? '收起提交信息' : '展开提交信息'}
                  title={messageExpanded ? '收起提交信息' : '展开提交信息'}
                >
                  {messageExpanded ? (
                    <ChevronDown className="source-control-commit-collapse-icon" />
                  ) : (
                    <ChevronUp className="source-control-commit-expand-icon" />
                  )}
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="source-control-generate-message ml-auto"
                  aria-label={
                    generation.state === 'idle' ? '使用 Pi 生成提交信息' : '停止生成提交信息'
                  }
                  title={generation.state === 'idle' ? '使用 Pi 生成提交信息' : '停止生成提交信息'}
                  disabled={
                    generation.state === 'stopping' ||
                    (generation.state === 'idle' && commitDisabled)
                  }
                  onClick={() => {
                    setMessageExpanded(true)
                    if (generation.state !== 'idle') {
                      void generation.cancel().catch(() => {})
                    } else if (status && !writing.current) {
                      void generation.generate(status.indexVersion, (message) => {
                        form.setFieldValue('message', message)
                        update(workspace.id, { draft: message })
                      })
                    }
                  }}
                >
                  {generation.state === 'stopping' ? (
                    <LoaderCircle className="source-control-generating-icon animate-spin" />
                  ) : generation.state === 'running' ? (
                    <Square className="source-control-stop-generation-icon" />
                  ) : (
                    <Sparkles className="source-control-generate-message-icon" />
                  )}
                </Button>
                <form.Subscribe
                  selector={(state) => state.isSubmitting || !state.values.message.trim()}
                >
                  {(unavailable) => (
                    <ButtonGroup
                      className="source-control-commit-buttons shrink-0"
                      aria-label="提交操作"
                    >
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="source-control-commit-button"
                        disabled={commitDisabled || unavailable}
                      >
                        <GitCommitHorizontal
                          className="source-control-commit-icon"
                          data-icon="inline-start"
                        />
                        提交
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="source-control-commit-menu-trigger"
                          render={<Button type="button" variant="outline" size="icon-sm" />}
                          aria-label="更多提交操作"
                          disabled={commitDisabled || unavailable}
                        >
                          <ChevronDown className="source-control-commit-menu-icon" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="source-control-commit-menu" align="end">
                          <DropdownMenuGroup className="source-control-commit-menu-actions">
                            <DropdownMenuItem
                              className="source-control-commit-and-push"
                              disabled={commitDisabled || unavailable}
                              onClick={() => void form.handleSubmit({ push: true })}
                            >
                              <Upload className="source-control-commit-and-push-icon" />
                              提交并推送
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ButtonGroup>
                  )}
                </form.Subscribe>
              </div>
            </Collapsible>
          </>
        )}
      </Tabs>
      <AlertDialog
        open={active && !!dialogError}
        onOpenChange={(open) => {
          if (!open) setDialogError(undefined)
        }}
      >
        <AlertDialogContent className="source-control-error-dialog">
          <AlertDialogHeader className="source-control-error-header min-w-0">
            <AlertDialogTitle className="source-control-error-title">操作未完成</AlertDialogTitle>
            <AlertDialogDescription className="source-control-error-detail max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words select-text">
              {dialogError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="source-control-error-footer">
            <AlertDialogCancel className="source-control-error-dismiss">知道了</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
