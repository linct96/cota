import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ClaudeCode, Grok, OpenAI, Pi } from '@lobehub/icons'
import { Check, ChevronDown, UsersRound } from 'lucide-react'
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useCortana } from './cortana-store'
import { useLeftPanel } from '@/state/left-panel-store'
import { cn } from '@/lib/utils'

const PRODUCT_ORDER: AccountProduct[] = ['claude', 'codex', 'grok', 'pi']
const PRODUCT_ICONS = {
  claude: ClaudeCode,
  codex: OpenAI,
  grok: Grok,
  pi: Pi,
}

export function CortanaLayout() {
  const { activeProduct, agentSwitchBlocked, selectProduct } = useCortana()
  const navigate = useNavigate()
  const leftPanelOpen = useLeftPanel((state) => state.open)
  const ActiveIcon = PRODUCT_ICONS[activeProduct]

  return (
    <section className="cortana-region flex min-h-0 min-w-0 flex-1" aria-label="Cortana">
      <SidebarProvider className="cortana-layout min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background">
        <Sidebar
          id="cortana-sidebar"
          collapsible="none"
          inert={!leftPanelOpen}
          className={cn(
            'cortana-sidebar min-h-0 w-60 shrink-0 border-r border-sidebar-border select-none',
            !leftPanelOpen && 'hidden',
          )}
          aria-label="Cortana 菜单"
        >
          <header className="cortana-sidebar-header flex h-12 shrink-0 items-center gap-2 px-4">
            <h1 className="cortana-sidebar-title min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      className="cortana-agent-trigger max-w-full justify-start"
                      variant="ghost"
                      size="lg"
                      aria-label={`管理的 Agent：${ACCOUNT_PRODUCTS[activeProduct].name}`}
                      disabled={agentSwitchBlocked}
                    />
                  }
                >
                  <ActiveIcon
                    className="cortana-agent-icon"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  <span className="cortana-agent-name truncate">
                    {ACCOUNT_PRODUCTS[activeProduct].name}
                  </span>
                  <ChevronDown
                    className="cortana-agent-chevron"
                    data-icon="inline-end"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="cortana-agent-menu min-w-44"
                  align="start"
                  sideOffset={4}
                  aria-label="切换管理的 Agent"
                >
                  <DropdownMenuGroup className="cortana-agent-menu-group">
                    {PRODUCT_ORDER.map((product) => {
                      const Icon = PRODUCT_ICONS[product]
                      const selected = product === activeProduct
                      return (
                        <DropdownMenuItem
                          key={product}
                          className="cortana-agent-menu-item"
                          disabled={agentSwitchBlocked}
                          onClick={() => {
                            if (selected) return
                            selectProduct(product)
                            void navigate({ to: '/cortana/accounts' })
                          }}
                        >
                          <Icon className="cortana-agent-option-icon" aria-hidden="true" />
                          <span className="cortana-agent-option-label">
                            {ACCOUNT_PRODUCTS[product].name}
                          </span>
                          {selected && (
                            <Check
                              className="cortana-agent-selected-icon ml-auto"
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
          </header>
          <SidebarContent className="cortana-nav-list">
            <nav
              className="cortana-navigation flex min-h-0 flex-1 flex-col pt-1.5 pb-4"
              aria-label="模块"
            >
              <SidebarGroup className="cortana-nav-group shrink-0">
                <SidebarGroupContent className="cortana-nav-group-content">
                  <SidebarMenu className="cortana-nav-items">
                    <SidebarMenuItem className="cortana-nav-item">
                      <SidebarMenuButton
                        className="cortana-accounts-link"
                        isActive
                        render={
                          <Link
                            to="/cortana/accounts"
                            aria-current="page"
                            className="cortana-accounts-route"
                          />
                        }
                      >
                        <UsersRound className="cortana-accounts-icon" aria-hidden="true" />
                        <span className="cortana-accounts-label">账号管理</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
          </SidebarContent>
        </Sidebar>
        <main
          className="cortana-content flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label="Cortana 模块内容"
        >
          <Outlet />
        </main>
      </SidebarProvider>
    </section>
  )
}
