import { useEffect } from 'react'
import { usePanelCallbackRef } from 'react-resizable-panels'
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
  const [projectPanel, projectPanelRef] = usePanelCallbackRef()

  useEffect(() => {
    if (!secondaryPageOpen) {
      projectPanel?.resize(leftPanelOpen ? 240 : 0)
    }
  }, [projectPanel, leftPanelOpen, secondaryPageOpen])
  useVisibleTerminal(activeId, activeNavigation, showingDiff)
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={cn(
        'workspace-content app-panels flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l bg-background',
        // Group 强制内联 display: flex，隐藏时必须覆盖它并保留终端挂载。
        secondaryPageOpen && 'hidden!',
      )}
    >
      <ResizablePanel
        id="workspace-projects"
        panelRef={projectPanelRef}
        defaultSize={240}
        minSize={240}
        maxSize={240}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        className="project-sidebar-panel flex min-h-0 min-w-0 flex-col border-r"
        style={{ overflow: 'hidden' }}
      >
        <ProjectSidebar projects={projects} homeActive={activeNavigation === 'home'} />
      </ResizablePanel>
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
  )
}
