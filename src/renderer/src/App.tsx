import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { workspaceFormSchema } from './lib/form-schemas'
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour'
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GitFork,
  PanelRightOpen,
  FileDiff,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { currentWorkspace, nextWorkspaceName, useWorkspace } from './store'
import { unwrap } from '../../shared/contracts'
import { TerminalTab } from './components/TerminalTab'
import { TerminalView } from './components/TerminalView'
import { RightPanel } from './components/RightPanel'
import { SourceControlDiff } from './components/SourceControlDiff'
import { ResizablePanel, ResizablePanelGroup } from './components/ui/resizable'
import { useSourceControl } from './lib/source-control-store'
import { useRightPanel } from './lib/right-panel-store'
import { AgentMenu } from './components/AgentMenu'
import { AgentStatus } from './components/AgentStatus'
import { AgentIcon } from './components/AgentIcon'
import {
  AGENT_STATE_LABELS,
  agentIndicatorState,
  agentTabState,
  workspaceAgentSummary,
} from './lib/agent-status'
import { OpenerIcon } from './components/OpenWithIcons'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { WorktreeDialog } from './components/WorktreeDialog'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/ui/empty'
import { Separator } from './components/ui/separator'
import { Input } from './components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from './components/ui/field'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './components/ui/context-menu'
import { cn } from './lib/utils'
import { useProjectBranches } from './lib/use-project-branches'

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() || '/'
}

