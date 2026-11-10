import { useId, useMemo, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
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
} from '@/components/ui/sidebar'
import { LoadingContent } from '@/components/LoadingContent'
import { useWorkspace } from '@/state/workspace'
import { useLeftPanel } from '@/state/left-panel-store'
import { cn } from '@/lib/utils'
import { SETTING_COMPONENTS, SETTING_GROUPS } from '@/features/settings/settings-sections'

export function SettingsPage() {
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
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
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
                    : filteredItems[0].id
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
                    setActiveCategory(filteredItems[0].id)
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
                              else nextIndex = buttons.length - 1
                              const nextButton = buttons.at(nextIndex)
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
        key={activeCategory}
        className="settings-detail-pane flex min-w-0 flex-1 flex-col overflow-y-auto bg-background"
        aria-label={activeItem ? `${activeItem.label}设置` : '设置详情'}
      >
        <div className="settings-detail-container mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 pt-6 pb-24 text-xs/relaxed">
          <LoadingContent
            pending={!ready}
            label={`${activeItem?.label ?? '设置'}配置读取中...`}
            loadingHeader={
              <div className="settings-loading-heading mb-5 border-b pb-4">
                <h1 className="settings-loading-title settings-page-title">
                  {activeItem?.label ?? '设置'}
                </h1>
              </div>
            }
            showLabel
          >
            {ready && <SettingContent />}
          </LoadingContent>
        </div>
      </main>
    </SidebarProvider>
  )
}
