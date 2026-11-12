import { useState } from 'react'
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useWorkspace } from '@/state/workspace'
import { TopStatusBar } from './TopStatusBar'
import { Tabs } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useLeftPanel } from '@/state/left-panel-store'
import { PrimaryNavigation } from './PrimaryNavigation'
import { useAppRuntime } from './hooks/use-app-runtime'
import { Workbench } from './workbench/Workbench'
import { WorkspaceHeader } from './workbench/WorkspaceHeader'
import { useWorkspaceView } from './workbench/use-workspace-view'

export function App() {
  useAppRuntime()
  const bootstrapError = useWorkspace((state) => state.bootstrapError)
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const settingsOpen = pathname === '/settings'
  const cortanaOpen = pathname.startsWith('/cortana')
  const secondaryPageOpen = settingsOpen || cortanaOpen
  const activeNavigation = settingsOpen ? 'settings' : cortanaOpen ? 'cortana' : 'home'
  const view = useWorkspaceView()
  const [rightTab, setRightTab] = useState('files')
  const activeRightTab = rightTab === 'git' && !view.gitAvailable ? 'files' : rightTab
  const leftPanelOpen = useLeftPanel((state) => state.open)

  if (bootstrapError) throw new Error(bootstrapError)

  return (
    <TooltipProvider delay={300}>
      <Tabs
        value={activeRightTab}
        onValueChange={(value) => setRightTab(String(value))}
        className="app-container flex h-screen w-screen flex-col gap-0 overflow-hidden bg-muted text-foreground select-none"
        data-platform={window.desktop.platform}
      >
        <TopStatusBar
          secondaryPageOpen={secondaryPageOpen}
          gitAvailable={view.gitAvailable}
          sidebarWidth={leftPanelOpen ? 240 : 0}
          leftPanelId={
            settingsOpen
              ? 'settings-sidebar'
              : cortanaOpen
                ? 'cortana-sidebar'
                : 'workspace-projects'
          }
          onBack={() => void router.navigate({ to: '/' })}
        >
          {!secondaryPageOpen && <WorkspaceHeader view={view} />}
        </TopStatusBar>
        <div className="app-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <PrimaryNavigation activeNavigation={activeNavigation} />
          <div className="workspace-layout flex min-h-0 min-w-0 flex-1 flex-col">
            <Workbench
              view={view}
              secondaryPageOpen={secondaryPageOpen}
              activeNavigation={activeNavigation}
              activeRightTab={activeRightTab}
            />
            <Outlet />
          </div>
        </div>
      </Tabs>
    </TooltipProvider>
  )
}
