import { useEffect, useId, useMemo, useState } from 'react'
import {
  AppWindow,
  Archive,
  Blocks,
  Download,
  Folder,
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
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { cn } from '../lib/utils'
import { GeneralSettings } from './GeneralSettings'
import { OpenWithSettings } from './OpenWithSettings'

interface SettingItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
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
      { id: 'import', label: '导入', icon: Download },
      { id: 'appearance', label: '外观', icon: Sun },
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
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState('general')
  const [search, setSearch] = useState('')
  const titleId = useId()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        void navigate({ to: '/' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return SETTING_GROUPS

    return SETTING_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) || group.label.toLowerCase().includes(query),
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
      className="settings-layout flex min-h-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-card text-foreground"
    >
      {/* 左侧：设置导航栏 */}
      <aside
        className="settings-sidebar flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        aria-label="设置导航"
      >
        <div className="settings-nav-header flex flex-col gap-3 p-3">
          <h2 id={titleId} className="settings-title px-1 text-lg font-bold text-foreground">
            设置
          </h2>
          <div className="settings-search-wrapper relative flex items-center">
            <Search className="settings-search-icon pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索"
              className="settings-search-input h-8 w-full rounded-xl border-none bg-muted/80 pl-8 pr-3 text-xs shadow-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <TabsList
          variant="line"
          className="settings-nav-list flex min-h-0 flex-1 flex-col justify-start gap-4 overflow-y-auto bg-transparent p-0 px-2 pb-3"
          aria-label="设置列表"
        >
          {filteredGroups.map((group) => (
            <div key={group.id} className="settings-group flex w-full flex-col gap-1">
              <h3 className="settings-group-title px-2.5 pb-0.5 text-xs font-normal text-muted-foreground">
                {group.label}
              </h3>
              <div className="settings-group-items flex w-full flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon

                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className={cn(
                        'settings-nav-item flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                        'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
                        'data-active:bg-accent data-active:font-medium data-active:text-accent-foreground',
                        'after:hidden',
                      )}
                    >
                      <Icon className="settings-nav-item-icon size-4 shrink-0 text-muted-foreground" />
                      <span className="settings-nav-item-label truncate">{item.label}</span>
                    </TabsTrigger>
                  )
                })}
              </div>
            </div>
          ))}

          {!filteredGroups.length && (
            <p className="settings-search-empty px-3 py-6 text-center text-xs text-muted-foreground">
              未找到相关设置
            </p>
          )}
        </TabsList>
      </aside>

      {/* 右侧：设置详情内容区 */}
      <main
        className="settings-detail-pane flex min-w-0 flex-1 flex-col overflow-y-auto bg-card"
        aria-label="设置详情"
      >
        <div className="settings-detail-container mx-auto w-full max-w-2xl p-8">
          <TabsContent value="general" className="mt-0">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="open-with" className="mt-0">
            <OpenWithSettings />
          </TabsContent>
          {SETTING_GROUPS.flatMap((g) => g.items)
            .filter((item) => item.id !== 'general' && item.id !== 'open-with')
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
                  此项设置暂未开放，请返回「常规」查看终端配置。
                </Card>
              </TabsContent>
            ))}
        </div>
      </main>
    </Tabs>
  )
}
