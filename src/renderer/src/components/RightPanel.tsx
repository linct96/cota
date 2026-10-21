import { useEffect } from 'react'
import { Folder, GitBranch, PanelRightClose } from 'lucide-react'
import { usePanelCallbackRef } from 'react-resizable-panels'
import type { ProjectWorkspace } from '../../../shared/contracts'
import { useRightPanel } from '../lib/right-panel-store'
import { cn } from '../lib/utils'
import { SourceControlPanel } from './SourceControlPanel'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { ResizableHandle, ResizablePanel } from './ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function RightPanel({
  workspace,
  active,
}: {
  workspace?: ProjectWorkspace
  active: boolean
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
        className={cn('right-panel-resize-handle', !visible && 'hidden')}
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
            'right-panel min-h-0 min-w-0 flex-1 flex-col bg-card',
            visible ? 'flex' : 'hidden',
          )}
          aria-label="右侧工具面板"
          inert={!visible}
        >
          <Tabs defaultValue="git" className="right-panel-tools min-h-0 flex-1 gap-0">
            <header className="right-panel-header title-bar flex h-[44px] shrink-0 items-center justify-between gap-2 border-b border-titlebar-separator bg-background pr-3 pl-2">
              <TabsList className="right-panel-tool-tabs" aria-label="右侧面板功能">
                <TabsTrigger
                  value="git"
                  className="right-panel-git-tab w-8 flex-none"
                  aria-label="Git 管理"
                  title="Git 管理"
                >
                  <GitBranch className="right-panel-git-tab-icon" />
                </TabsTrigger>
                <TabsTrigger
                  value="files"
                  className="right-panel-files-tab w-8 flex-none"
                  aria-label="文件浏览"
                  title="文件浏览"
                >
                  <Folder className="right-panel-files-tab-icon" />
                </TabsTrigger>
              </TabsList>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="navigation"
                      size="icon"
                      className="right-panel-collapse shrink-0"
                      aria-label="收起右侧面板"
                      aria-expanded={true}
                      aria-controls="right-panel-content"
                      onClick={collapse}
                    />
                  }
                >
                  <PanelRightClose className="right-panel-collapse-icon" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="bottom">收起右侧面板</TooltipContent>
              </Tooltip>
            </header>
            <TabsContent
              value="git"
              keepMounted
              className="right-panel-git-content flex min-h-0 flex-col overflow-hidden [&[hidden]]:hidden"
            >
              {workspace ? (
                <SourceControlPanel key={workspace.id} workspace={workspace} active={visible} />
              ) : (
                <Empty className="right-panel-no-workspace rounded-none">
                  <EmptyHeader className="right-panel-no-workspace-header">
                    <EmptyTitle className="right-panel-no-workspace-title">
                      尚未选择工作区
                    </EmptyTitle>
                    <EmptyDescription className="right-panel-no-workspace-description">
                      选择工作区后，在这里管理 Git 更改、历史和分支比较。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
            <TabsContent
              value="files"
              className="right-panel-files-content flex min-h-0 flex-col overflow-auto"
            >
              <Empty className="right-panel-files-placeholder rounded-none">
                <EmptyHeader className="right-panel-files-placeholder-header">
                  <EmptyTitle className="right-panel-files-placeholder-title">文件浏览</EmptyTitle>
                  <EmptyDescription className="right-panel-files-placeholder-description">
                    文件浏览功能暂未开放。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </TabsContent>
          </Tabs>
        </aside>
      </ResizablePanel>
    </>
  )
}