export function App() {
  const state = useWorkspace()
  const router = useRouter()
  const settingsOpen = useRouterState({
    select: (state) => state.location.pathname === '/settings',
  })
  const projectBranches = useProjectBranches(state.workspaces)
  const [worktreeProject, setWorktreeProject] = useState<string>()
  const [navigation, setNavigation] = useState<'home' | 'placeholder'>('home')
  const activeNavigation = settingsOpen ? 'settings' : navigation
  const menuTrigger = useRef<HTMLElement | null>(null)
  const cancelWorkspaceRemoval = useRef<HTMLButtonElement | null>(null)
  const [workspaceToRemove, setWorkspaceToRemove] = useState<string | null>(null)
  const [projectToRemove, setProjectToRemove] = useState<string | null>(null)
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({})
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    projectPath: string
    id?: string
  } | null>(null)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string>()
  const workspaceSavePending = useRef(false)
  const workspaceDialogTrigger = useRef<HTMLElement | null>(null)
  const workspaceNameInput = useRef<HTMLInputElement | null>(null)
  const [workspaceCheckAttempt, setWorkspaceCheckAttempt] = useState(0)
  const [checkingWorktree, setCheckingWorktree] = useState(false)
  const workspaceForm = useForm({
    defaultValues: { name: '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: workspaceFormSchema },
    onSubmit: async ({ value }) => {
      if (!workspaceDialog || workspaceSavePending.current || state.removingWorkspace) return
      workspaceSavePending.current = true
      setSavingWorkspace(true)
      setWorkspaceSaveError(undefined)
      try {
        const name = value.name.trim()
        const saved = workspaceDialog.id
          ? state.renameWorkspace(workspaceDialog.id, name)
          : await state.newWorkspace(workspaceDialog.projectPath, name)
        if (saved) {
          if (!workspaceDialog.id)
            setOpenProjects((current) => ({ ...current, [workspaceDialog.projectPath]: true }))
          setWorkspaceDialog(null)
        } else setWorkspaceSaveError('无法保存工作区，请检查名称或稍后重试。')
      } catch (cause) {
        setWorkspaceSaveError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        workspaceSavePending.current = false
        setSavingWorkspace(false)
      }
    },
  })
  const editingWorkspace = state.workspaces.find((entry) => entry.id === workspaceDialog?.id)
  const editingRecord =
    editingWorkspace?.kind === 'git-worktree'
      ? state.worktreeRecords.find((entry) => entry.id === editingWorkspace.worktreeId)
      : undefined
  const editingScan = editingRecord
    ? state.worktreeScans[editingRecord.projectPath]?.entries.find(
        (entry) => entry.record.id === editingRecord.id,
      )
    : undefined

  useEffect(() => {
    if (!editingRecord) return
    let disposed = false
    setCheckingWorktree(true)
    setWorkspaceSaveError(undefined)
    useWorkspace.setState({ worktreeError: undefined })
    void useWorkspace
      .getState()
      .refreshWorktrees(editingRecord.projectPath)
      .catch((error) => {
        if (!disposed) setWorkspaceSaveError(error.message)
      })
      .finally(() => {
        if (!disposed) setCheckingWorktree(false)
      })
    return () => {
      disposed = true
    }
  }, [editingRecord, workspaceCheckAttempt])

  useEffect(() => {
    const stopAgents = window.desktop.onAgent((event) =>
      useWorkspace.getState().receiveAgent(event),
    )
    const bootstrapped = useWorkspace.getState().bootstrap()
    const stopAgentFocus = window.desktop.onAgentFocus((target) => {
      void bootstrapped
        .then(async () => {
          const state = useWorkspace.getState()
          const tab = state.tabs.find(
            (entry) => entry.id === target.terminalId && entry.agent?.launchId === target.launchId,
          )
          if (!tab || !(await state.selectProject(tab.projectPath, tab.workspaceId))) return
          useWorkspace.getState().selectTab(tab.id)
          await router.navigate({ to: '/' })
        })
        .catch((error) => console.warn('无法定位 Agent 通知目标。', error))
    })
    const stopShortcuts = window.desktop.onShortcut((shortcut) => {
      if (useWorkspace.getState().removingWorkspace || useWorkspace.getState().creatingWorktree)
        return
      if (shortcut === 'settings') {
        void router.navigate({ to: '/settings' })
      } else if (router.state.location.pathname === '/') {
        useWorkspace.getState().shortcut(shortcut)
      }
    })
    return () => {
      stopAgents()
      stopAgentFocus()
      stopShortcuts()
    }
  }, [router])

  const activeWorkspace = currentWorkspace(state)
  const workspaceId = activeWorkspace?.id
  const currentTabs = state.tabs.filter((tab) => tab.workspaceId === workspaceId)
  const activeId = state.activeTabs[workspaceId || '']
  const rightPanelOpen = useRightPanel((state) => state.open)
  const sourceSelection = useSourceControl((state) =>
    workspaceId ? state.sessions[workspaceId]?.selection : undefined,
  )
  const showingDiff = useSourceControl(
    (state) => !!workspaceId && !!state.sessions[workspaceId]?.preview,
  )
  useEffect(() => {
    const current = useSourceControl.getState()
    const ids = new Set(state.workspaces.map((workspace) => workspace.id))
    if (Object.keys(current.sessions).some((id) => !ids.has(id))) {
      useSourceControl.setState({
        sessions: Object.fromEntries(
          Object.entries(current.sessions).filter(([id]) => ids.has(id)),
        ),
      })
    }
  }, [state.workspaces])
  useEffect(() => {
    const updateVisible = () =>
      useWorkspace
        .getState()
        .setVisibleTerminal(
          activeNavigation === 'home' && !showingDiff && !document.hidden && document.hasFocus()
            ? activeId
            : undefined,
        )
    updateVisible()
    window.addEventListener('focus', updateVisible)
    window.addEventListener('blur', updateVisible)
    document.addEventListener('visibilitychange', updateVisible)
    return () => {
      window.removeEventListener('focus', updateVisible)
      window.removeEventListener('blur', updateVisible)
      document.removeEventListener('visibilitychange', updateVisible)
      useWorkspace.getState().setVisibleTerminal(undefined)
    }
  }, [activeId, activeNavigation, showingDiff])
  const pendingWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceToRemove)
  // Keep projects with workspaces or terminals reachable outside the recent 20.
  const projects = [
    ...new Set([
      ...state.projects,
      ...state.workspaces.map((workspace) => workspace.projectPath),
      ...state.tabs.map((tab) => tab.projectPath),
      ...state.worktreeRecords.map((record) => record.projectPath),
      ...state.orphanSessions.map((session) => session.projectPath),
    ]),
  ]

  return (
    <TooltipProvider delay={300}>
      <div className="app-container flex h-screen w-screen overflow-hidden bg-background text-foreground select-none">
        {/* 1. 最左侧：浅色底竖向图标菜单栏 */}
        <nav
          aria-label="主导航"
          className="primary-navigation flex w-[48px] shrink-0 flex-col justify-between pb-3"
        >
          <div className="primary-navigation-top flex flex-col items-center gap-2">
            {/* 与 44px 标题栏对齐，避免 rem 随字号缩小而侵入红绿灯区域。 */}
            <div
              className="primary-navigation-titlebar title-bar h-[44px] w-full shrink-0"
              aria-hidden="true"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="navigation"
                    size="icon-xl"
                    aria-label="首页"
                    aria-current={activeNavigation === 'home' ? 'page' : undefined}
                    className="nav-home-button"
                    data-active={activeNavigation === 'home'}
                    onClick={() => {
                      setNavigation('home')
                      void router.navigate({ to: '/' })
                    }}
                  />
                }
              >
                <HouseIcon
                  className="nav-home-icon"
                  aria-hidden="true"
                  weight={activeNavigation === 'home' ? 'fill' : 'regular'}
                />
              </TooltipTrigger>
              <TooltipContent side="right">首页</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="navigation"
                    size="icon-xl"
                    aria-label="占位导航（仅测试样式）"
                    aria-pressed={activeNavigation === 'placeholder'}
                    className="nav-placeholder-button"
                    data-active={activeNavigation === 'placeholder'}
                    onClick={() => setNavigation('placeholder')}
                  />
                }
              >
                <SquaresFourIcon
                  className="nav-placeholder-icon"
                  aria-hidden="true"
                  weight={activeNavigation === 'placeholder' ? 'fill' : 'regular'}
                />
              </TooltipTrigger>
              <TooltipContent side="right">占位导航（仅测试激活样式）</TooltipContent>
            </Tooltip>
          </div>
          <div className="primary-navigation-bottom flex flex-col items-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="navigation"
                    size="icon-xl"
                    className="nav-settings-button"
                    data-active={settingsOpen}
                    aria-label="打开设置"
                    aria-current={settingsOpen ? 'page' : undefined}
                    onClick={() => void router.navigate({ to: settingsOpen ? '/' : '/settings' })}
                  />
                }
              >
                <GearSixIcon
                  className="nav-settings-icon"
                  aria-hidden="true"
                  weight={settingsOpen ? 'fill' : 'regular'}
                />
              </TooltipTrigger>
              <TooltipContent side="right">设置 ⌘,</TooltipContent>
            </Tooltip>
          </div>
        </nav>

        <ResizablePanelGroup orientation="horizontal" className="app-panels min-w-0 flex-1">
          <ResizablePanel
            id="workspace-main"
            minSize={440}
            className="workspace-main-panel flex min-w-0 flex-col"
            style={{ overflow: 'hidden' }}
          >
            {/* 2. 主区域（顶栏浅色背景，下方纯白工作台连成一体） */}
            <div className="workspace-layout flex min-h-0 min-w-0 flex-1 flex-col">
              {/* 导航按钮左侧为原生红绿灯保留空间。 */}
              <header className="workspace-header title-bar flex h-[44px] shrink-0 items-center pr-3">
                <nav
                  aria-label="历史导航"
                  className="title-bar-history flex h-full w-60 shrink-0 items-center gap-1 pl-12"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="navigation"
                          size="icon"
                          className="history-back-button"
                          aria-label="后退"
                          disabled={!settingsOpen}
                          onClick={() => void router.navigate({ to: '/' })}
                        />
                      }
                    >
                      <ArrowLeft className="history-back-icon" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {settingsOpen ? '后退到工作区' : '后退（功能待接入）'}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="navigation"
                          size="icon"
                          className="history-forward-button"
                          aria-label="前进"
                          disabled
                        />
                      }
                    >
                      <ArrowRight className="history-forward-icon" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">前进（功能待接入）</TooltipContent>
                  </Tooltip>
                </nav>

                {/* 终端标签栏 */}
                {!settingsOpen && (
                  <div className="terminal-tabs-region flex min-w-0 flex-1 items-center gap-2">
                    <Separator
                      aria-hidden="true"
                      orientation="vertical"
                      className="terminal-tabs-separator bg-titlebar-separator data-vertical:h-4 data-vertical:self-center"
                    />
                    {state.selectedProject && (
                      <>
                        {currentTabs.length > 0 && (
                          <div
                            role="tablist"
                            tabIndex={-1}
                            aria-label="终端标签"
                            className="terminal-tab-list flex min-w-0 items-center gap-1 overflow-x-auto"
                            onKeyDown={(event) => {
                              if ((event.target as HTMLElement).getAttribute('role') !== 'tab')
                                return
                              const index = currentTabs.findIndex((tab) => tab.id === activeId)
                              const next =
                                event.key === 'ArrowRight'
                                  ? currentTabs[(index + 1) % currentTabs.length]
                                  : event.key === 'ArrowLeft'
                                    ? currentTabs[
                                        (index - 1 + currentTabs.length) % currentTabs.length
                                      ]
                                    : event.key === 'Home'
                                      ? currentTabs[0]
                                      : event.key === 'End'
                                        ? currentTabs.at(-1)
                                        : undefined
                              if (!next) return
                              event.preventDefault()
                              state.selectTab(next.id)
                              document.getElementById(`terminal-tab-${next.id}`)?.focus()
                            }}
                          >
                            {currentTabs.map((tab) => (
                              <TerminalTab
                                key={tab.id}
                                tab={tab}
                                active={tab.id === activeId && !showingDiff}
                                closeDisabled={
                                  tab.status === 'starting' ||
                                  !!tab.closingStatus ||
                                  !!state.removingWorkspace
                                }
                                onSelect={() => state.selectTab(tab.id)}
                                onClose={() => {
                                  void state.closeTab(tab.id)
                                }}
                              />
                            ))}
                          </div>
                        )}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="navigation"
                                size="icon"
                                className="terminal-tab-new-button shrink-0"
                                disabled={
                                  !activeWorkspace ||
                                  !!state.removingWorkspace ||
                                  state.creatingWorktree ||
                                  (activeWorkspace.kind === 'git-worktree' &&
                                    state.worktreeScans[activeWorkspace.projectPath]?.entries.find(
                                      (entry) => entry.record.id === activeWorkspace.worktreeId,
                                    )?.status !== 'ready')
                                }
                                aria-label="新建终端"
                                onClick={() => state.newTerminal()}
                              />
                            }
                          >
                            <Plus className="terminal-tab-new-icon" />
                          </TooltipTrigger>
                          <TooltipContent side="bottom">新建终端 ⌘T</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    {sourceSelection && workspaceId && (
                      <Button
                        variant="navigation"
                        size="sm"
                        className="source-control-preview-tab shrink-0"
                        aria-pressed={showingDiff}
                        data-active={showingDiff}
                        onClick={() =>
                          useSourceControl.getState().update(workspaceId, { preview: true })
                        }
                      >
                        <FileDiff
                          className="source-control-preview-icon"
                          data-icon="inline-start"
                        />
                        变更预览
                      </Button>
                    )}
                    <div className="workspace-header-spacer min-w-0 flex-1" />
                    {!rightPanelOpen && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="navigation"
                              size="icon"
                              id="right-panel-toggle"
                              className="right-panel-toggle shrink-0"
                              aria-label="展开右侧面板"
                              aria-expanded={false}
                              aria-controls="right-panel-content"
                              onClick={() => useRightPanel.setState({ open: true })}
                            />
                          }
                        >
                          <PanelRightOpen className="right-panel-toggle-icon" aria-hidden="true" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">展开右侧面板</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </header>

              {/* 项目侧栏与终端共用工作区，保留左上角圆角。 */}
              <div
                className={cn(
                  'workspace-content flex min-h-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-card',
                  settingsOpen && 'hidden',
                )}
              >
                {/* 侧栏使用 preset 的 sidebar token。 */}
                <aside
                  className="project-sidebar flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
                  aria-label="项目"
                >
                  <div className="project-header group/header flex h-8 shrink-0 items-center justify-between px-3">
                    <h2 className="project-title text-xs font-medium text-muted-foreground">
                      项目
                    </h2>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="project"
                            size="icon"
                            className="project-add-button opacity-0 transition-opacity focus-visible:opacity-100 disabled:opacity-0 group-hover/header:opacity-100"
                            disabled={!state.ready || !!state.removingWorkspace}
                            aria-label="添加项目"
                            onClick={() => {
                              void state.openProject()
                            }}
                          />
                        }
                      >
                        <FolderPlus className="project-add-icon" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">添加项目 ⌘O</TooltipContent>
                    </Tooltip>
                  </div>
                  <nav
                    className="project-list recent-projects flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
                    aria-label="最近项目"
                  >
                    {projects.map((path) => {
                      const workspaces = state.workspaces.filter(
                        (workspace) => workspace.projectPath === path,
                      )

                      return (
                        <Collapsible
                          key={path}
                          open={openProjects[path] !== false}
                          onOpenChange={(open) =>
                            setOpenProjects((value) => ({ ...value, [path]: open }))
                          }
                          render={<section />}
                          aria-label={`${folderName(path)} 项目`}
                          aria-busy={
                            state.removingWorkspace === path ||
                            workspaces.some((workspace) => workspace.id === state.removingWorkspace)
                          }
                          className="project-group flex shrink-0 flex-col gap-1"
                        >
                          <div className="project-folder-row group/folder flex items-center pr-1 transition-colors">
                            <h3 className="project-folder-heading min-w-0 flex-1">
                              <CollapsibleTrigger
                                render={(props, { open }) => (
                                  <Button {...props} variant="project">
                                    {open ? (
                                      <FolderOpen className="project-folder-icon" />
                                    ) : (
                                      <Folder className="project-folder-icon" />
                                    )}
                                    <span className="project-folder-name truncate">
                                      {folderName(path)}
                                    </span>
                                  </Button>
                                )}
                                className="project-folder-trigger w-full min-w-0 justify-start gap-2 px-2 bg-transparent hover:bg-transparent group-hover/folder:text-foreground"
                                title={path}
                                disabled={!!state.removingWorkspace}
                              />
                            </h3>
                            {state.worktreeScans[path]?.repository.status === 'ready' && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={<Button variant="project" size="icon-sm" />}
                                  className={cn(
                                    'project-worktree-add-button bg-transparent hover:bg-transparent active:bg-transparent',
                                    activeWorkspace?.projectPath !== path &&
                                      'invisible focus-visible:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
                                  )}
                                  aria-label={`${folderName(path)} 新建工作树`}
                                  aria-haspopup="dialog"
                                  disabled={
                                    !state.ready ||
                                    !!state.removingWorkspace ||
                                    state.creatingWorktree
                                  }
                                  onClick={() => setWorktreeProject(path)}
                                >
                                  <GitFork
                                    className="project-worktree-add-icon"
                                    aria-hidden="true"
                                  />
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  className="project-worktree-add-tooltip"
                                >
                                  新建工作树
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <DropdownMenu modal={false}>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <DropdownMenuTrigger
                                      render={<Button variant="project" size="icon-sm" />}
                                      className={cn(
                                        'project-folder-menu-trigger shrink-0 bg-transparent hover:bg-transparent active:bg-transparent',
                                        activeWorkspace?.projectPath !== path &&
                                          'invisible focus-visible:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
                                      )}
                                      disabled={!!state.removingWorkspace}
                                      aria-label={`${folderName(path)} 更多操作`}
                                      onFocus={(event) => {
                                        menuTrigger.current = event.currentTarget
                                      }}
                                    />
                                  }
                                >
                                  <MoreHorizontal className="project-folder-menu-icon size-3.5" />
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  className="project-folder-menu-tooltip"
                                >
                                  更多操作
                                </TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent
                                align="end"
                                aria-label={`${folderName(path)} 项目操作菜单`}
                                className="project-folder-dropdown-menu"
                              >
                                <DropdownMenuGroup className="project-folder-menu-actions">
                                  <DropdownMenuItem
                                    className="project-new-local-workspace-item"
                                    disabled={!state.ready || !!state.removingWorkspace}
                                    onClick={() => {
                                      workspaceDialogTrigger.current = menuTrigger.current
                                      workspaceForm.reset({
                                        name: nextWorkspaceName(path, state.workspaces),
                                      })
                                      setWorkspaceSaveError(undefined)
                                      setWorkspaceDialog({ projectPath: path })
                                    }}
                                  >
                                    新建工作区
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    className="project-delete-item"
                                    disabled={!!state.removingWorkspace}
                                    onClick={() => setProjectToRemove(path)}
                                  >
                                    <Trash2 className="project-delete-icon" />
                                    <span className="project-delete-label">删除项目</span>
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <CollapsibleContent className="project-workspaces flex flex-col gap-1">
                            {workspaces.map((workspace) => {
                              const isSelected =
                                path === state.selectedProject && workspace.id === workspaceId
                              const scanEntry =
                                workspace.kind === 'git-worktree'
                                  ? state.worktreeScans[path]?.entries.find(
                                      (entry) => entry.record.id === workspace.worktreeId,
                                    )
                                  : undefined
                              const worktree = scanEntry?.worktree
                              const branch =
                                workspace.kind === 'local'
                                  ? projectBranches[path]
                                  : worktree?.branch ||
                                    (worktree?.head
                                      ? `detached ${worktree.head.slice(0, 8)}`
                                      : undefined)
                              const workspaceTabs = state.tabs.filter(
                                (tab) => tab.workspaceId === workspace.id,
                              )
                              const hasTerminals = workspaceTabs.length > 0
                              const workspaceAgents = workspaceTabs.filter(
                                (tab) => tab.kind === 'agent' || tab.provider || tab.agent,
                              )
                              const agentSummary = workspaceAgentSummary(workspaceTabs)
                              return (
                                <ContextMenu
                                  key={workspace.id}
                                  disabled={!!state.removingWorkspace}
                                >
                                  <div
                                    className={cn(
                                      'project-item group ml-3 flex flex-col items-stretch rounded-md transition-colors',
                                      isSelected
                                        ? 'project-item-active bg-project-active text-foreground hover:bg-project-active-hover'
                                        : 'project-item-inactive text-muted-foreground hover:bg-project-hover hover:text-foreground',
                                    )}
                                  >
                                    <ContextMenuTrigger
                                      render={
                                        <Button
                                          variant="ghost"
                                          disabled={!!state.removingWorkspace}
                                        />
                                      }
                                      data-active={isSelected}
                                      aria-label={`${folderName(path)} ${workspace.name}${workspace.kind === 'git-worktree' ? '，Git Worktree' : ''}，${hasTerminals ? '有终端' : '无终端'}${agentSummary ? `，Agent ${agentSummary.description}` : ''}${branch ? `，分支 ${branch}` : ''}`}
                                      aria-current={isSelected ? 'page' : undefined}
                                      aria-haspopup="menu"
                                      className="project-item-button grid h-auto min-h-9 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-2 gap-y-0 border-0 px-2 py-2 text-left hover:bg-transparent"
                                      onContextMenu={(event) => {
                                        menuTrigger.current = event.currentTarget
                                      }}
                                      onClick={() => {
                                        void state.selectProject(path, workspace.id)
                                      }}
                                    >
                                      <span
                                        className="project-item-status flex size-3.5 items-center justify-center"
                                        aria-hidden="true"
                                      >
                                        {agentSummary && agentSummary.state !== 'other' ? (
                                          <AgentStatus state={agentSummary.state} />
                                        ) : (
                                          <span
                                            className={cn(
                                              'project-item-status-dot size-1.5 rounded-full',
                                              hasTerminals
                                                ? 'bg-workspace-status-active'
                                                : 'bg-workspace-status-idle',
                                            )}
                                          />
                                        )}
                                      </span>
                                      <span className="project-item-name truncate">
                                        {state.removingWorkspace === workspace.id
                                          ? '正在删除…'
                                          : workspace.name}
                                      </span>
                                      {workspace.kind === 'git-worktree' &&
                                        scanEntry &&
                                        (scanEntry.status !== 'ready' || worktree?.locked) && (
                                          <div className="project-item-worktree-alert col-start-2 mt-0.5 flex items-center">
                                            <Badge
                                              variant={
                                                scanEntry.status === 'ready'
                                                  ? 'secondary'
                                                  : 'destructive'
                                              }
                                              className="project-item-worktree-status h-4 px-1.5 text-[10px] font-normal"
                                              title={scanEntry.error}
                                            >
                                              {scanEntry.status === 'ready'
                                                ? 'Worktree · 已锁定'
                                                : `Worktree · ${scanEntry.status}`}
                                            </Badge>
                                          </div>
                                        )}
                                      {branch && (
                                        <span
                                          className="project-item-branch col-start-2 truncate text-xs leading-4 font-normal text-muted-foreground"
                                          title={branch}
                                        >
                                          {branch}
                                        </span>
                                      )}
                                    </ContextMenuTrigger>
                                    {workspaceAgents.length > 0 && (
                                      <div
                                        className="project-item-agents ml-7.5 flex min-w-0 flex-wrap gap-1 pr-2 pb-2"
                                        role="group"
                                        aria-label={`${workspace.name} Agent 列表`}
                                      >
                                        {workspaceAgents.map((tab) => {
                                          const agentState = agentTabState(tab)
                                          const agentActive =
                                            isSelected &&
                                            activeNavigation === 'home' &&
                                            state.activeTabs[workspace.id] === tab.id
                                          const label = `${tab.title} · ${AGENT_STATE_LABELS[agentState]}`
                                          return (
                                            <Tooltip key={tab.id}>
                                              <TooltipTrigger
                                                render={<Button variant="navigation" size="icon" />}
                                                className="project-item-agent-button relative"
                                                data-active={agentActive}
                                                aria-pressed={agentActive}
                                                aria-label={`定位到 ${label}`}
                                                disabled={!state.ready || !!state.removingWorkspace}
                                                onClick={async () => {
                                                  if (
                                                    isSelected ||
                                                    (await state.selectProject(path, workspace.id))
                                                  ) {
                                                    state.selectTab(tab.id)
                                                    setNavigation('home')
                                                  }
                                                }}
                                              >
                                                <span
                                                  className="project-item-agent-provider inline-flex"
                                                  aria-hidden="true"
                                                >
                                                  <AgentIcon
                                                    provider={tab.provider || tab.agent?.provider}
                                                    size={16}
                                                    className="project-item-agent-provider-icon size-4"
                                                  />
                                                </span>
                                                {agentIndicatorState(tab) !== 'other' && (
                                                  <span className="project-item-agent-status pointer-events-none absolute right-0.5 bottom-0.5 inline-flex rounded-full bg-sidebar p-px [&_.agent-status]:size-2.5">
                                                    <AgentStatus state={agentState} />
                                                  </span>
                                                )}
                                              </TooltipTrigger>
                                              <TooltipContent
                                                side="bottom"
                                                className="project-item-agent-tooltip"
                                              >
                                                {tab.title}
                                              </TooltipContent>
                                            </Tooltip>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  <ContextMenuContent
                                    finalFocus={() => menuTrigger.current}
                                    aria-label={`${folderName(path)} ${workspace.name} 操作菜单`}
                                    className="project-dropdown-menu"
                                  >
                                    <ContextMenuGroup className="project-menu-actions">
                                      <AgentMenu
                                        workspaceId={workspace.id}
                                        disabled={
                                          !state.ready ||
                                          state.creatingWorktree ||
                                          !!state.removingWorkspace ||
                                          (workspace.kind === 'git-worktree' &&
                                            scanEntry?.status !== 'ready')
                                        }
                                      />
                                      <ContextMenuSub>
                                        <ContextMenuSubTrigger className="workspace-open-with-trigger">
                                          <ExternalLink className="workspace-open-with-icon" />
                                          <span className="workspace-open-with-label">打开于</span>
                                        </ContextMenuSubTrigger>
                                        <ContextMenuContent
                                          className="workspace-open-with-menu"
                                          aria-label="打开于"
                                        >
                                          <ContextMenuGroup className="workspace-open-with-programs">
                                            {state.preferences.openWith
                                              .filter(
                                                (opener) =>
                                                  !(
                                                    opener.id === 'finder' &&
                                                    opener.command === '/usr/bin/open' &&
                                                    opener.arguments === '-a Finder {path}'
                                                  ),
                                              )
                                              .map((opener) => (
                                                <ContextMenuItem
                                                  key={opener.id}
                                                  className="workspace-open-with-item"
                                                  onClick={() => {
                                                    void window.desktop
                                                      .openWorkspaceWith(
                                                        {
                                                          projectPath: workspace.projectPath,
                                                          workspaceId: workspace.id,
                                                        },
                                                        opener.id,
                                                      )
                                                      .then(unwrap)
                                                      .catch(console.error)
                                                  }}
                                                >
                                                  <OpenerIcon
                                                    name={opener.name}
                                                    command={opener.command}
                                                    id={opener.id}
                                                    className="workspace-open-with-app-icon size-3.5"
                                                  />
                                                  {opener.name}
                                                </ContextMenuItem>
                                              ))}
                                            <ContextMenuItem
                                              className="workspace-open-file-manager-item"
                                              onClick={() => {
                                                void window.desktop
                                                  .openWorkspaceWith(
                                                    {
                                                      projectPath: workspace.projectPath,
                                                      workspaceId: workspace.id,
                                                    },
                                                    'system-file-manager',
                                                  )
                                                  .then(unwrap)
                                                  .catch(console.error)
                                              }}
                                            >
                                              <FolderOpen className="workspace-open-file-manager-icon" />
                                              文件管理器
                                            </ContextMenuItem>
                                          </ContextMenuGroup>
                                        </ContextMenuContent>
                                      </ContextMenuSub>
                                      <ContextMenuItem
                                        disabled={!!state.removingWorkspace}
                                        className="workspace-edit-item"
                                        onClick={() => {
                                          workspaceDialogTrigger.current = menuTrigger.current
                                          workspaceForm.reset({ name: workspace.name })
                                          setWorkspaceSaveError(undefined)
                                          setWorkspaceDialog({
                                            projectPath: path,
                                            id: workspace.id,
                                          })
                                        }}
                                      >
                                        <Pencil className="workspace-edit-icon" />
                                        <span className="workspace-edit-label">编辑</span>
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        variant="destructive"
                                        title={
                                          workspace.kind === 'git-worktree'
                                            ? '检查并确认后删除工作树及本地分支；存在未提交内容或未合并分支时需确认强制删除'
                                            : '仅删除此工作区并结束其终端，不影响其他工作区或本地文件'
                                        }
                                        disabled={
                                          !!state.removingWorkspace || state.creatingWorktree
                                        }
                                        className="workspace-delete-item"
                                        onClick={() => {
                                          if (workspace.kind === 'git-worktree')
                                            void state.removeWorkspace(workspace.id)
                                          else setWorkspaceToRemove(workspace.id)
                                        }}
                                      >
                                        <Trash2 className="workspace-delete-icon" />
                                        <span className="workspace-delete-label">
                                          {workspace.kind === 'git-worktree'
                                            ? '删除工作树'
                                            : '删除工作区'}
                                        </span>
                                      </ContextMenuItem>
                                    </ContextMenuGroup>
                                  </ContextMenuContent>
                                </ContextMenu>
                              )
                            })}
                          </CollapsibleContent>
                        </Collapsible>
                      )
                    })}
                    {!projects.length && (
                      <Empty className="project-empty-state flex-none px-3 py-8">
                        <EmptyHeader className="project-empty-header">
                          <EmptyMedia variant="icon" className="project-empty-media">
                            <FolderOpen className="project-empty-icon" aria-hidden="true" />
                          </EmptyMedia>
                          <EmptyTitle className="project-empty-title">暂无项目</EmptyTitle>
                          <EmptyDescription className="project-empty-description">
                            点击上方 + 或按 ⌘O 添加
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </nav>
                </aside>

                {/* 保持终端挂载，Diff 仅切换可见区域。 */}
                <main
                  className="terminal-workspace flex min-h-0 min-w-0 flex-1 flex-col"
                  aria-label={showingDiff ? '变更审阅工作区' : '终端工作区'}
                >
                  {state.worktreeError && (
                    <p
                      className="workspace-worktree-error px-4 py-2 text-xs text-destructive break-words"
                      role="alert"
                    >
                      {state.worktreeError}
                    </p>
                  )}
                  {showingDiff && activeWorkspace && (
                    <SourceControlDiff
                      key={activeWorkspace.id}
                      workspace={activeWorkspace}
                      active={!settingsOpen}
                    />
                  )}
                  <div
                    className={cn(
                      'terminal-stage-container grid grid-cols-1 grid-rows-1 min-h-0 flex-1 overflow-hidden',
                      showingDiff && 'hidden',
                    )}
                  >
                    {state.tabs.map((tab) => {
                      const isSelected =
                        tab.projectPath === state.selectedProject && tab.id === activeId
                      return (
                        <TerminalView
                          key={tab.id}
                          tab={tab}
                          active={
                            isSelected &&
                            !settingsOpen &&
                            !showingDiff &&
                            activeNavigation === 'home'
                          }
                        />
                      )
                    })}
                    {!state.selectedProject && (
                      <div className="workspace-empty-state col-start-1 row-start-1 flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <FolderOpen className="workspace-empty-icon size-6 text-muted-foreground" />
                        <div className="workspace-empty-content">
                          <h3 className="workspace-empty-title text-sm font-medium text-foreground">
                            {projects.length ? '未选择工作区' : '没有打开的项目'}
                          </h3>
                          <p className="workspace-empty-desc mt-1 text-xs text-muted-foreground">
                            {projects.length
                              ? '从左侧选择一个工作区，或使用快捷键 ⌘O 打开新项目。'
                              : '从左侧选择最近项目，或使用快捷键 ⌘O 打开新项目。'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="workspace-empty-action mt-1"
                          onClick={() => {
                            void state.openProject()
                          }}
                        >
                          打开项目 (⌘O)
                        </Button>
                      </div>
                    )}
                    {state.selectedProject && !currentTabs.length && (
                      <div className="terminal-empty-state col-start-1 row-start-1 flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <TerminalIcon className="terminal-empty-icon size-6 text-muted-foreground" />
                        <div className="terminal-empty-content">
                          <h3 className="terminal-empty-title text-sm font-medium text-foreground">
                            当前工作区没有运行中的终端
                          </h3>
                          <p className="terminal-empty-desc mt-1 text-xs text-muted-foreground">
                            点击上方 + 按钮，或使用快捷键 ⌘T 新建终端。
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="terminal-empty-action mt-1"
                          disabled={!!state.removingWorkspace}
                          onClick={() => state.newTerminal()}
                        >
                          新建终端 (⌘T)
                        </Button>
                      </div>
                    )}
                  </div>
                </main>
              </div>

              <Outlet />
            </div>
          </ResizablePanel>
          <RightPanel workspace={activeWorkspace} active={!settingsOpen} />
        </ResizablePanelGroup>

        {worktreeProject && (
          <WorktreeDialog
            projectPath={worktreeProject}
            close={() => setWorktreeProject(undefined)}
          />
        )}
        <ConfirmationDialog />

        <Dialog
          open={workspaceDialog !== null}
          onOpenChange={(open, details) => {
            if (workspaceSavePending.current) {
              details.cancel()
              return
            }
            if (!open) setWorkspaceDialog(null)
          }}
        >
          <DialogContent
            className="workspace-name-dialog max-h-[80vh] overflow-y-auto"
            showCloseButton={false}
            initialFocus={() => {
              workspaceNameInput.current?.select()
              return workspaceNameInput.current
            }}
            finalFocus={workspaceDialogTrigger}
          >
            <form
              className="workspace-name-form flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void workspaceForm.handleSubmit()
              }}
            >
              <DialogHeader className="workspace-name-header">
                <DialogTitle className="workspace-name-title">
                  {workspaceDialog?.id ? '编辑工作区' : '新建工作区'}
                </DialogTitle>
              </DialogHeader>
              <FieldGroup className="workspace-name-fields">
                <workspaceForm.Field name="name">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className="workspace-name-field"
                        data-invalid={invalid}
                        data-disabled={savingWorkspace}
                      >
                        <FieldLabel className="workspace-name-label" htmlFor="workspace-name">
                          工作区名称
                        </FieldLabel>
                        <Input
                          ref={workspaceNameInput}
                          id="workspace-name"
                          name={field.name}
                          className="workspace-name-input"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          disabled={savingWorkspace}
                          required
                          autoComplete="off"
                          aria-invalid={invalid}
                          aria-describedby={invalid ? 'workspace-name-error' : undefined}
                        />
                        {invalid && (
                          <FieldError id="workspace-name-error" errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </workspaceForm.Field>
              </FieldGroup>
              {editingRecord && (
                <section
                  className="workspace-worktree-details flex flex-col gap-2 text-xs"
                  aria-label="工作树信息"
                >
                  <p className="workspace-worktree-path break-all text-muted-foreground">
                    {editingRecord.path}
                  </p>
                  <p className="workspace-worktree-status text-muted-foreground" role="status">
                    {checkingWorktree
                      ? '正在检查工作树…'
                      : editingScan?.error ||
                        (editingScan?.status === 'ready'
                          ? editingScan.worktree?.locked
                            ? '工作树已锁定'
                            : '工作树就绪'
                          : '工作树状态暂不可用')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="workspace-worktree-recheck self-start"
                    disabled={
                      checkingWorktree ||
                      savingWorkspace ||
                      !!state.removingWorkspace ||
                      state.creatingWorktree
                    }
                    onClick={() => setWorkspaceCheckAttempt((attempt) => attempt + 1)}
                  >
                    重新检查
                  </Button>
                  {(editingRecord.origin === 'linked' || editingScan?.status !== 'ready') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="workspace-worktree-unlink self-start"
                      disabled={
                        checkingWorktree ||
                        savingWorkspace ||
                        !!state.removingWorkspace ||
                        state.creatingWorktree
                      }
                      onClick={async () => {
                        if (workspaceSavePending.current) return
                        workspaceSavePending.current = true
                        setSavingWorkspace(true)
                        setWorkspaceSaveError(undefined)
                        try {
                          await state.removeWorktree(editingRecord.id, false, true)
                          if (
                            !useWorkspace
                              .getState()
                              .worktreeRecords.some((entry) => entry.id === editingRecord.id)
                          )
                            setWorkspaceDialog(null)
                        } catch (error) {
                          setWorkspaceSaveError((error as Error).message)
                        } finally {
                          workspaceSavePending.current = false
                          setSavingWorkspace(false)
                        }
                      }}
                    >
                      移除关联（保留目录和分支）
                    </Button>
                  )}
                  {state.worktreeError && (
                    <p
                      className="workspace-worktree-error text-destructive break-words"
                      role="alert"
                    >
                      {state.worktreeError}
                    </p>
                  )}
                </section>
              )}
              {state.orphanSessions
                .filter((session) => session.projectPath === workspaceDialog?.projectPath)
                .map((session) => (
                  <div
                    key={session.id}
                    className="workspace-orphan-session flex flex-col gap-2 text-xs"
                  >
                    <p className="workspace-orphan-description text-destructive break-all">
                      终端身份与工作区登记不一致，不会自动连接：{session.cwd}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="workspace-orphan-close self-start"
                      disabled={
                        savingWorkspace || !!state.removingWorkspace || state.creatingWorktree
                      }
                      onClick={async () => {
                        if (workspaceSavePending.current) return
                        workspaceSavePending.current = true
                        setSavingWorkspace(true)
                        setWorkspaceSaveError(undefined)
                        try {
                          if (unwrap(await window.desktop.closeTerminal(session.id)))
                            useWorkspace.setState((current) => ({
                              orphanSessions: current.orphanSessions.filter(
                                (entry) => entry.id !== session.id,
                              ),
                            }))
                        } catch (error) {
                          setWorkspaceSaveError((error as Error).message)
                        } finally {
                          workspaceSavePending.current = false
                          setSavingWorkspace(false)
                        }
                      }}
                    >
                      结束此终端
                    </Button>
                  </div>
                ))}
              {workspaceSaveError && (
                <p role="alert" className="workspace-name-error text-destructive">
                  {workspaceSaveError}
                </p>
              )}
              <DialogFooter className="workspace-name-footer">
                <DialogClose
                  render={<Button variant="outline" />}
                  className="workspace-name-cancel"
                  disabled={savingWorkspace}
                >
                  取消
                </DialogClose>
                <Button
                  type="submit"
                  className="workspace-name-confirm"
                  disabled={savingWorkspace || !!state.removingWorkspace}
                >
                  {savingWorkspace ? '正在保存…' : workspaceDialog?.id ? '保存修改' : '创建工作区'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={pendingWorkspace !== undefined || projectToRemove !== null}
          onOpenChange={(open, details) => {
            if (state.removingWorkspace) {
              details.cancel()
              return
            }
            if (!open) {
              setWorkspaceToRemove(null)
              setProjectToRemove(null)
            }
          }}
        >
          <AlertDialogContent
            className="workspace-removal-dialog"
            initialFocus={cancelWorkspaceRemoval}
            finalFocus={() =>
              menuTrigger.current?.isConnected
                ? menuTrigger.current
                : document.querySelector<HTMLButtonElement>('.project-add-button')
            }
          >
            <AlertDialogHeader className="workspace-removal-header">
              <AlertDialogTitle className="workspace-removal-title">
                {projectToRemove ? '删除项目？' : '删除工作区？'}
              </AlertDialogTitle>
              <AlertDialogDescription className="workspace-removal-description">
                {projectToRemove
                  ? '将删除该项目的所有工作区并结束其中的终端和程序，终端输出不保留。不会删除本地文件。'
                  : '将结束该工作区的所有终端和程序，终端输出不保留。不影响其他工作区或本地文件。'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="workspace-removal-name min-w-0 text-xs break-all text-muted-foreground">
              {projectToRemove ||
                (pendingWorkspace &&
                  `${folderName(pendingWorkspace.projectPath)} / ${pendingWorkspace.name}`)}
            </p>
            <AlertDialogFooter className="workspace-removal-footer">
              <AlertDialogCancel
                ref={cancelWorkspaceRemoval}
                className="workspace-removal-cancel"
                disabled={!!state.removingWorkspace}
              >
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="workspace-removal-confirm"
                disabled={!!state.removingWorkspace}
                onClick={async () => {
                  if (state.removingWorkspace) return
                  if (projectToRemove) await state.removeProject(projectToRemove)
                  else if (workspaceToRemove) await state.removeWorkspace(workspaceToRemove)
                  setWorkspaceToRemove(null)
                  setProjectToRemove(null)
                }}
              >
                {state.removingWorkspace
                  ? '正在删除…'
                  : projectToRemove
                    ? '删除项目'
                    : '删除工作区'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}
