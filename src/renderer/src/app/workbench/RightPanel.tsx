import { useEffect, useState } from 'react'
import { usePanelCallbackRef } from 'react-resizable-panels'
import type { ProjectWorkspace } from '../../../../shared/contracts'
import { useRightPanel } from '@/state/right-panel-store'
import { useWorkspace } from '@/state/workspace'
import { cn } from '@/lib/utils'
import { SourceControlPanel } from '@/features/source-control/components/SourceControlPanel'
import { FileExplorer } from '@/features/files/components/FileExplorer'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable'
import { TabsContent } from '@/components/ui/tabs'

export function RightPanel({
  workspace,
  active,
  filesActive,
  gitAvailable,
}: {
  workspace?: ProjectWorkspace
  active: boolean
  filesActive: boolean
  gitAvailable: boolean
}) {
  const open = useRightPanel((state) => state.open)
  const [panel, panelRef] = usePanelCallbackRef()
  const visible = active && open
  const workspaces = useWorkspace((state) => state.workspaces)
  const [visited, setVisited] = useState<string[]>([])
  const currentGitId = gitAvailable ? workspace?.id : undefined
  const gitWorkspaces = workspaces.filter(
    (entry) => entry.id === currentGitId || visited.includes(entry.id),
  )
  const nextVisited = gitWorkspaces.map((entry) => entry.id)
  // Retain visited views and prune removed workspaces before rendering their children.
  if (
    nextVisited.length !== visited.length ||
    nextVisited.some((id, index) => id !== visited[index])
  )
    setVisited(nextVisited)

  // The parent Group registers in a layout effect, so resizing must wait until after it.
  useEffect(() => {
    panel?.resize(visible ? useRightPanel.getState().width : 0)
  }, [panel, visible])

  function collapse() {
    useRightPanel.setState({ open: false })
    requestAnimationFrame(() => document.getElementById('right-panel-toggle')?.focus())
  }

  return (
    <>
      <ResizableHandle
        className={cn('workspace-resize-handle right-panel-resize-handle', !visible && 'hidden')}
        disabled={!visible}
        aria-label="调整右侧面板宽度"
      />
      <ResizablePanel
        id="workspace-right"
        panelRef={panelRef}
        defaultSize={0}
        minSize={240}
        maxSize="65%"
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size, _id, previous) => {
          if (!active || !previous) return
          if (size.inPixels === 0) {
            if (useRightPanel.getState().open) collapse()
          } else if (useRightPanel.getState().open) {
            useRightPanel.setState({ width: size.inPixels })
          }
        }}
        className="right-panel-container flex min-h-0 min-w-0 flex-col"
        style={{ overflow: 'hidden' }}
      >
        <aside
          id="right-panel-content"
          className={cn(
            'right-panel min-h-0 min-w-0 flex-1 flex-col bg-background',
            visible ? 'flex' : 'hidden',
          )}
          aria-label="右侧工具面板"
          inert={!visible}
        >
          {(currentGitId || visited.length > 0) && (
            <TabsContent
              value="git"
              keepMounted
              className="right-panel-git-content flex min-h-0 flex-col overflow-hidden [&[hidden]]:hidden"
            >
              {gitWorkspaces.map((entry) => (
                <div
                  key={`${entry.projectPath}:${entry.id}`}
                  className={cn(
                    'right-panel-git-workspace min-h-0 flex-1 flex-col overflow-hidden',
                    entry.id === currentGitId ? 'flex' : 'hidden',
                  )}
                  inert={entry.id !== currentGitId || !visible || filesActive}
                >
                  <SourceControlPanel
                    workspace={entry}
                    active={visible && entry.id === currentGitId}
                    selected={!filesActive && entry.id === currentGitId}
                  />
                </div>
              ))}
            </TabsContent>
          )}
          <TabsContent
            value="files"
            keepMounted
            className="right-panel-files-content flex min-h-0 flex-col overflow-hidden [&[hidden]]:hidden"
          >
            {workspace ? (
              <FileExplorer
                key={workspace.id}
                workspace={workspace}
                active={visible && filesActive}
              />
            ) : (
              <Empty className="right-panel-files-no-workspace rounded-none">
                <EmptyHeader className="right-panel-files-no-workspace-header">
                  <EmptyTitle className="right-panel-files-no-workspace-title">
                    尚未选择工作区
                  </EmptyTitle>
                  <EmptyDescription className="right-panel-files-no-workspace-description">
                    选择工作区后，在这里浏览文件。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
        </aside>
      </ResizablePanel>
    </>
  )
}
