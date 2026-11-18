import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ClaudeCode, Grok, OpenAI, Pi } from '@lobehub/icons'
import { ChartNoAxesCombined, Check, ChevronDown, UsersRound } from 'lucide-react'
import { ACCOUNT_PRODUCTS } from '../../../../shared/accounts'
import type { AccountProduct } from '../../../../shared/accounts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useAgents } from './agents-store'
import { useLeftPanel } from '@/state/left-panel-store'
import { cn } from '@/lib/utils'

const PRODUCT_ORDER: AccountProduct[] = ['claude', 'codex', 'grok', 'pi']
const PRODUCT_ICONS = {
  claude: ClaudeCode,
  codex: OpenAI,
  grok: Grok,
  pi: Pi,
}

export function AgentsLayout() {
  const { activeProduct, selectProduct } = useAgents()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const leftPanelOpen = useLeftPanel((state) => state.open)
  const ActiveIcon = PRODUCT_ICONS[activeProduct]

  return (
    <section className="agents-region flex min-h-0 min-w-0 flex-1" aria-label="Agents">
      <SidebarProvider className="agents-layout min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background">
        <Sidebar
          id="agents-sidebar"
          collapsible="none"
          inert={!leftPanelOpen}
          className={cn(
            'agents-sidebar min-h-0 w-60 shrink-0 border-r border-sidebar-border select-none',
            !leftPanelOpen && 'hidden',
          )}
          aria-label="Agents 菜单"
        >
          <SidebarHeader className="agents-sidebar-header h-12 shrink-0 flex-row items-center px-3 py-0">
            <h1 className="agents-sidebar-title min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      className="agents-agent-trigger h-9 max-w-full justify-start gap-2 px-2.5 text-sm text-sidebar-foreground has-data-[icon=inline-start]:pl-2.5"
                      variant="ghost"
                      size="lg"
                      aria-label={`管理的 Agent：${ACCOUNT_PRODUCTS[activeProduct].name}`}
                    />
                  }
                >
                  <ActiveIcon
                    className="agents-agent-icon"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  <span className="agents-agent-name truncate">
                    {ACCOUNT_PRODUCTS[activeProduct].name}
                  </span>
                  <ChevronDown
                    className="agents-agent-chevron text-app-muted-foreground"
                    data-icon="inline-end"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="agents-agent-menu min-w-44"
                  align="start"
                  sideOffset={4}
                  aria-label="切换管理的 Agent"
                >
                  <DropdownMenuGroup className="agents-agent-menu-group">
                    {PRODUCT_ORDER.map((product) => {
                      const Icon = PRODUCT_ICONS[product]
                      const selected = product === activeProduct
                      return (
                        <DropdownMenuItem
                          key={product}
                          className="agents-agent-menu-item"
                          onClick={() => {
                            if (selected) return
                            selectProduct(product)
                          }}
                        >
                          <Icon className="agents-agent-option-icon" aria-hidden="true" />
                          <span className="agents-agent-option-label">
                            {ACCOUNT_PRODUCTS[product].name}
                          </span>
                          {selected && (
                            <Check
                              className="agents-agent-selected-icon ml-auto"
                              aria-label="当前 Agent"
                            />
                          )}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </h1>
          </SidebarHeader>
          <SidebarContent className="agents-nav-list">
            <nav
              className="agents-navigation flex min-h-0 flex-1 flex-col pt-1.5 pb-4"
              aria-label="模块"
            >
              <SidebarGroup className="agents-nav-group shrink-0">
                <SidebarGroupContent className="agents-nav-group-content">
                  <SidebarMenu className="agents-nav-items">
                    <SidebarMenuItem className="agents-nav-item">
                      <SidebarMenuButton
                        className="agents-accounts-link"
                        isActive={pathname === '/agents/accounts'}
                        render={
                          <Link
                            to="/agents/accounts"
                            aria-current={pathname === '/agents/accounts' ? 'page' : undefined}
                            className="agents-accounts-route"
                          />
                        }
                      >
                        <UsersRound className="agents-accounts-icon" aria-hidden="true" />
                        <span className="agents-accounts-label">账号管理</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="agents-nav-item">
                      <SidebarMenuButton
                        className="agents-analytics-link"
                        isActive={pathname === '/agents/analytics'}
                        render={
                          <Link
                            to="/agents/analytics"
                            aria-current={pathname === '/agents/analytics' ? 'page' : undefined}
                            className="agents-analytics-route"
                          />
                        }
                      >
                        <ChartNoAxesCombined className="agents-analytics-icon" aria-hidden="true" />
                        <span className="agents-analytics-label">统计分析</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
          </SidebarContent>
        </Sidebar>
        <main
          className="agents-content flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label="Agents 模块内容"
        >
          <Outlet />
        </main>
      </SidebarProvider>
    </section>
  )
}
