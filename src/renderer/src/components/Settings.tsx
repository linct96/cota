import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import {
  AppWindow,
  Bell,
  Bot,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Keyboard,
  Play,
  Search,
  Settings as SettingsIcon,
  Sun,
  SquareTerminal,
  X,
} from 'lucide-react'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from './ui/sidebar'
import { GeneralSettings } from './GeneralSettings'
import { NotificationSettings } from './NotificationSettings'
import { SourceControlSettings } from './SourceControlSettings'
import { CodeHostingSettings } from './CodeHostingSettings'
import { TerminalSettings } from './TerminalSettings'
import { OpenWithSettings } from './OpenWithSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { FileExplorerSettings } from './FileExplorerSettings'
import { ShortcutSettings } from './ShortcutSettings'
import { AgentSettings } from './AgentSettings'
import { QuickCommandsSettings } from './QuickCommandsSettings'
import { LoadingContent } from './LoadingContent'
import { useWorkspace } from '../store'
import { useLeftPanel } from '../lib/left-panel-store'
import { cn } from '../lib/utils'

interface SettingItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string
}

interface SettingGroup {
  id: string
  label: string
  items: SettingItem[]
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'personal',
    label: '个人',
    items: [
      {
        id: 'general',
        label: '常规',
        icon: SettingsIcon,
        keywords: '休眠 睡眠 电源 熄灭 agent prevent sleep general',
      },
      {
        id: 'notifications',
        label: '通知',
        icon: Bell,
        keywords: '启用 开关 系统 提醒 提示音 声音 静音 轮次 测试 notification sound',
      },
      {
        id: 'appearance',
        label: '外观',
        icon: Sun,
        keywords:
          '模式 主题 自动 浅色 深色 亮色 暗色 主题色 背景色 前景色 颜色 配色 theme color dark light',
      },
      {
        id: 'terminal',
        label: '终端',
        icon: SquareTerminal,
        keywords:
          'shell zsh bash fish pwsh 缓冲 行数 scrollback gpu webgl 加速 渲染 字体 字号 行高 光标 配色 主题 透明度 毛玻璃 terminal font cursor',
      },
      {
        id: 'agents',
        label: '智能体',
        icon: Bot,
        keywords: 'agent cli 安装 更新 版本 codex claude pi grok hook 钩子 状态 集成',
      },
      {
        id: 'file-explorer',
        label: '文件浏览器',
        icon: FolderTree,
        keywords: 'git 忽略 gitignore 符号链接 symlink 外观 文件夹 图标 主题 material icon theme',
      },
      {
        id: 'source-control',
        label: '源代码管理',
        icon: GitBranch,
        keywords: 'git 提交 信息 提示词 commit message prompt conventional pi 暂存',
      },
      {
        id: 'quick-commands',
        label: '快捷命令',
        icon: Play,
        keywords: '命令 脚本 服务 端口 自动端口 quick command service port',
      },
      {
        id: 'shortcuts',
        label: '键盘快捷键',
        icon: Keyboard,
        keywords: '快捷键 组合键 绑定 恢复 清除 shortcut keybinding hotkey',
      },
    ],
  },
  {
    id: 'integration',
    label: '集成',
    items: [
      {
        id: 'open-with',
        label: '打开方式',
        icon: AppWindow,
        keywords: '应用程序 默认 编辑器 启动 参数 vscode cursor zed finder explorer open with',
      },
      {
        id: 'code-hosting',
        label: '代码托管',
        icon: GitPullRequest,
        keywords: 'github gitlab gh glab host cli 全局 连接 账号 授权 登录 检测 pr mr review',
      },
    ],
  },
]

const SETTING_COMPONENTS: Record<string, React.ComponentType> = {
  general: GeneralSettings,
  notifications: NotificationSettings,
  terminal: TerminalSettings,
  'quick-commands': QuickCommandsSettings,
  'open-with': OpenWithSettings,
  'source-control': SourceControlSettings,
  'code-hosting': CodeHostingSettings,
  appearance: AppearanceSettings,
  'file-explorer': FileExplorerSettings,
  shortcuts: ShortcutSettings,
  agents: AgentSettings,
}

