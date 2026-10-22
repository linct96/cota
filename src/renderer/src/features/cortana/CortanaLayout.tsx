import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ClaudeCode, Grok, OpenAI, Pi } from '@lobehub/icons'
import { Check, ChevronDown, UsersRound } from 'lucide-react'
import { ACCOUNT_PRODUCTS, type AccountProduct } from '../../../../shared/accounts'
import { Button } from '../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { useCortana } from './cortana-store'

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
  const ActiveIcon = PRODUCT_ICONS[activeProduct]

  return (
    <section
      className="cortana-layout flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background"
      aria-label="Cortana"
    >
      <aside
        className="cortana-sidebar flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
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
        <nav className="cortana-navigation flex flex-col gap-1 px-2" aria-label="模块">
          <Button
            variant="navigation"
            className="cortana-accounts-link w-full justify-start"
            data-active="true"
            render={
              <Link to="/cortana/accounts" aria-current="page" className="cortana-accounts-route" />
            }
          >
            <UsersRound
              className="cortana-accounts-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            账号管理
          </Button>
        </nav>
      </aside>
      <main
        className="cortana-content flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Cortana 模块内容"
      >
        <Outlet />
      </main>
    </section>
  )
}
