import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { workspaceFormSchema } from './lib/form-schemas'
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FileDiff,
  GitFork,
  MoreHorizontal,
  Pencil,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
  CircleDot,
} from 'lucide-react'
import {
  currentWorkspace,
  nextWorkspaceName,
  terminalTabId,
  terminalTabs,
  useWorkspace,
} from './store'
import { unwrap, type WorkspaceTarget } from '../../shared/contracts'
import { gitFileKey } from '../../shared/source-control'
import { TerminalTabList } from './components/TerminalTabList'
import { TerminalTab } from './components/TerminalTab'
import { WorkspaceTab } from './components/WorkspaceTab'
import { TerminalWorkspace } from './components/TerminalWorkspace'
import { TopStatusBar } from './components/TopStatusBar'
import { OpenWorkspaceButton } from './components/OpenWorkspaceButton'
import { QuickCommandsButton } from './components/QuickCommandsButton'
import { RightPanel } from './components/RightPanel'
import { SourceControlDiff } from './components/SourceControlDiff'
import { FilePreview } from './components/FilePreview'
import { useFileExplorer } from './lib/file-explorer-store'
import { SourceControlChanges } from './components/SourceControlChanges'
import { FileTypeIcon } from './components/FileTypeIcon'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from './lib/source-control-store'
import { AgentMenu } from './components/AgentMenu'
import { DotStatus } from './components/DotStatus'
import { AgentIcon } from './components/AgentIcon'
import {
  AGENT_STATE_LABELS,
  agentIndicatorState,
  agentTabState,
  workspaceAgentSummary,
} from './lib/agent-status'
import { WorktreeDialog } from './components/WorktreeDialog'
import { WorktreeSetupConfigDialog } from './components/WorktreeSetupConfigDialog'
import { WorktreeSetupDialog } from './components/WorktreeSetupDialog'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Tabs } from './components/ui/tabs'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/ui/empty'
import { Separator } from './components/ui/separator'
import { Toaster } from './components/ui/sonner'
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
  ContextMenuTrigger,
} from './components/ui/context-menu'
import { cn, shortenPath } from './lib/utils'
import { useProjectBranches } from './lib/use-project-branches'
import { formatShortcut, shortcutBinding } from '../../shared/shortcuts'

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export function App() {
  const state = useWorkspace()
  const shortcutLabel = (id: string) =>
    formatShortcut(
      shortcutBinding(state.preferences.shortcuts, id, window.desktop.platform),
      window.desktop.platform,
    )
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const settingsOpen = pathname === '/settings'
  const cortanaOpen = pathname.startsWith('/cortana')
  const secondaryPageOpen = settingsOpen || cortanaOpen
  const projectBranches = useProjectBranches(state.workspaces)
  const [worktreeProject, setWorktreeProject] = useState<string>()
  const [setupProject, setSetupProject] = useState<string>()
  const [setupTarget, setSetupTarget] = useState<{ target: WorkspaceTarget; error?: string }>()
  const [rightTab, setRightTab] = useState('files')
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(240)
  const activeNavigation = settingsOpen ? 'settings' : cortanaOpen ? 'cortana' : 'home'
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
    // Worktree checks are external requests; lock the dialog while refreshing their snapshot.
    // oxlint-disable-next-line react/set-state-in-effect
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
  const repository = activeWorkspace && state.worktreeScans[activeWorkspace.projectPath]?.repository
  const gitAvailable = !!repository && repository.status !== 'nonGit'
  const activeRightTab = rightTab === 'git' && !gitAvailable ? 'files' : rightTab
  const currentTabs = terminalTabs(state).filter((tab) => tab.workspaceId === workspaceId)
  const activeId = state.activeTabs[workspaceId || '']
  const sourceControl = useSourceControl(
    (state) => state.sessions[workspaceId || ''] || EMPTY_SOURCE_CONTROL,
  )
  const previewSelection = sourceControl.selection
  const hasPreview = !!sourceControl.file || !!previewSelection
  const previewPath = sourceControl.file || previewSelection?.path || ''
  const previewTitle = `${folderName(previewPath)}${previewSelection ? '（Diff）' : ''}`
  const activePinnedDiff = sourceControl.activePinnedDiff
  const showingPreview = hasPreview && sourceControl.preview
  const showingChanges = sourceControl.changesOpen && sourceControl.changesActive
  const showingDiff = showingPreview || showingChanges || !!activePinnedDiff
  function focusActiveTab() {
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(
          '.terminal-tab-list [role="tab"][aria-selected="true"]',
        ) || document.getElementById('right-panel-toggle')
      )?.focus(),
    )
  }
  function pinPreview() {
    if (!workspaceId || !previewSelection || state.removingWorkspace) return
    useSourceControl.getState().pinDiff(workspaceId)
    requestAnimationFrame(() =>
      document
        .getElementById(
          `source-control-pinned-tab-${workspaceId}-${encodeURIComponent(gitFileKey(previewSelection))}`,
        )
        ?.focus(),
    )
  }
  function closeWorkspaceTab(key: string, active: boolean) {
    if (!workspaceId) return
    state.closeWorkspaceTab(workspaceId, key)
    if (active) focusActiveTab()
  }
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
    const explorer = useFileExplorer.getState()
    if (Object.keys(explorer.sessions).some((id) => !ids.has(id))) {
      useFileExplorer.setState({
        sessions: Object.fromEntries(
          Object.entries(explorer.sessions).filter(([id]) => ids.has(id)),
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

  if (state.bootstrapError) throw new Error(state.bootstrapError)

  return (
    <TooltipProvider delay={300}>
      <Tabs
        value={activeRightTab}
        onValueChange={(value) => setRightTab(String(value))}
        className="app-container flex h-screen w-screen flex-col gap-0 overflow-hidden bg-muted text-foreground select-none"
        data-platform={window.desktop.platform}
      >
        <TopStatusBar
          secondaryPageOpen={secondaryPageOpen}
          gitAvailable={gitAvailable}
          sidebarWidth={secondaryPageOpen ? 240 : projectSidebarWidth + 1}
          onBack={() => void router.navigate({ to: '/' })}
        >
          {/* 终端标签栏 */}
          {!secondaryPageOpen && (
            <div className="terminal-tabs-region flex h-full min-w-0 flex-1 items-center gap-1">
              <Separator
                aria-hidden="true"
                orientation="vertical"
                className="terminal-tabs-separator bg-titlebar-separator data-vertical:h-4 data-vertical:self-center"
              />
              {state.selectedProject && (
                <>
                  {workspaceId &&
                    (currentTabs.length > 0 ||
                      hasPreview ||
                      sourceControl.changesOpen ||
                      sourceControl.pinnedDiffs.length > 0) && (
                      <TerminalTabList
                        key={workspaceId}
                        workspaceId={workspaceId}
                        tabs={currentTabs}
                        order={sourceControl.tabOrder}
                        disabled={!!state.removingWorkspace}
                      >
                        {sourceControl.tabOrder.map((key, index) => {
                          const tab = currentTabs.find((tab) => key === `terminal:${tab.id}`)
                          if (tab)
                            return (
                              <TerminalTab
                                key={key}
                                tab={tab}
                                indicatorTab={tab.indicatorTab}
                                index={index}
                                active={
                                  !showingDiff && tab.id === terminalTabId(state, activeId || '')
                                }
                                closeDisabled={
                                  tab.status === 'starting' ||
                                  !!tab.closingStatus ||
                                  !!state.removingWorkspace
                                }
                                onSelect={() =>
                                  state.selectWorkspaceTab(tab.workspaceId, `terminal:${tab.id}`)
                                }
                                onClose={() => void state.closeTab(tab.id)}
                              />
                            )
                          if (key === 'changes')
                            return (
                              <WorkspaceTab
                                key={key}
                                id={`source-control-changes-tab-${workspaceId}`}
                                aria-controls={`source-control-changes-panel-${workspaceId}`}
                                title="全部变更"
                                label="全部变更"
                                active={showingChanges}
                                width={112}
                                className="source-control-changes-workspace-tab"
                                onSelect={() =>
                                  useSourceControl.getState().openChanges(workspaceId)
                                }
                                onClose={() => closeWorkspaceTab(key, showingChanges)}
                                closeDisabled={!!state.removingWorkspace}
                                icon={
                                  <FileDiff
                                    className="source-control-changes-tab-icon size-3.5 shrink-0"
                                    aria-hidden="true"
                                  />
                                }
                              />
                            )
                          const selection = sourceControl.pinnedDiffs.find(
                            (selection) => key === `diff:${gitFileKey(selection)}`,
                          )
                          if (selection) {
                            const diffKey = gitFileKey(selection)
                            const label = `${folderName(selection.path)}（Diff）`
                            const active =
                              !!activePinnedDiff && gitFileKey(activePinnedDiff) === diffKey
                            return (
                              <WorkspaceTab
                                key={key}
                                id={`source-control-pinned-tab-${workspaceId}-${encodeURIComponent(diffKey)}`}
                                aria-controls={`source-control-pinned-panel-${workspaceId}-${encodeURIComponent(diffKey)}`}
                                aria-label={`${selection.path}（Diff）`}
                                title={`${selection.path}（Diff）`}
                                label={label}
                                active={active}
                                className="source-control-pinned-tab"
                                onSelect={() =>
                                  useSourceControl.getState().selectPinnedDiff(workspaceId, diffKey)
                                }
                                onClose={() => closeWorkspaceTab(key, active)}
                                closeDisabled={!!state.removingWorkspace}
                                closeLabel={`关闭 ${selection.path}（Diff）`}
                                icon={<FileTypeIcon path={selection.path} />}
                              />
                            )
                          }
                          if (key === 'preview' && hasPreview)
                            return (
                              <WorkspaceTab
                                key={key}
                                id={`source-control-tab-${workspaceId}`}
                                aria-controls={`source-control-panel-${workspaceId}`}
                                aria-label={`${previewPath}${previewSelection ? '（Diff）' : ''} 预览`}
                                title={`${previewPath}${previewSelection ? '（Diff） · 双击或 Enter 固定' : ''}`}
                                label={previewTitle}
                                active={showingPreview}
                                className="source-control-preview-tab"
                                data-diff={!!previewSelection}
                                onDoubleClick={(event) => {
                                  if (
                                    !state.removingWorkspace &&
                                    event.target instanceof Element &&
                                    !event.target.closest('button')
                                  )
                                    pinPreview()
                                }}
                                onKeyDownCapture={(event) => {
                                  if (
                                    showingPreview &&
                                    previewSelection &&
                                    event.target === event.currentTarget &&
                                    event.key === 'Enter' &&
                                    !event.metaKey &&
                                    !event.ctrlKey &&
                                    !event.altKey &&
                                    !event.shiftKey
                                  ) {
                                    event.preventDefault()
                                    pinPreview()
                                  }
                                }}
                                onSelect={() => {
                                  if (workspaceId)
                                    useSourceControl
                                      .getState()
                                      .update(workspaceId, { preview: true })
                                }}
                                onClose={() => closeWorkspaceTab(key, showingPreview)}
                                closeLabel={`关闭 ${previewPath}${previewSelection ? '（Diff）' : ''} 预览`}
                                closeDisabled={!!state.removingWorkspace}
                                icon={<FileTypeIcon path={previewPath} />}
                              />
                            )
                          return null
                        })}
                      </TerminalTabList>
                    )}
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
                  >
                    <Plus className="terminal-tab-new-icon" />
                  </Button>
                </>
              )}
              <div className="workspace-header-spacer min-w-0 flex-1" />
              {activeWorkspace && (
                <>
                  <QuickCommandsButton
                    key={`commands-${activeWorkspace.id}`}
                    workspace={activeWorkspace}
                  />
                  <OpenWorkspaceButton key={activeWorkspace.id} workspace={activeWorkspace} />
                </>
              )}
            </div>
          )}
        </TopStatusBar>
        <div className="app-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <nav
            aria-label="主导航"
            className="primary-navigation flex w-[var(--app-navigation-width)] shrink-0 flex-col justify-between pt-2 pb-3"
          >
            <div className="primary-navigation-top flex flex-col items-center gap-2">
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
                      aria-label="Cortana"
                      aria-current={cortanaOpen ? 'page' : undefined}
                      className="nav-cortana-button"
                      data-active={cortanaOpen}
                      onClick={() => void router.navigate({ to: '/cortana/accounts' })}
                    />
                  }
                >
                  <CircleDot className="nav-cortana-icon" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="right">Cortana</TooltipContent>
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
                <TooltipContent side="right">设置 {shortcutLabel('settings')}</TooltipContent>
              </Tooltip>
            </div>
          </nav>
          <div className="workspace-layout flex min-h-0 min-w-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className={cn(
                'workspace-content app-panels flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background',
                // Group 强制内联 display: flex，隐藏时必须覆盖它并保留终端挂载。
                secondaryPageOpen && 'hidden!',
              )}
            >
              <ResizablePanel
                id="workspace-projects"
                defaultSize={240}
                minSize={200}
                maxSize={400}
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size) => {
                  if (!secondaryPageOpen && size.inPixels > 0) setProjectSidebarWidth(size.inPixels)
                }}
                className="project-sidebar-panel flex min-h-0 min-w-0 flex-col"
                style={{ overflow: 'hidden' }}
              >
                <aside
                  className="project-sidebar flex min-h-0 flex-1 flex-col bg-muted/40 text-app-muted-foreground"
                  aria-label="项目"
                >
                  <div className="project-header group/header flex h-12 shrink-0 items-center justify-between px-4">
                    <h2 className="project-title">项目</h2>
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
                      <TooltipContent side="bottom">
                        添加项目 {shortcutLabel('open-folder')}
                      </TooltipContent>
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
                                className="project-folder-trigger w-full min-w-0 justify-start gap-2 px-2 bg-transparent text-inherit hover:bg-transparent hover:text-inherit"
                                title={path}
                                disabled={!!state.removingWorkspace}
                              />
                            </h3>
                            {state.worktreeScans[path]?.repository.status === 'ready' && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={<Button variant="project" size="icon-sm" />}
                                  className={cn(
                                    'project-worktree-add-button bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent',
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
                                        'project-folder-menu-trigger shrink-0 bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent',
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
                                      workspaceForm.reset(
                                        { name: nextWorkspaceName(path, state.workspaces) },
                                        { keepDefaultValues: true },
                                      )
                                      setWorkspaceSaveError(undefined)
                                      setWorkspaceDialog({ projectPath: path })
                                    }}
                                  >
                                    新建工作区
                                  </DropdownMenuItem>
                                  {state.worktreeScans[path]?.repository.status === 'ready' && (
                                    <DropdownMenuItem
                                      className="project-worktree-setup-item"
                                      disabled={!state.ready || !!state.removingWorkspace}
                                      onClick={() => setSetupProject(path)}
                                    >
                                      工作树初始化配置
                                    </DropdownMenuItem>
                                  )}
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
                                  <ContextMenuTrigger
                                    className={cn(
                                      'project-item group relative isolate ml-3 flex flex-col items-stretch rounded-md transition-colors',
                                      isSelected
                                        ? 'project-item-active bg-sidebar-accent text-sidebar-accent-foreground'
                                        : 'project-item-inactive text-app-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                    )}
                                    onContextMenu={(event) => {
                                      menuTrigger.current =
                                        event.currentTarget.querySelector<HTMLButtonElement>(
                                          '.project-item-button',
                                        )
                                    }}
                                  >
                                    <Button
                                      variant="ghost"
                                      disabled={!!state.removingWorkspace}
                                      data-active={isSelected}
                                      aria-label={`${folderName(path)} ${workspace.name}${workspace.kind === 'git-worktree' ? '，Git Worktree' : ''}，${hasTerminals ? '有终端' : '无终端'}${agentSummary ? `，Agent ${agentSummary.description}` : ''}${branch ? `，分支 ${branch}` : ''}`}
                                      aria-current={isSelected ? 'page' : undefined}
                                      aria-haspopup="menu"
                                      className="project-item-button grid h-auto min-h-9 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-2 gap-y-0 border-0 px-2 py-2 text-left text-inherit hover:bg-transparent hover:text-inherit focus-visible:ring-0 dark:hover:bg-transparent"
                                      onClick={() => {
                                        void state.selectProject(path, workspace.id)
                                      }}
                                    >
                                      <span
                                        className="project-item-status flex size-3.5 items-center justify-center"
                                        aria-hidden="true"
                                      >
                                        {agentSummary && agentSummary.state !== 'other' ? (
                                          <DotStatus state={agentSummary.state} />
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
                                        {workspace.name}
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
                                          className="project-item-branch col-start-2 truncate text-xs leading-4 font-normal text-app-muted-foreground"
                                          title={branch}
                                        >
                                          {branch}
                                        </span>
                                      )}
                                    </Button>
                                    {workspaceAgents.length > 0 && (
                                      <fieldset
                                        className="project-item-agents ml-7.5 flex min-w-0 flex-wrap gap-1 border-0 p-0 pr-2 pb-2"
                                        aria-label={`${workspace.name} Agent 列表`}
                                      >
                                        {workspaceAgents.map((tab) => {
                                          const agentState = agentTabState(tab)
                                          const agentActive =
                                            isSelected &&
                                            activeNavigation === 'home' &&
                                            state.activeTabs[workspace.id] === tab.id
                                          const label = `${shortenPath(tab.cwd || tab.projectPath)} · ${AGENT_STATE_LABELS[agentState]}`
                                          return (
                                            <Button
                                              key={tab.id}
                                              variant="project"
                                              size="icon"
                                              className="project-item-agent-button relative text-inherit"
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
                                                  void router.navigate({ to: '/' })
                                                }
                                              }}
                                            >
                                              <span
                                                className="project-item-agent-provider relative inline-flex size-3.5 shrink-0"
                                                aria-hidden="true"
                                              >
                                                <AgentIcon
                                                  provider={tab.provider || tab.agent?.provider}
                                                  size={14}
                                                  className="project-item-agent-provider-icon size-3.5 shrink-0"
                                                />
                                                {agentIndicatorState(tab) !== 'other' && (
                                                  <span
                                                    className={cn(
                                                      'project-item-agent-status pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex rounded-full p-px [&_.dot-status]:size-2',
                                                      agentActive ? 'bg-background' : 'bg-muted',
                                                    )}
                                                  >
                                                    <DotStatus state={agentState} />
                                                  </span>
                                                )}
                                              </span>
                                            </Button>
                                          )
                                        })}
                                      </fieldset>
                                    )}
                                  </ContextMenuTrigger>
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
                                      {workspace.kind === 'git-worktree' && (
                                        <ContextMenuItem
                                          className="workspace-initialize-item"
                                          disabled={
                                            !state.ready ||
                                            !!state.removingWorkspace ||
                                            scanEntry?.status !== 'ready'
                                          }
                                          onClick={() =>
                                            setSetupTarget({
                                              target: {
                                                projectPath: path,
                                                workspaceId: workspace.id,
                                              },
                                            })
                                          }
                                        >
                                          初始化环境 / 查看日志
                                        </ContextMenuItem>
                                      )}
                                      <ContextMenuItem
                                        disabled={!!state.removingWorkspace}
                                        className="workspace-edit-item"
                                        onClick={() => {
                                          workspaceDialogTrigger.current = menuTrigger.current
                                          workspaceForm.reset(
                                            { name: workspace.name },
                                            { keepDefaultValues: true },
                                          )
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
                            点击上方 + 或按 {shortcutLabel('open-folder')} 添加
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </nav>
                </aside>
              </ResizablePanel>
              <ResizableHandle
                className="workspace-resize-handle project-sidebar-resize-handle"
                aria-label="调整项目面板宽度"
              />
              <ResizablePanel
                id="workspace-main"
                minSize={200}
                className="workspace-main-panel flex min-h-0 min-w-0 flex-col"
                style={{ overflow: 'hidden' }}
              >
                {/* 保持终端挂载，文件 / Diff 预览仅切换可见区域。 */}
                <main
                  className="terminal-workspace flex min-h-0 min-w-0 flex-1 flex-col"
                  aria-label={
                    showingDiff
                      ? showingPreview && sourceControl.file
                        ? '文件预览工作区'
                        : '变更审阅工作区'
                      : '终端工作区'
                  }
                >
                  {state.worktreeError && (
                    <p
                      className="workspace-worktree-error px-4 py-2 text-xs text-destructive break-words"
                      role="alert"
                    >
                      {state.worktreeError}
                    </p>
                  )}
                  {sourceControl.changesOpen && activeWorkspace && (
                    <div
                      className={cn(
                        'source-control-changes-stage min-h-0 min-w-0 flex-1 flex-col',
                        showingChanges ? 'flex' : 'hidden',
                      )}
                    >
                      <SourceControlChanges
                        key={activeWorkspace.id}
                        workspace={activeWorkspace}
                        active={!secondaryPageOpen && showingChanges}
                      />
                    </div>
                  )}
                  {showingPreview && activeWorkspace && sourceControl.file && (
                    <FilePreview
                      key={`${activeWorkspace.id}:${sourceControl.file}`}
                      workspace={activeWorkspace}
                      path={sourceControl.file}
                      active={!secondaryPageOpen}
                    />
                  )}
                  {activeWorkspace &&
                    (activePinnedDiff || (showingPreview && previewSelection)) && (
                      <SourceControlDiff
                        key={activeWorkspace.id}
                        workspace={activeWorkspace}
                        active={!secondaryPageOpen}
                      />
                    )}
                  <div
                    className={cn(
                      'terminal-stage-container grid grid-cols-1 grid-rows-1 min-h-0 flex-1 overflow-hidden',
                      showingDiff && 'hidden',
                    )}
                  >
                    <TerminalWorkspace
                      activeId={activeId}
                      visible={!secondaryPageOpen && !showingDiff && activeNavigation === 'home'}
                    />
                    {!state.selectedProject && (
                      <div className="workspace-empty-state col-start-1 row-start-1 flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <FolderOpen className="workspace-empty-icon size-6 text-app-muted-foreground" />
                        <div className="workspace-empty-content">
                          <h3 className="workspace-empty-title text-sm font-medium text-foreground">
                            {projects.length ? '未选择工作区' : '没有打开的项目'}
                          </h3>
                          <p className="workspace-empty-desc mt-1 text-xs text-app-muted-foreground">
                            {projects.length
                              ? `从左侧选择一个工作区，或使用快捷键 ${shortcutLabel('open-folder')} 打开新项目。`
                              : `从左侧选择最近项目，或使用快捷键 ${shortcutLabel('open-folder')} 打开新项目。`}
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
                          打开项目 ({shortcutLabel('open-folder')})
                        </Button>
                      </div>
                    )}
                    {state.selectedProject && !currentTabs.length && (
                      <div className="terminal-empty-state col-start-1 row-start-1 flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <TerminalIcon className="terminal-empty-icon size-6 text-app-muted-foreground" />
                        <div className="terminal-empty-content">
                          <h3 className="terminal-empty-title text-sm font-medium text-foreground">
                            当前工作区没有运行中的终端
                          </h3>
                          <p className="terminal-empty-desc mt-1 text-xs text-app-muted-foreground">
                            点击上方 + 按钮，或使用快捷键 {shortcutLabel('new-terminal')} 新建终端。
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="terminal-empty-action mt-1"
                          disabled={!!state.removingWorkspace}
                          onClick={() => state.newTerminal()}
                        >
                          新建终端 ({shortcutLabel('new-terminal')})
                        </Button>
                      </div>
                    )}
                  </div>
                </main>
              </ResizablePanel>
              <RightPanel
                workspace={activeWorkspace}
                active={!secondaryPageOpen}
                filesActive={activeRightTab === 'files'}
                gitAvailable={gitAvailable}
              />
            </ResizablePanelGroup>

            <Outlet />
          </div>
        </div>

        {worktreeProject && (
          <WorktreeDialog
            key={worktreeProject}
            projectPath={worktreeProject}
            close={() => setWorktreeProject(undefined)}
            initialized={(target, error) => setSetupTarget({ target, error })}
          />
        )}
        {setupProject && (
          <WorktreeSetupConfigDialog
            key={setupProject}
            projectPath={setupProject}
            close={() => setSetupProject(undefined)}
          />
        )}
        {setupTarget && (
          <WorktreeSetupDialog
            key={setupTarget.target.workspaceId}
            target={setupTarget.target}
            initialError={setupTarget.error}
            close={() => setSetupTarget(undefined)}
            configure={() => {
              setSetupProject(setupTarget.target.projectPath)
              setSetupTarget(undefined)
            }}
          />
        )}
        <Toaster
          closeButton
          containerAriaLabel="操作结果提示"
          toastOptions={{ duration: 6000, closeButtonAriaLabel: '关闭提示' }}
        />

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
                  <p className="workspace-worktree-path break-all text-app-muted-foreground">
                    {editingRecord.path}
                  </p>
                  <output
                    className="workspace-worktree-status text-app-muted-foreground"
                    aria-busy={checkingWorktree}
                  >
                    {!checkingWorktree &&
                      (editingScan?.error ||
                        (editingScan?.status === 'ready'
                          ? editingScan.worktree?.locked
                            ? '工作树已锁定'
                            : '工作树就绪'
                          : '工作树状态暂不可用'))}
                  </output>
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
                  {workspaceDialog?.id ? '保存修改' : '创建工作区'}
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
            <p className="workspace-removal-name min-w-0 text-xs break-all text-app-muted-foreground">
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
                {projectToRemove ? '删除项目' : '删除工作区'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Tabs>
    </TooltipProvider>
  )
}
