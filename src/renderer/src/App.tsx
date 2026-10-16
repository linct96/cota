import { useEffect, useRef, useState } from 'react'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour'
import {
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useWorkspace } from './store'
import { TerminalTab } from './components/TerminalTab'
import { TerminalView } from './components/TerminalView'
import { Settings } from './components/Settings'
import { Button } from './components/ui/button'
import { Separator } from './components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { cn } from './lib/utils'

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() || '/'
}

export function App() {
  const state = useWorkspace()
  const [navigation, setNavigation] = useState<'home' | 'placeholder'>('home')
  const activeNavigation = state.settingsOpen ? 'settings' : navigation
  const menuTrigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    void useWorkspace.getState().bootstrap()
    return window.desktop.onShortcut((shortcut) => useWorkspace.getState().shortcut(shortcut))
  }, [])

  const currentTabs = state.tabs.filter((tab) => tab.projectPath === state.selectedProject)
  const activeId = state.activeTabs[state.selectedProject || '']
  // Keep a project reachable while its terminals are open, even if it falls outside the recent 20.
  const projects = [...new Set([...state.projects, ...state.tabs.map((tab) => tab.projectPath)])]

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
            onClick={() => setNavigation('home')}
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
            aria-haspopup="dialog"
            aria-expanded={state.settingsOpen}
            title="设置 ⌘,"
            onClick={() => useWorkspace.setState({ settingsOpen: true })}
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
        {/* 项目上方保持留白，为原生红绿灯和窗口拖动保留空间。 */}
        <header className="workspace-header title-bar flex h-[44px] shrink-0 items-center pr-3">
          <div className="title-bar-project-spacer h-full w-60 shrink-0" aria-hidden="true" />

          {/* 终端标签栏 */}
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
                          !!state.removingProject
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
                  variant="ghost"
                  size="icon-lg"
                  className="terminal-tab-new-button shrink-0"
                  disabled={!!state.removingProject}
                  aria-label="新建终端"
                  title="新建终端 ⌘T"
                  onClick={state.newTerminal}
                >
                  <Plus className="terminal-tab-new-icon" />
                </Button>
              </>
            )}
          </div>
        </header>

        {state.error && (
          <div
            role="alert"
            className="workspace-error flex shrink-0 items-start justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive"
          >
            <p className="workspace-error-text break-all">{state.error}</p>
            <Button
              variant="ghost"
              size="icon"
              className="workspace-error-close"
              aria-label="关闭错误提示"
              onClick={() => state.report()}
            >
              <X className="workspace-error-close-icon" />
            </Button>
          </div>
        )}

        {/* 项目侧栏与终端共用工作区，保留左上角圆角。 */}
        <div className="workspace-content flex min-h-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-card">
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
                disabled={!state.ready || !!state.removingProject}
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
              className="project-list recent-projects flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
              aria-label="最近项目"
            >
              {projects.map((path) => {
                const isSelected = path === state.selectedProject
                const FolderIcon = isSelected ? FolderOpen : Folder

                return (
                  <div
                    key={path}
                    aria-busy={state.removingProject === path}
                    className={cn(
                      'project-item group flex shrink-0 items-center justify-between rounded-md px-2.5 py-1.5 transition-colors',
                      isSelected
                        ? 'project-item-active bg-project-active text-foreground hover:bg-project-active-hover'
                        : 'project-item-inactive text-muted-foreground hover:bg-project-hover hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={folderName(path)}
                      aria-current={isSelected ? 'page' : undefined}
                      title={path}
                      disabled={!!state.removingProject}
                      className="project-item-button min-w-0 flex-1 text-left"
                      onClick={() => {
                        void state.selectProject(path)
                      }}
                    >
                      <span className="project-item-header flex items-center gap-2 text-xs font-medium">
                        <FolderIcon
                          className={cn(
                            'project-item-folder-icon size-3.5 shrink-0 transition-colors',
                            isSelected
                              ? 'text-foreground'
                              : 'text-muted-foreground group-hover:text-foreground',
                          )}
                        />
                        <span className="project-item-name truncate">
                          {state.removingProject === path ? '正在删除…' : folderName(path)}
                        </span>
                      </span>
                    </button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" />}
                        className="project-menu-trigger size-6 shrink-0 rounded-sm text-muted-foreground opacity-0 transition-colors hover:bg-project-action-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:bg-project-action-active data-popup-open:text-foreground data-popup-open:opacity-100"
                        disabled={!!state.removingProject}
                        aria-label={`${folderName(path)} 更多操作`}
                        onFocus={(event) => {
                          menuTrigger.current = event.currentTarget
                        }}
                      >
                        <MoreHorizontal className="project-menu-trigger-icon size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        aria-label={`${folderName(path)} 操作菜单`}
                        className="project-dropdown-menu"
                      >
                        <DropdownMenuGroup className="project-menu-actions">
                          <DropdownMenuItem
                            variant="destructive"
                            title="从 Cota 移除并结束终端，不删除本地文件"
                            disabled={!!state.removingProject}
                            className="project-delete-item"
                            onClick={() => {
                              const trigger = menuTrigger.current
                              void state.removeProject(path).then(() => {
                                if (trigger?.isConnected) trigger.focus()
                              })
                            }}
                          >
                            <Trash2 className="project-delete-icon" />
                            <span className="project-delete-label">删除项目…</span>
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
                      没有打开的项目
                    </h3>
                    <p className="workspace-empty-desc mt-1 text-xs text-muted-foreground">
                      从左侧选择最近项目，或使用快捷键 ⌘O 打开新项目。
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
                      当前项目没有运行中的终端
                    </h3>
                    <p className="terminal-empty-desc mt-1 text-xs text-muted-foreground">
                      点击上方 + 按钮，或使用快捷键 ⌘T 新建终端。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="terminal-empty-action mt-1"
                    disabled={!!state.removingProject}
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
      </div>

      {state.settingsOpen && <Settings />}
    </div>
  )
}
