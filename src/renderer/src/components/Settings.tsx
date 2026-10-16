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
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import { cn } from '../lib/utils'

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
      { id: 'plugins', label: '插件', icon: Blocks },
      { id: 'computer-control', label: '电脑操控', icon: NavigationIcon },
      { id: 'snapshots', label: '应用快照', icon: Scan },
      { id: 'browser', label: '浏览器', icon: AppWindow },
    ],
  },
]

export function Settings() {
  const preferences = useWorkspace((state) => state.preferences)
  const [activeCategory, setActiveCategory] = useState('general')
  const [search, setSearch] = useState('')
  const [customShell, setCustomShell] = useState(preferences.shellPath !== null)
  const [shellPath, setShellPath] = useState(preferences.shellPath || '')
  const [scrollback, setScrollback] = useState(String(preferences.scrollback))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const titleId = useId()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (saving) return
        event.preventDefault()
        useWorkspace.setState({ settingsOpen: false })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saving])

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

  const currentItem = useMemo(() => {
    for (const group of SETTING_GROUPS) {
      const match = group.items.find((item) => item.id === activeCategory)
      if (match) return match
    }
    return SETTING_GROUPS[0].items[0]
  }, [activeCategory])

  return (
    <section
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

        <nav
          className="settings-nav-list flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3"
          aria-label="设置列表"
        >
          {filteredGroups.map((group) => (
            <div key={group.id} className="settings-group flex flex-col gap-1">
              <h3 className="settings-group-title px-2.5 pb-0.5 text-xs font-normal text-muted-foreground">
                {group.label}
              </h3>
              <div className="settings-group-items flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.id === activeCategory
                  const Icon = item.icon

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveCategory(item.id)}
                      className={cn(
                        'settings-nav-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors text-left',
                        isActive
                          ? 'settings-nav-item-active bg-accent font-medium text-accent-foreground'
                          : 'settings-nav-item-inactive text-foreground/80 hover:bg-muted/60 hover:text-foreground',
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon className="settings-nav-item-icon size-4 shrink-0 text-muted-foreground" />
                      <span className="settings-nav-item-label truncate">{item.label}</span>
                    </button>
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
        </nav>
      </aside>

      {/* 右侧：设置详情内容区 */}
      <main
        className="settings-detail-pane flex min-w-0 flex-1 flex-col overflow-y-auto bg-card"
        aria-label="设置详情"
      >
        <div className="settings-detail-container max-w-xl p-8">
          <div className="settings-section-header mb-6">
            <h3 className="settings-section-title text-base font-semibold text-foreground">
              {currentItem.label}
            </h3>
            <p className="settings-description mt-1 text-xs text-muted-foreground">
              {currentItem.id === 'general'
                ? '基础终端环境与偏好配置，设置仅保存在本机。Shell 变更只影响新建的终端。'
                : '该功能暂未开放配置。'}
            </p>
          </div>

          {currentItem.id === 'general' ? (
            <form
              className="settings-form flex flex-col gap-6"
              onSubmit={async (event) => {
                event.preventDefault()
                if (saving) return
                setSaving(true)
                setError(undefined)
                try {
                  await useWorkspace.getState().savePreferences({
                    shellPath: customShell ? shellPath.trim() : null,
                    scrollback: Number(scrollback),
                  })
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                  setSaving(false)
                }
              }}
            >
              <fieldset disabled={saving} className="settings-shell-group flex flex-col gap-3">
                <legend className="settings-shell-legend text-xs font-medium text-foreground">
                  Shell
                </legend>
                <div className="settings-shell-options flex flex-col gap-2">
                  <label className="settings-radio-label flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="shell"
                      className="settings-radio-input"
                      checked={!customShell}
                      onChange={() => setCustomShell(false)}
                    />
                    系统默认（SHELL，回退 zsh）
                  </label>
                  <label className="settings-radio-label flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="shell"
                      className="settings-radio-input"
                      checked={customShell}
                      onChange={() => setCustomShell(true)}
                    />
                    自定义可执行文件
                  </label>
                </div>
                <label htmlFor="shell-path" className="settings-shell-path-label sr-only">
                  Shell 绝对路径
                </label>
                <Input
                  id="shell-path"
                  className="settings-shell-path-input text-xs"
                  value={shellPath}
                  onChange={(event) => setShellPath(event.target.value)}
                  placeholder="/opt/homebrew/bin/fish"
                  disabled={!customShell}
                  required={customShell}
                />
                <p className="settings-shell-hint text-xs text-muted-foreground">
                  仅填写绝对路径，不接受命令参数。所有 Shell 均以交互式登录模式启动（-il）。
                </p>
              </fieldset>

              <Separator className="bg-border" />

              <div className="settings-scrollback-group flex flex-col gap-2">
                <label
                  htmlFor="scrollback"
                  className="settings-scrollback-label text-xs font-medium text-foreground"
                >
                  终端滚动缓冲行数
                </label>
                <Input
                  id="scrollback"
                  className="settings-scrollback-input w-48 text-xs"
                  type="number"
                  min={1000}
                  max={20000}
                  step={1}
                  required
                  disabled={saving}
                  value={scrollback}
                  onChange={(event) => setScrollback(event.target.value)}
                />
                <p className="settings-scrollback-hint text-xs text-muted-foreground">
                  范围 1,000–20,000，默认 5,000；减小会丢弃超出范围的旧输出。
                </p>
              </div>

              {error && (
                <p role="alert" className="settings-error-alert text-xs text-destructive">
                  {error}
                </p>
              )}

              <div className="settings-actions flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="settings-cancel-button"
                  disabled={saving}
                  onClick={() => useWorkspace.setState({ settingsOpen: false })}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="settings-submit-button"
                  disabled={saving}
                >
                  {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="settings-empty-placeholder rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              此项设置暂未开放，请返回「常规」查看终端配置。
            </div>
          )}
        </div>
      </main>
    </section>
  )
}
