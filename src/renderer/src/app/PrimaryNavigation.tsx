import { useRouter } from '@tanstack/react-router'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { CortanaIcon } from '@/components/CortanaIcon'
import { useWorkspace } from '@/state/workspace'
import { ShortcutKbd } from '@/components/ShortcutKbd'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortcutBinding } from '../../../shared/shortcuts'

export function PrimaryNavigation({
  activeNavigation,
}: {
  activeNavigation: 'home' | 'settings' | 'cortana'
}) {
  const router = useRouter()
  const shortcuts = useWorkspace((state) => state.preferences.shortcuts)
  const settingsOpen = activeNavigation === 'settings'
  const cortanaOpen = activeNavigation === 'cortana'
  return (
    <nav
      aria-label="主导航"
      className="primary-navigation flex w-[var(--app-navigation-width)] shrink-0 flex-col justify-between pt-2 pb-3"
    >
      <div className="primary-navigation-top flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="navigation"
                size="icon-xl"
                aria-label="首页"
                aria-current={activeNavigation === 'home' ? 'page' : undefined}
                className="nav-home-button"
                data-active={activeNavigation === 'home'}
                onClick={() => {
                  void router.navigate({ to: '/' })
                }}
              />
            }
          >
            <HouseIcon
              className="nav-home-icon"
              aria-hidden="true"
              weight={activeNavigation === 'home' ? 'fill' : 'regular'}
            />
          </TooltipTrigger>
          <TooltipContent side="right">首页</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="navigation"
                size="icon-xl"
                aria-label="Cortana"
                aria-current={cortanaOpen ? 'page' : undefined}
                className="nav-cortana-button"
                data-active={cortanaOpen}
                onClick={() => void router.navigate({ to: '/cortana/accounts' })}
              />
            }
          >
            <CortanaIcon className="nav-cortana-icon" active={cortanaOpen} />
          </TooltipTrigger>
          <TooltipContent side="right">Cortana</TooltipContent>
        </Tooltip>
      </div>
      <div className="primary-navigation-bottom flex flex-col items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="navigation"
                size="icon-xl"
                className="nav-settings-button"
                data-active={settingsOpen}
                aria-label="打开设置"
                aria-current={settingsOpen ? 'page' : undefined}
                onClick={() => void router.navigate({ to: settingsOpen ? '/' : '/settings' })}
              />
            }
          >
            <GearSixIcon
              className="nav-settings-icon"
              aria-hidden="true"
              weight={settingsOpen ? 'fill' : 'regular'}
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            设置
            <ShortcutKbd
              binding={shortcutBinding(shortcuts, 'settings', window.desktop.platform)}
            />
          </TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
