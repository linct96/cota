import { useEffect, useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Upload,
  CloudDownload,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
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
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { Checkbox } from './ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty'
import { Field, FieldGroup } from './ui/field'
import { Separator } from './ui/separator'
import { Textarea } from './ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { SourceControlReview } from './SourceControlReview'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [readError, setReadError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [pending, setPending] = useState(false)
  const [messageExpanded, setMessageExpanded] = useState(true)
  const [references, setReferences] = useState<GitReferences>()
  const [referencesError, setReferencesError] = useState<string>()
  const reading = useRef(false)
  const writing = useRef(false)
  const mounted = useRef(true)
  const status = session.status
  const target = { projectPath: workspace.projectPath, workspaceId: workspace.id }
  const form = useForm({
    defaultValues: { message: session.draft },
    onSubmitMeta: { push: false },
    onSubmit: async ({ value, meta }) => {
      if (
        !status ||
        !status.entries.some((entry) => entry.area === 'staged') ||
        status.entries.some((entry) => entry.area === 'conflict')
      )
        return
      const committed = await mutate({
        ...target,
        action: 'commit',
        message: value.message,
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
      if (mounted.current) setFeedback(pushed ? '提交并推送成功' : '提交已成功，未完成推送。')
    },
  })

  async function refresh() {
    if (reading.current || writing.current) return
    reading.current = true
    setRefreshing(true)
    try {
      const next = unwrap(await window.desktop.gitStatus(target))
      if (!mounted.current) return
      update(workspace.id, { status: next, refreshed: Date.now() })
      setSelected(
        (current) =>
          new Set(
            [...current].filter((key) => next.entries.some((entry) => gitFileKey(entry) === key)),
          ),
      )
      setReadError(undefined)
    } catch (error) {
      if (mounted.current) {
        update(workspace.id, { status: undefined })
        setReadError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      reading.current = false
      if (mounted.current) setRefreshing(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) return
    const visibleRefresh = () => {
      if (!document.hidden && document.hasFocus()) void refresh()
    }
    void refresh()
    const interval = window.setInterval(visibleRefresh, 5000)
    window.addEventListener('focus', visibleRefresh)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', visibleRefresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
    }
  }, [active, workspace.id])

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
  }, [active, workspace.id, session.refreshed])

  async function mutate(input: GitMutation) {
    if (writing.current || reading.current) return false
    writing.current = true
    setPending(true)
    setFeedback(undefined)
    setError(undefined)
    try {
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
      if (done) {
        setSelected(new Set())
        if (input.action === 'switch-branch')
          update(workspace.id, { selection: undefined, preview: false })
        setFeedback(
          input.action === 'commit'
            ? '提交成功'
            : input.action === 'fetch'
              ? '获取完成'
              : input.action === 'pull'
                ? '快进拉取完成'
                : input.action === 'sync'
                  ? '同步完成'
                  : input.action === 'switch-branch'
                    ? '已切换分支'
                    : input.action === 'push' || input.action === 'publish'
                      ? '推送完成'
                      : '已更新',
        )
      } else
        setFeedback(
          input.action === 'sync'
            ? '已完成拉取合并，推送已取消。'
            : input.action === 'discard'
              ? '已取消，未丢弃改动'
              : '已取消，未推送',
        )
      return done
    } catch (error) {
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
        if (mounted.current) setPending(false)
      }
    }
  }

  const disabled = pending || refreshing || !status
  const chosen = (entries: GitChange[]) => {
    const picked = entries.filter((entry) => selected.has(gitFileKey(entry)))
    return (picked.length ? picked : entries).filter((entry) => !entry.submodule)
  }
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
  const localBranches =
    references?.branches.filter((branch) => branch.ref.startsWith('refs/heads/')) || []
  const branchLabel = status?.branch || `分离 HEAD · ${status?.head?.slice(0, 8) || '无提交'}`
  const syncDescription = status?.upstream
    ? `与 ${status.upstream} 同步 · 领先 ${status.ahead}，落后 ${status.behind}。先拉取并合并，再推送已提交代码（推送需确认）。`
    : '尚未设置上游，请使用推送菜单发布分支。'
  const syncDisabled = pushDisabled || !status?.head || !status.tracking || !!status.entries.length
  async function remoteAction(action: 'fetch' | 'push' | 'publish' | 'sync') {
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
      aria-busy={pending}
    >
      <Tabs
        value={session.mode}
        onValueChange={(value) => {
          if (value === 'changes' || value === 'history' || value === 'compare')
            update(workspace.id, { mode: value })
        }}
        className="source-control-sections flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="source-control-context flex shrink-0 flex-col gap-2 px-2 py-2">
          <div className="source-control-branch-row flex min-w-0 items-center gap-0.5">
            {status && (
              <>
                <Combobox
                  items={localBranches}
                  value={localBranches.find((branch) => branch.label === status.branch) || null}
                  itemToStringLabel={(branch) => branch.label}
                  disabled={disabled || !references}
                  onValueChange={(branch) => {
                    if (!branch || branch.label === status.branch) return
                    void mutate({
                      ...target,
                      action: 'switch-branch',
                      ref: branch.ref,
                      branch: status.branch,
                      head: status.head,
                    })
                  }}
                >
                  <ComboboxTrigger
                    className="source-control-branch min-w-0 flex-1 justify-start px-1.5"
                    render={<Button variant="ghost" size="sm" />}
                    aria-label={`切换分支，当前${branchLabel}`}
                    title={`切换本地分支 · ${branchLabel}`}
                  >
                    <GitBranch className="source-control-branch-icon shrink-0" />
                    <span className="source-control-branch-name truncate">{branchLabel}</span>
                  </ComboboxTrigger>
                  <ComboboxContent className="source-control-branch-picker">
                    <div className="source-control-branch-search p-1">
                      <ComboboxInput
                        className="source-control-branch-search-input"
                        placeholder="搜索本地分支…"
                        aria-label="搜索本地分支"
                      />
                    </div>
                    <ComboboxEmpty className="source-control-branch-empty">
                      没有匹配的本地分支
                    </ComboboxEmpty>
                    <ComboboxList className="source-control-branch-list">
                      {(branch: GitReferences['branches'][number]) => {
                        const occupied = !!branch.worktreePath && branch.label !== status.branch
                        return (
                          <ComboboxItem
                            className="source-control-branch-option"
                            key={branch.ref}
                            value={branch}
                            disabled={occupied}
                            title={
                              occupied ? `已被 Worktree 占用：${branch.worktreePath}` : branch.label
                            }
                          >
                            <GitBranch className="source-control-branch-option-icon" />
                            <span className="source-control-branch-option-label min-w-0 flex-1 truncate">
                              {branch.label}
                            </span>
                            {occupied && (
                              <span className="source-control-branch-occupied shrink-0 text-muted-foreground">
                                已占用
                              </span>
                            )}
                          </ComboboxItem>
                        )
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <Button
                  variant="ghost"
                  size="sm"
                  className="source-control-sync min-w-0 flex-1 gap-1 px-1.5 text-muted-foreground"
                  aria-label={syncDescription}
                  title={
                    status.entries.length
                      ? `${syncDescription}\n请先提交或自行处理工作区更改。`
                      : syncDescription
                  }
                  disabled={syncDisabled}
                  onClick={() => void remoteAction('sync')}
                >
                  <span className="source-control-upstream min-w-0 truncate">
                    {status.upstream || '未设置上游'}
                  </span>
                  {status.upstream && (
                    <span className="source-control-sync-counts flex shrink-0 items-center gap-0.5 tabular-nums">
                      <ArrowUp className="source-control-ahead-icon size-3!" aria-hidden="true" />
                      {status.ahead}
                      <ArrowDown
                        className="source-control-behind-icon size-3!"
                        aria-hidden="true"
                      />
                      {status.behind}
                    </span>
                  )}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="source-control-refresh ml-auto shrink-0"
              aria-label="刷新 Git 状态"
              title="刷新 Git 状态"
              disabled={pending || refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw className="source-control-refresh-icon" />
            </Button>
          </div>
          {feedback && session.mode !== 'changes' && (
            <p
              className="source-control-network-feedback text-xs text-muted-foreground"
              role="status"
            >
              {feedback}
            </p>
          )}
          <TabsList className="source-control-section-tabs w-full" aria-label="源代码管理视图">
            <TabsTrigger className="source-control-changes-tab" value="changes">
              更改
            </TabsTrigger>
            <TabsTrigger className="source-control-history-tab" value="history">
              历史
            </TabsTrigger>
            <TabsTrigger className="source-control-compare-tab" value="compare">
              分支比较
            </TabsTrigger>
          </TabsList>
        </div>
        <Separator className="source-control-header-separator" />
        {(error || readError || referencesError) && (
          <Alert
            variant="destructive"
            className="source-control-error m-2 max-h-40 w-auto shrink-0 overflow-auto"
          >
            <AlertTitle className="source-control-error-title">操作未完成</AlertTitle>
            <AlertDescription className="source-control-error-detail max-h-40 overflow-auto whitespace-pre-wrap break-words select-text">
              {error || readError || referencesError}
            </AlertDescription>
          </Alert>
        )}
        {session.mode === 'changes' && (
          <>
            <Collapsible
              className="source-control-commit flex shrink-0 flex-col gap-2 px-3 py-2"
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
              <div className="source-control-commit-actions flex items-center justify-between gap-2">
                <CollapsibleTrigger
                  className="source-control-commit-toggle"
                  render={<Button type="button" variant="ghost" size="icon-sm" />}
                  aria-label={messageExpanded ? '收起提交信息' : '展开提交信息'}
                  title={messageExpanded ? '收起提交信息' : '展开提交信息'}
                >
                  {messageExpanded ? (
                    <ChevronUp className="source-control-commit-collapse-icon" />
                  ) : (
                    <ChevronDown className="source-control-commit-expand-icon" />
                  )}
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="source-control-generate-message ml-auto"
                  aria-label="AI 生成提交信息（暂未开放）"
                  title="AI 生成提交信息（暂未开放）"
                >
                  <Sparkles className="source-control-generate-message-icon" />
                </Button>
                <ButtonGroup className="source-control-commit-buttons" aria-label="提交操作">
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="source-control-commit-button"
                  >
                    <GitCommitHorizontal
                      className="source-control-commit-icon"
                      data-icon="inline-start"
                    />
                    {pending ? '正在处理…' : '提交'}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="source-control-commit-menu-trigger"
                      render={<Button type="button" variant="outline" size="icon-sm" />}
                      aria-label="更多提交操作"
                    >
                      <ChevronDown className="source-control-commit-menu-icon" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="source-control-commit-menu" align="end">
                      <DropdownMenuGroup className="source-control-commit-menu-actions">
                        <DropdownMenuItem
                          className="source-control-commit-and-push"
                          onClick={() => void form.handleSubmit({ push: true })}
                        >
                          <Upload className="source-control-commit-and-push-icon" />
                          提交并推送
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator className="source-control-commit-menu-separator" />
                      <DropdownMenuGroup className="source-control-commit-network-actions">
                        <DropdownMenuItem
                          className="source-control-fetch"
                          disabled={networkDisabled || !selectedRemote}
                          title={`从 ${selectedRemote || '远端'} 获取分支，不改工作文件`}
                          onClick={() => void remoteAction('fetch')}
                        >
                          <CloudDownload className="source-control-fetch-icon" />
                          获取
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="source-control-push"
                          disabled={pushDisabled || !status?.head}
                          title={
                            status?.tracking
                              ? `推送至 ${status.tracking.remote}/${status.tracking.branch}（需确认）`
                              : `发布到 ${selectedRemote}/${status?.branch || ''}（需确认）`
                          }
                          onClick={() => void remoteAction(hasTracking ? 'push' : 'publish')}
                        >
                          <Upload className="source-control-push-icon" />
                          {hasTracking ? '推送' : '发布'}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </div>
              <CollapsibleContent className="source-control-commit-content" keepMounted>
                <FieldGroup className="source-control-commit-fields">
                  <form.Field name="message">
                    {(field) => (
                      <Field className="source-control-commit-field" data-disabled={pending}>
                        <Textarea
                          id={`commit-${workspace.id}`}
                          name={field.name}
                          aria-label="提交信息"
                          className="source-control-commit-message max-h-32 select-text"
                          placeholder="描述本次更改…"
                          maxLength={20000}
                          value={field.state.value}
                          disabled={pending}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value)
                            update(workspace.id, { draft: event.target.value })
                          }}
                        />
                      </Field>
                    )}
                  </form.Field>
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
            <Separator className="source-control-commit-separator" />
          </>
        )}
        <TabsContent
          value="changes"
          className="source-control-files min-h-0 flex-1 overflow-auto px-2 py-2"
        >
          {!status && !error && !readError && (
            <p className="source-control-loading p-3 text-xs text-muted-foreground" role="status">
              正在读取 Git 状态…
            </p>
          )}
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
          {groups.map(({ area, label }) => {
            const entries = (status?.entries || []).filter((entry) => entry.area === area)
            if (!entries.length) return null
            const targets = chosen(entries)
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
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="source-control-group-stage"
                    aria-label={`${area === 'staged' ? '取消暂存' : '暂存'}${targets.length} 个${label}文件`}
                    title={
                      area === 'staged'
                        ? '取消暂存所选 / 全部'
                        : area === 'conflict'
                          ? '暂存以标记已解决'
                          : '暂存所选 / 全部'
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
                  {(area === 'unstaged' || area === 'untracked') && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="source-control-group-discard"
                      aria-label={`丢弃 ${targets.length} 个${label}文件的改动`}
                      title="丢弃所选 / 全部改动（需确认）"
                      disabled={disabled || !targets.length}
                      onClick={() => filesAction('discard', targets)}
                    >
                      <Trash2 className="source-control-discard-icon" />
                    </Button>
                  )}
                </div>
                <CollapsibleContent className="source-control-group-files flex flex-col gap-0.5">
                  {entries.map((entry) => {
                    const key = gitFileKey(entry)
                    return (
                      <div
                        key={key}
                        className="source-control-file-row flex min-w-0 items-center gap-1.5 px-1"
                        data-selected={
                          session.preview &&
                          session.selection &&
                          gitFileKey(session.selection) === key
                        }
                      >
                        <Checkbox
                          className="source-control-file-checkbox"
                          aria-label={`选择 ${entry.path}`}
                          checked={selected.has(key)}
                          disabled={disabled || entry.submodule}
                          onCheckedChange={(checked) =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (checked) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }
                        />
                        <Button
                          variant="ghost"
                          className="source-control-file-open h-auto min-w-0 flex-1 justify-start gap-2 py-1.5"
                          title={`${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
                          onClick={() =>
                            update(workspace.id, {
                              selection: { path: entry.path, area: entry.area },
                              preview: true,
                            })
                          }
                        >
                          <span
                            className="source-control-file-status shrink-0 font-mono text-muted-foreground"
                            aria-label={labels[entry.status] || '冲突'}
                          >
                            {entry.status}
                          </span>
                          <span className="source-control-file-path min-w-0 flex-1 truncate text-left">
                            {entry.path}
                          </span>
                          {entry.submodule && (
                            <span className="source-control-submodule text-muted-foreground">
                              子模块
                            </span>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="source-control-file-stage"
                          aria-label={`${area === 'staged' ? '取消暂存' : '暂存'} ${entry.path}`}
                          title={area === 'staged' ? '取消暂存' : '暂存'}
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
                    )
                  })}
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </TabsContent>
        {session.mode !== 'changes' && (
          <TabsContent
            value={session.mode}
            className="source-control-review-content min-h-0 flex-1 overflow-auto px-2 py-3"
          >
            <SourceControlReview workspace={workspace} active={active} references={references} />
          </TabsContent>
        )}
      </Tabs>
    </section>
  )
}
