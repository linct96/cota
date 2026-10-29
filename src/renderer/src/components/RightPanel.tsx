import { useEffect } from 'react'
import { usePanelCallbackRef } from 'react-resizable-panels'
import type { ProjectWorkspace } from '../../../shared/contracts'
import { useRightPanel } from '../lib/right-panel-store'
import { cn } from '../lib/utils'
import { SourceControlPanel } from './SourceControlPanel'
import { FileExplorer } from './FileExplorer'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { ResizableHandle, ResizablePanel } from './ui/resizable'
import { TabsContent } from './ui/tabs'

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
          {gitAvailable && workspace && (
            <TabsContent
              value="git"
              keepMounted
              className="right-panel-git-content flex min-h-0 flex-col overflow-hidden [&[hidden]]:hidden"
            >
              <SourceControlPanel
                key={workspace.id}
                workspace={workspace}
                active={visible}
                selected={!filesActive}
              />
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
