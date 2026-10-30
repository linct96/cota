import { useEffect } from 'react'
import { usePanelCallbackRef } from 'react-resizable-panels'
import { RightPanel } from '@/app/workbench/RightPanel'
import { useLeftPanel } from '@/state/left-panel-store'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
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
      projectPanel?.resize(leftPanelOpen ? useLeftPanel.getState().width : 0)
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
        minSize={200}
        maxSize={400}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size, _id, previous) => {
          if (secondaryPageOpen || !previous) return
          if (size.inPixels === 0) {
            if (useLeftPanel.getState().open) {
              useLeftPanel.setState({ open: false })
              requestAnimationFrame(() => document.getElementById('left-panel-toggle')?.focus())
            }
          } else if (useLeftPanel.getState().open) {
            useLeftPanel.setState({ width: size.inPixels })
          }
        }}
        className="project-sidebar-panel flex min-h-0 min-w-0 flex-col"
        style={{ overflow: 'hidden' }}
      >
        <ProjectSidebar projects={projects} homeActive={activeNavigation === 'home'} />
      </ResizablePanel>
      <ResizableHandle
        className={cn(
          'workspace-resize-handle project-sidebar-resize-handle',
          !leftPanelOpen && 'hidden',
        )}
        disabled={!leftPanelOpen}
        aria-label="调整项目面板宽度"
      />
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