export function Settings() {
  const { section } = useSearch({ from: '/settings' })
  const ready = useWorkspace((state) => state.ready)
  const leftPanelOpen = useLeftPanel((state) => state.open)
  const [activeCategory, setActiveCategory] = useState<string>(section || 'general')
  const [prevSection, setPrevSection] = useState(section)
  if (section !== prevSection) {
    setPrevSection(section)
    if (section) setActiveCategory(section)
  }
  const [search, setSearch] = useState('')
  const titleId = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const detailPane = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    detailPane.current?.scrollTo({ top: 0 })
  }, [activeCategory])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return SETTING_GROUPS
    const tokens = query.split(/\s+/)

    return SETTING_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = `${group.label} ${item.label} ${item.keywords ?? ''}`.toLowerCase()
        return tokens.every((token) => haystack.includes(token))
      }),
    })).filter((group) => group.items.length > 0)
  }, [search])

  const filteredItems = useMemo(
    () => filteredGroups.flatMap((group) => group.items),
    [filteredGroups],
  )
  const activeItem = SETTING_GROUPS.flatMap((group) => group.items).find(
    (item) => item.id === activeCategory,
  )
  const SettingContent = SETTING_COMPONENTS[activeCategory]

  return (
    <SidebarProvider
      aria-labelledby={titleId}
      className="settings-layout min-h-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l"
    >
      <Sidebar
        id="settings-sidebar"
        collapsible="none"
        inert={!leftPanelOpen}
        className={cn(
          'settings-sidebar min-h-0 w-60 shrink-0 border-r border-sidebar-border select-none',
          !leftPanelOpen && 'hidden',
        )}
        aria-label="设置导航"
      >
        <SidebarHeader className="settings-header gap-3 px-3 pt-3.5 pb-2.5">
          <div className="settings-heading flex items-center px-1.5">
            <h2 id={titleId} className="settings-title">
              设置
            </h2>
          </div>
          <div className="settings-search-wrapper relative flex items-center">
            <Search
              className="settings-search-icon pointer-events-none absolute left-2.5 size-3.5 text-app-muted-foreground"
              aria-hidden="true"
            />
            <SidebarInput
              id={`${titleId}-search`}
              ref={searchInput}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape' && search) {
                  event.preventDefault()
                  setSearch('')
                  return
                }
                if (event.key === 'ArrowDown' && filteredItems.length > 0) {
                  event.preventDefault()
                  const targetId = filteredItems.some((item) => item.id === activeCategory)
                    ? activeCategory
                    : filteredItems[0]!.id
                  setActiveCategory(targetId)
                  const targetButton = navRef.current?.querySelector<HTMLButtonElement>(
                    `[data-setting-id="${targetId}"]`,
                  )
                  targetButton?.focus()
                  targetButton?.scrollIntoView({ block: 'nearest' })
                  return
                }
                if (event.key === 'Enter' && filteredItems.length > 0) {
                  event.preventDefault()
                  if (!filteredItems.some((item) => item.id === activeCategory)) {
                    setActiveCategory(filteredItems[0]!.id)
                  }
                }
              }}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className={cn('settings-search-input pl-8', search && 'pr-7')}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="settings-search-clear absolute right-1.5 text-app-muted-foreground hover:text-foreground"
                aria-label="清空搜索"
                onClick={() => {
                  setSearch('')
                  searchInput.current?.focus()
                }}
              >
                <X className="settings-search-clear-icon size-3" aria-hidden="true" />
              </Button>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent className="settings-nav-list">
          <nav
            ref={navRef}
            className="settings-nav flex min-h-0 flex-1 flex-col gap-4 pt-1.5 pb-4"
            aria-label="设置列表"
          >
            {filteredGroups.map((group) => (
              <SidebarGroup key={group.id} className="settings-group shrink-0">
                <SidebarGroupLabel className="settings-group-title">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent className="settings-group-content">
                  <SidebarMenu className="settings-group-items">
                    {group.items.map((item) => {
                      const Icon = item.icon

                      return (
                        <SidebarMenuItem key={item.id} className="settings-nav-item">
                          <SidebarMenuButton
                            type="button"
                            data-setting-id={item.id}
                            isActive={activeCategory === item.id}
                            aria-current={activeCategory === item.id ? 'page' : undefined}
                            aria-controls={`${titleId}-detail`}
                            onClick={() => setActiveCategory(item.id)}
                            onKeyDown={(event) => {
                              if (
                                event.key !== 'ArrowDown' &&
                                event.key !== 'ArrowUp' &&
                                event.key !== 'Home' &&
                                event.key !== 'End'
                              )
                                return
                              const buttons = Array.from(
                                navRef.current?.querySelectorAll<HTMLButtonElement>(
                                  '.settings-nav-button',
                                ) ?? [],
                              )
                              const currentIndex = buttons.indexOf(event.currentTarget)
                              if (currentIndex === -1 || buttons.length === 0) return
                              event.preventDefault()
                              let nextIndex = currentIndex
                              if (event.key === 'ArrowDown')
                                nextIndex = (currentIndex + 1) % buttons.length
                              else if (event.key === 'ArrowUp')
                                nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
                              else if (event.key === 'Home') nextIndex = 0
                              else if (event.key === 'End') nextIndex = buttons.length - 1
                              const nextButton = buttons[nextIndex]
                              nextButton?.focus()
                              nextButton?.click()
                              nextButton?.scrollIntoView({ block: 'nearest' })
                            }}
                            className="settings-nav-button"
                          >
                            <Icon className="settings-nav-item-icon" aria-hidden="true" />
                            <span className="settings-nav-item-label">{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}

            {!filteredGroups.length && (
              <Empty className="settings-search-empty rounded-none px-4 py-8 text-app-muted-foreground">
                <EmptyHeader className="settings-search-empty-header">
                  <EmptyTitle className="settings-search-empty-title text-xs font-medium text-foreground">
                    未找到相关设置
                  </EmptyTitle>
                  <EmptyDescription className="settings-search-empty-description break-all text-xs text-app-muted-foreground">
                    没有与 &ldquo;{search.trim()}&rdquo; 匹配的设置项
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="settings-search-empty-reset"
                  onClick={() => {
                    setSearch('')
                    searchInput.current?.focus()
                  }}
                >
                  清空搜索
                </Button>
              </Empty>
            )}
          </nav>
        </SidebarContent>
      </Sidebar>

      {/* 右侧：设置详情内容区 */}
      <main
        id={`${titleId}-detail`}
        ref={detailPane}
        className="settings-detail-pane flex min-w-0 flex-1 flex-col overflow-y-auto bg-background"
        aria-label={activeItem ? `${activeItem.label}设置` : '设置详情'}
      >
        <div className="settings-detail-container mx-auto flex min-h-full w-full max-w-4xl flex-col p-8 text-sm/relaxed">
          <LoadingContent
            key={activeCategory}
            pending={!ready}
            label={`${activeItem?.label ?? '设置'}配置读取中...`}
            loadingHeader={
              <div className="settings-loading-heading typeset mb-6">
                <h1 className="settings-loading-title">{activeItem?.label ?? '设置'}</h1>
              </div>
            }
            showLabel
          >
            {ready && SettingContent && <SettingContent />}
          </LoadingContent>
        </div>
      </main>
    </SidebarProvider>
  )
}
