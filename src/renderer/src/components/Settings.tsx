import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import {
  AppWindow,
  Bell,
  Bot,
  FolderTree,
  GitBranch,
  Keyboard,
  Search,
  Settings as SettingsIcon,
  Sun,
  SquareTerminal,
} from 'lucide-react'
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
import { TerminalSettings } from './TerminalSettings'
import { OpenWithSettings } from './OpenWithSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { FileExplorerSettings } from './FileExplorerSettings'
import { ShortcutSettings } from './ShortcutSettings'
import { AgentSettings } from './AgentSettings'
import { QuickCommandsSettings } from './QuickCommandsSettings'
import { LoadingContent } from './LoadingContent'
import { useWorkspace } from '../store'

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
      { id: 'general', label: '常规', icon: SettingsIcon },
      {
        id: 'notifications',
        label: '通知',
        icon: Bell,
        keywords: '启用 开关 系统 提醒 notification',
      },
      {
        id: 'appearance',
        label: '外观',
        icon: Sun,
        keywords: '模式 主题 自动 浅色 深色 主题色 背景色 前景色 颜色',
      },
      { id: 'terminal', label: '终端', icon: SquareTerminal },
      {
        id: 'agents',
        label: '智能体',
        icon: Bot,
        keywords: 'agent cli 安装 更新 版本 codex claude pi',
      },
      {
        id: 'file-explorer',
        label: '文件浏览器',
        icon: FolderTree,
        keywords: 'git 忽略 符号链接 外观 文件夹 图标 主题 material icon theme',
      },
      { id: 'source-control', label: '源代码管理', icon: GitBranch },
      { id: 'quick-commands', label: '快捷命令', icon: SquareTerminal },
      { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
    ],
  },
  {
    id: 'integration',
    label: '集成',
    items: [{ id: 'open-with', label: '打开方式', icon: AppWindow }],
  },
]

const SETTING_COMPONENTS: Record<string, React.ComponentType> = {
  general: GeneralSettings,
  notifications: NotificationSettings,
  terminal: TerminalSettings,
  'quick-commands': QuickCommandsSettings,
  'open-with': OpenWithSettings,
  'source-control': SourceControlSettings,
  appearance: AppearanceSettings,
  'file-explorer': FileExplorerSettings,
  shortcuts: ShortcutSettings,
  agents: AgentSettings,
}

export function Settings() {
  const { section } = useSearch({ from: '/settings' })
  const ready = useWorkspace((state) => state.ready)
  const [activeCategory, setActiveCategory] = useState<string>(section || 'general')
  const [search, setSearch] = useState('')
  const titleId = useId()
  const detailPane = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    detailPane.current?.scrollTo({ top: 0 })
  }, [activeCategory])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return SETTING_GROUPS

    return SETTING_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          group.label.toLowerCase().includes(query) ||
          !!item.keywords?.includes(query),
      ),
    })).filter((group) => group.items.length > 0)
  }, [search])

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
        collapsible="none"
        className="settings-sidebar min-h-0 w-60 shrink-0 border-r border-sidebar-border select-none"
        aria-label="设置导航"
      >
        <SidebarHeader className="settings-header">
          <div className="settings-heading typeset px-2">
            <h3 id={titleId} className="settings-title">
              设置
            </h3>
          </div>
          <div className="settings-search-wrapper relative flex items-center">
            <Search
              className="settings-search-icon pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <SidebarInput
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('')
              }}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className="settings-search-input pl-8"
            />
          </div>
        </SidebarHeader>

        <SidebarContent className="settings-nav-list">
          <nav className="settings-nav" aria-label="设置列表">
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
                            isActive={activeCategory === item.id}
                            aria-current={activeCategory === item.id ? 'page' : undefined}
                            aria-controls={`${titleId}-detail`}
                            onClick={() => setActiveCategory(item.id)}
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
              <Empty className="settings-search-empty py-8 text-app-muted-foreground">
                <EmptyHeader className="settings-search-empty-header">
                  <EmptyTitle className="settings-search-empty-title text-xs font-medium">
                    未找到相关设置
                  </EmptyTitle>
                  <EmptyDescription className="settings-search-empty-description text-xs text-app-muted-foreground">
                    没有与 &ldquo;{search}&rdquo; 匹配的设置项
                  </EmptyDescription>
                </EmptyHeader>
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
