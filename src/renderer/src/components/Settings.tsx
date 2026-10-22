import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  Archive,
  Blocks,
  Download,
  Folder,
  FolderTree,
  GitBranch,
  Keyboard,
  Mic,
  Navigation as NavigationIcon,
  Palette,
  Scan,
  Search,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Sun,
  SquareTerminal,
  X,
} from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { GeneralSettings } from './GeneralSettings'
import { SourceControlSettings } from './SourceControlSettings'
import { TerminalSettings } from './TerminalSettings'
import { OpenWithSettings } from './OpenWithSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { FileExplorerSettings } from './FileExplorerSettings'

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
      { id: 'terminal', label: '终端', icon: SquareTerminal },
      { id: 'file-explorer', label: '文件浏览器', icon: FolderTree, keywords: 'git 忽略 符号链接' },
      { id: 'source-control', label: '源代码管理', icon: GitBranch },
      { id: 'import', label: '导入', icon: Download },
      { id: 'appearance', label: '外观', icon: Sun, keywords: '主题 自动 浅色 深色' },
      { id: 'archived-chats', label: 'Archived chats', icon: Archive },
      { id: 'voice', label: '语音', icon: Mic },
      { id: 'storage', label: '存储', icon: Folder },
      { id: 'profile', label: '配置', icon: Sliders },
      { id: 'personalization', label: '个性化', icon: Palette },
      { id: 'pet', label: 'Mini 与虚拟宠物', icon: Sparkles },
      { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
    ],
  },
  {
    id: 'integration',
    label: '集成',
    items: [
      { id: 'open-with', label: '打开方式', icon: AppWindow },
      { id: 'plugins', label: '插件', icon: Blocks },
      { id: 'computer-control', label: '电脑操控', icon: NavigationIcon },
      { id: 'snapshots', label: '应用快照', icon: Scan },
      { id: 'browser', label: '浏览器', icon: AppWindow },
    ],
  },
]

export function Settings() {
  const [activeCategory, setActiveCategory] = useState('general')
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

  return (
    <Tabs
      orientation="vertical"
      value={activeCategory}
      onValueChange={(val) => {
        if (typeof val === 'string') setActiveCategory(val)
      }}
      aria-labelledby={titleId}
      className="settings-layout flex min-h-0 flex-1 gap-0 overflow-hidden rounded-tl-2xl border-t border-l bg-card text-foreground"
    >
      {/* 左侧：设置导航栏 */}
      <aside
        className="settings-sidebar flex min-h-0 w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground select-none"
        aria-label="设置导航"
      >
        <div className="settings-header flex h-12 shrink-0 items-center px-4">
          <h2 id={titleId} className="settings-title">
            设置
          </h2>
        </div>

        <div className="settings-search shrink-0 px-2 pb-2">
          <div className="settings-search-wrapper relative flex items-center">
            <Search
              className="settings-search-icon pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('')
              }}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className="settings-search-input w-full pl-8 pr-7"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="settings-search-clear absolute right-1 size-5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch('')}
                aria-label="清空搜索"
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>

        <TabsList
          className="settings-nav-list flex min-h-0 flex-1 flex-col justify-start gap-2 overflow-y-auto px-2 pb-3"
          aria-label="设置列表"
        >
          {filteredGroups.map((group) => (
            <div key={group.id} className="settings-group flex w-full shrink-0 flex-col">
              <h3 className="settings-group-title flex h-8 shrink-0 items-center px-2">
                {group.label}
              </h3>
              <div className="settings-group-items flex w-full min-w-0 flex-col gap-px">
                {group.items.map((item) => {
                  const Icon = item.icon

                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="settings-nav-item w-full min-w-0 justify-start overflow-hidden text-left"
                    >
                      <Icon className="settings-nav-item-icon" aria-hidden="true" />
                      <span className="settings-nav-item-label truncate">{item.label}</span>
                    </TabsTrigger>
                  )
                })}
              </div>
            </div>
          ))}

          {!filteredGroups.length && (
            <Empty className="settings-search-empty py-8 text-muted-foreground">
              <EmptyHeader className="settings-search-empty-header">
                <EmptyTitle className="settings-search-empty-title text-xs font-medium">
                  未找到相关设置
                </EmptyTitle>
                <EmptyDescription className="settings-search-empty-description text-xs text-muted-foreground">
                  没有与 &ldquo;{search}&rdquo; 匹配的设置项
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsList>
      </aside>

      {/* 右侧：设置详情内容区 */}
      <main
        ref={detailPane}
        className="settings-detail-pane flex min-w-0 flex-1 flex-col overflow-y-auto bg-card"
        aria-label="设置详情"
      >
        <div className="settings-detail-container mx-auto w-full max-w-2xl p-8">
          <TabsContent value="general" className="mt-0">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="terminal" className="settings-terminal-content mt-0">
            <TerminalSettings />
          </TabsContent>
          <TabsContent value="open-with" className="mt-0">
            <OpenWithSettings />
          </TabsContent>
          <TabsContent value="source-control" className="settings-source-control-content mt-0">
            <SourceControlSettings />
          </TabsContent>
          <TabsContent value="appearance" className="settings-appearance-content mt-0">
            <AppearanceSettings />
          </TabsContent>
          <TabsContent value="file-explorer" className="settings-file-explorer-content mt-0">
            <FileExplorerSettings />
          </TabsContent>
          {SETTING_GROUPS.flatMap((g) => g.items)
            .filter(
              (item) =>
                ![
                  'general',
                  'terminal',
                  'open-with',
                  'source-control',
                  'appearance',
                  'file-explorer',
                ].includes(item.id),
            )
            .map((item) => (
              <TabsContent key={item.id} value={item.id} className="mt-0">
                <div className="settings-section-header mb-6">
                  <h3 className="settings-section-title text-base font-semibold text-foreground">
                    {item.label}
                  </h3>
                  <p className="settings-description mt-1 text-xs text-muted-foreground">
                    该功能暂未开放配置。
                  </p>
                </div>
                <Card className="settings-empty-placeholder rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground shadow-none ring-0">
                  此项设置暂未开放，请前往「终端」查看终端配置。
                </Card>
              </TabsContent>
            ))}
        </div>
      </main>
    </Tabs>
  )
}
