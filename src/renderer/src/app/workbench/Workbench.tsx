import { RightPanel } from '@/app/workbench/RightPanel'
import { useLeftPanel } from '@/state/left-panel-store'
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import type { WorkspaceView } from './use-workspace-view'
import { WorkspaceStage } from './WorkspaceStage'
import { ProjectSidebar } from '@/features/workspace/sidebar/ProjectSidebar'
import { useVisibleTerminal } from './use-visible-terminal'

export function Workbench({
  view,
  secondaryPageOpen,
  activeNavigation,
  activeRightTab,
}: {
  view: WorkspaceView
  secondaryPageOpen: boolean
  activeNavigation: 'home' | 'settings' | 'cortana'
  activeRightTab: string
}) {
  const { activeWorkspace, activeId, gitAvailable, showingDiff, projects } = view
  const leftPanelOpen = useLeftPanel((state) => state.open)

  useVisibleTerminal(activeId, activeNavigation, showingDiff)
  return (
    <div
      className={cn(
        'workspace-content app-panels flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background',
        secondaryPageOpen && 'hidden!',
      )}
    >
      <div
        id="workspace-projects"
        inert={!leftPanelOpen}
        className={cn(
          'project-sidebar-panel flex min-h-0 w-60 shrink-0 flex-col overflow-hidden border-r',
          !leftPanelOpen && 'hidden',
        )}
      >
        <ProjectSidebar projects={projects} homeActive={activeNavigation === 'home'} />
      </div>
      <ResizablePanelGroup
        orientation="horizontal"
        className="workspace-panels min-h-0 min-w-0 flex-1"
      >
        <ResizablePanel
          id="workspace-main"
          minSize={200}
          className="workspace-main-panel flex min-h-0 min-w-0 flex-col"
          style={{ overflow: 'hidden' }}
        >
          {/* 保持终端挂载，文件 / Diff 预览仅切换可见区域。 */}
          <WorkspaceStage
            view={view}
            secondaryPageOpen={secondaryPageOpen}
            activeNavigation={activeNavigation}
          />
        </ResizablePanel>
        <RightPanel
          workspace={activeWorkspace}
          active={!secondaryPageOpen}
          filesActive={activeRightTab === 'files'}
          gitAvailable={gitAvailable}
        />
      </ResizablePanelGroup>
    </div>
  )
}
