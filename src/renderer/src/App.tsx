import { useEffect, useRef, useState } from 'react'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour'
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { currentWorkspace, nextWorkspaceName, useWorkspace } from './store'
import { TerminalTab } from './components/TerminalTab'
import { TerminalView } from './components/TerminalView'
import { Settings } from './components/Settings'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { Button } from './components/ui/button'
import { Separator } from './components/ui/separator'
import { Input } from './components/ui/input'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
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
import { cn } from './lib/utils'
import { useProjectBranches } from './lib/use-project-branches'

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() || '/'
}

export function App() {
  const state = useWorkspace()
  const projectBranches = useProjectBranches(state.workspaces)
  const [navigation, setNavigation] = useState<'home' | 'placeholder'>('home')
  const activeNavigation = state.settingsOpen ? 'settings' : navigation
  const menuTrigger = useRef<HTMLElement | null>(null)
  const cancelWorkspaceRemoval = useRef<HTMLButtonElement | null>(null)
  const [workspaceToRemove, setWorkspaceToRemove] = useState<string | null>(null)
  const [projectToRemove, setProjectToRemove] = useState<string | null>(null)
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({})
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    projectPath: string
    id?: string
  } | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string>()
  const workspaceSavePending = useRef(false)
  const workspaceDialogTrigger = useRef<HTMLElement | null>(null)
  const workspaceNameInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void useWorkspace.getState().bootstrap()
    return window.desktop.onShortcut((shortcut) => useWorkspace.getState().shortcut(shortcut))
  }, [])

  const activeWorkspace = currentWorkspace(state)
  const workspaceId = activeWorkspace?.id
  const currentTabs = state.tabs.filter((tab) => tab.workspaceId === workspaceId)
  const activeId = state.activeTabs[workspaceId || '']
  const pendingWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceToRemove)
  // Keep projects with workspaces or terminals reachable outside the recent 20.
  const projects = [
    ...new Set([
      ...state.projects,
      ...state.workspaces.map((workspace) => workspace.projectPath),
      ...state.tabs.map((tab) => tab.projectPath),
    ]),
  ]

  return (
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
          <Button
            type="button"
            variant="navigation"
            size="icon-xl"
            aria-label="首页"
            aria-current={activeNavigation === 'home' ? 'page' : undefined}
            title="首页"
            className="nav-home-button"
            data-active={activeNavigation === 'home'}
            onClick={() => {
              setNavigation('home')
              if (state.settingsOpen) useWorkspace.setState({ settingsOpen: false })
            }}
          >
            <HouseIcon
              className="nav-home-icon"
              aria-hidden="true"
              weight={activeNavigation === 'home' ? 'fill' : 'regular'}
            />
          </Button>
          <Button
            type="button"
            variant="navigation"
            size="icon-xl"
            aria-label="占位导航（仅测试样式）"
            aria-pressed={activeNavigation === 'placeholder'}
            title="占位导航（仅测试激活样式）"
            className="nav-placeholder-button"
            data-active={activeNavigation === 'placeholder'}
            onClick={() => setNavigation('placeholder')}
          >
            <SquaresFourIcon
              className="nav-placeholder-icon"
              aria-hidden="true"
              weight={activeNavigation === 'placeholder' ? 'fill' : 'regular'}
            />
          </Button>
        </div>
        <div className="primary-navigation-bottom flex flex-col items-center">
          <Button
            variant="navigation"
            size="icon-xl"
            className="nav-settings-button"
            data-active={state.settingsOpen}
            aria-label="打开设置"
            aria-current={state.settingsOpen ? 'page' : undefined}
            aria-expanded={state.settingsOpen}
            title="设置 ⌘,"
            onClick={() => useWorkspace.setState((s) => ({ settingsOpen: !s.settingsOpen }))}
          >
            <GearSixIcon
              className="nav-settings-icon"
              aria-hidden="true"
              weight={state.settingsOpen ? 'fill' : 'regular'}
            />
          </Button>
        </div>
      </nav>

      {/* 2. 主区域（顶栏浅色背景，下方纯白工作台连成一体） */}
      <div className="workspace-layout flex min-w-0 flex-1 flex-col">
        {/* 导航按钮左侧为原生红绿灯保留空间。 */}
        <header className="workspace-header title-bar flex h-[44px] shrink-0 items-center pr-3">
          <nav
            aria-label="历史导航"
            className="title-bar-history flex h-full w-60 shrink-0 items-center gap-1 pl-12"
          >
            <Button
              type="button"
              variant="navigation"
              size="icon"
              className="history-back-button"
              aria-label="后退"
              disabled={!state.settingsOpen}
              title={state.settingsOpen ? '后退到工作区' : '后退（功能待接入）'}
              onClick={() => {
                if (state.settingsOpen) useWorkspace.setState({ settingsOpen: false })
              }}
            >
              <ArrowLeft className="history-back-icon" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="navigation"
              size="icon"
              className="history-forward-button"
              aria-label="前进"
              disabled
              title="前进（功能待接入）"
            >
              <ArrowRight className="history-forward-icon" aria-hidden="true" />
            </Button>
          </nav>

          {/* 终端标签栏 */}
          {!state.settingsOpen && (
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
                        if ((event.target as HTMLElement).getAttribute('role') !== 'tab') return
                        const index = currentTabs.findIndex((tab) => tab.id === activeId)
                        const next =
                          event.key === 'ArrowRight'
                            ? currentTabs[(index + 1) % currentTabs.length]
                            : event.key === 'ArrowLeft'
                              ? currentTabs[(index - 1 + currentTabs.length) % currentTabs.length]
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
                          active={tab.id === activeId}
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
                  <Button
                    variant="navigation"
                    size="icon"
                    className="terminal-tab-new-button shrink-0"
                    disabled={!activeWorkspace || !!state.removingWorkspace}
                    aria-label="新建终端"
                    title="新建终端 ⌘T"
                    onClick={state.newTerminal}
                  >
                    <Plus className="terminal-tab-new-icon" />
                  </Button>
                </>
              )}
            </div>
          )}
        </header>

        {/* 项目侧栏与终端共用工作区，保留左上角圆角。 */}
        <div
          className={cn(
            'workspace-content flex min-h-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-card',
            state.settingsOpen && 'hidden',
          )}
        >
          {/* 侧栏使用 preset 的 sidebar token。 */}
          <aside
            className="project-sidebar flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
            aria-label="项目"
          >
            <div className="project-header group/header flex h-8 shrink-0 items-center justify-between px-3">
              <h2 className="project-title text-xs font-medium text-muted-foreground">项目</h2>
              <Button
                variant="ghost"
                size="icon"
                className="project-add-button opacity-0 transition-opacity focus-visible:opacity-100 group-hover/header:opacity-100"
                disabled={!state.ready || !!state.removingWorkspace}
                aria-label="添加项目"
                title="添加项目 ⌘O"
                onClick={() => {
                  void state.openProject()
                }}
              >
                <Plus className="project-add-icon" />
              </Button>
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
                    <div className="project-folder-row group/folder flex items-center">
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
                          className="project-folder-trigger w-full min-w-0 justify-start gap-2 px-2.5"
                          title={path}
                          disabled={!!state.removingWorkspace}
                        />
                      </h3>
                      <Button
                        variant="project"
                        size="icon-sm"
                        className={cn(
                          'project-workspace-add-button',
                          activeWorkspace?.projectPath !== path &&
                            'invisible group-focus-within/folder:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
                        )}
                        aria-label={`${folderName(path)} 新建工作区`}
                        title="新建工作区"
                        disabled={!state.ready || !!state.removingWorkspace}
                        onClick={(event) => {
                          workspaceDialogTrigger.current = event.currentTarget
                          setWorkspaceName(nextWorkspaceName(path, state.workspaces))
                          setWorkspaceSaveError(undefined)
                          setWorkspaceDialog({ projectPath: path })
                        }}
                      >
                        <Plus className="project-workspace-add-icon size-3.5" />
                      </Button>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger
                          render={<Button variant="project" size="icon-sm" />}
                          className={cn(
                            'project-folder-menu-trigger shrink-0',
                            activeWorkspace?.projectPath !== path &&
                              'invisible group-focus-within/folder:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
                          )}
                          disabled={!!state.removingWorkspace}
                          aria-label={`${folderName(path)} 项目更多操作`}
                          title="项目更多操作"
                          onFocus={(event) => {
                            menuTrigger.current = event.currentTarget
                          }}
                        >
                          <MoreHorizontal className="project-folder-menu-icon size-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          aria-label={`${folderName(path)} 项目操作菜单`}
                          className="project-folder-dropdown-menu"
                        >
                          <DropdownMenuGroup className="project-folder-menu-actions">
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
                        const branch = projectBranches[path]
                        const hasTerminals = state.tabs.some(
                          (tab) => tab.workspaceId === workspace.id,
                        )
                        return (
                          <ContextMenu key={workspace.id} disabled={!!state.removingWorkspace}>
                            <div
                              className={cn(
                                'project-item group ml-3 flex items-center justify-between rounded-md transition-colors',
                                isSelected
                                  ? 'project-item-active bg-project-active text-foreground hover:bg-project-active-hover'
                                  : 'project-item-inactive text-muted-foreground hover:bg-project-hover hover:text-foreground',
                              )}
                            >
                              <ContextMenuTrigger
                                render={
                                  <Button variant="ghost" disabled={!!state.removingWorkspace} />
                                }
                                data-active={isSelected}
                                aria-label={`${folderName(path)} ${workspace.name}，${hasTerminals ? '有终端' : '无终端'}${branch ? `，分支 ${branch}` : ''}`}
                                aria-current={isSelected ? 'page' : undefined}
                                title={path}
                                aria-haspopup="menu"
                                className="project-item-button grid h-auto min-h-9 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-2 gap-y-0 border-0 px-2.5 py-2 text-left hover:bg-transparent"
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
                                  title={hasTerminals ? '有终端' : '无终端'}
                                >
                                  <span
                                    className={cn(
                                      'project-item-status-dot size-1.5 rounded-full',
                                      hasTerminals
                                        ? 'bg-workspace-status-active'
                                        : 'bg-workspace-status-idle',
                                    )}
                                  />
                                </span>
                                <span className="project-item-name truncate">
                                  {state.removingWorkspace === workspace.id
                                    ? '正在删除…'
                                    : workspace.name}
                                </span>
                                {branch && (
                                  <span
                                    className="project-item-branch col-start-2 truncate text-xs leading-4 font-normal text-muted-foreground"
                                    title={branch}
                                  >
                                    {branch}
                                  </span>
                                )}
                              </ContextMenuTrigger>
                            </div>
                            <ContextMenuContent
                              finalFocus={() => menuTrigger.current}
                              aria-label={`${folderName(path)} ${workspace.name} 操作菜单`}
                              className="project-dropdown-menu"
                            >
                              <ContextMenuGroup className="project-menu-actions">
                                <ContextMenuItem
                                  disabled={!!state.removingWorkspace}
                                  className="workspace-edit-item"
                                  onClick={() => {
                                    workspaceDialogTrigger.current = menuTrigger.current
                                    setWorkspaceName(workspace.name)
                                    setWorkspaceSaveError(undefined)
                                    setWorkspaceDialog({ projectPath: path, id: workspace.id })
                                  }}
                                >
                                  <Pencil className="workspace-edit-icon" />
                                  <span className="workspace-edit-label">编辑工作区</span>
                                </ContextMenuItem>
                                <ContextMenuItem
                                  variant="destructive"
                                  title="仅删除此工作区并结束其终端，不影响其他工作区或本地文件"
                                  disabled={!!state.removingWorkspace}
                                  className="workspace-delete-item"
                                  onClick={() => setWorkspaceToRemove(workspace.id)}
                                >
                                  <Trash2 className="workspace-delete-icon" />
                                  <span className="workspace-delete-label">删除工作区</span>
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
                <p className="project-empty-hint px-2.5 py-4 text-xs text-muted-foreground">
                  暂无项目，点击上方 + 或使用 ⌘O 添加。
                </p>
              )}
            </nav>
          </aside>

          {/* 白底终端管理主面板 */}
          <main className="terminal-workspace flex min-w-0 flex-1 flex-col" aria-label="终端工作区">
            <div className="terminal-stage-container grid grid-cols-1 grid-rows-1 min-h-0 flex-1 overflow-hidden">
              {state.tabs.map((tab) => {
                const isSelected = tab.projectPath === state.selectedProject && tab.id === activeId
                return <TerminalView key={tab.id} tab={tab} active={isSelected} />
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
                    onClick={state.newTerminal}
                  >
                    新建终端 (⌘T)
                  </Button>
                </div>
              )}
            </div>

            <footer className="workspace-footer flex h-7 shrink-0 items-center px-3 text-xs text-muted-foreground">
              <span className="workspace-footer-project truncate font-mono">
                {state.selectedProject ? state.selectedProject : '未选择项目'}
              </span>
            </footer>
          </main>
        </div>

        {state.settingsOpen && <Settings />}
      </div>

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
          className="workspace-name-dialog"
          showCloseButton={false}
          initialFocus={() => {
            workspaceNameInput.current?.select()
            return workspaceNameInput.current
          }}
          finalFocus={workspaceDialogTrigger}
        >
          <form
            className="workspace-name-form flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!workspaceDialog || !workspaceName.trim() || workspaceSavePending.current) return
              workspaceSavePending.current = true
              setSavingWorkspace(true)
              setWorkspaceSaveError(undefined)
              try {
                const saved = workspaceDialog.id
                  ? state.renameWorkspace(workspaceDialog.id, workspaceName)
                  : await state.newWorkspace(workspaceDialog.projectPath, workspaceName)
                if (saved) {
                  if (!workspaceDialog.id)
                    setOpenProjects((value) => ({ ...value, [workspaceDialog.projectPath]: true }))
                  setWorkspaceDialog(null)
                } else {
                  setWorkspaceSaveError('无法保存工作区，请检查名称或稍后重试。')
                }
              } finally {
                workspaceSavePending.current = false
                setSavingWorkspace(false)
              }
            }}
          >
            <DialogHeader className="workspace-name-header">
              <DialogTitle className="workspace-name-title">
                {workspaceDialog?.id ? '编辑工作区' : '新建工作区'}
              </DialogTitle>
            </DialogHeader>
            <FieldGroup className="workspace-name-fields">
              <Field className="workspace-name-field" data-disabled={savingWorkspace}>
                <FieldLabel className="workspace-name-label" htmlFor="workspace-name">
                  工作区名称
                </FieldLabel>
                <Input
                  ref={workspaceNameInput}
                  id="workspace-name"
                  className="workspace-name-input"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  disabled={savingWorkspace}
                  required
                  autoComplete="off"
                />
              </Field>
            </FieldGroup>
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
                disabled={savingWorkspace || !workspaceName.trim() || !!state.removingWorkspace}
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
              {state.removingWorkspace ? '正在删除…' : projectToRemove ? '删除项目' : '删除工作区'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
