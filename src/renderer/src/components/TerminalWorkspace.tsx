import { Fragment, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, Rows2, X } from 'lucide-react'
import { MAX_TERMINALS } from '../../../shared/contracts'
import {
  pruneTerminalPane,
  terminalPaneIds,
  type TerminalPane,
  type TerminalLayout,
} from '../../../shared/terminal-layout'
import { terminalTabId, useWorkspace, type TerminalTab } from '../store'
import { cn } from '../lib/utils'
import { TerminalView } from './TerminalView'
import { Button } from './ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable'

function PaneLayout({ node, split }: { node: TerminalPane; split: boolean }) {
  const tabs = useWorkspace((state) => state.tabs)
  const activeTabs = useWorkspace((state) => state.activeTabs)
  const removing = useWorkspace((state) => state.removingWorkspace)
  const closing = useWorkspace((state) => state.closingTerminalTabs)
  if (node.type === 'terminal') {
    const tab = tabs.find((tab) => tab.id === node.id)!
    const focused = activeTabs[tab.workspaceId] === tab.id
    const disabled =
      !!removing ||
      !!tab.closingStatus ||
      tab.status === 'starting' ||
      closing.includes(terminalTabId(useWorkspace.getState(), tab.id))
    return (
      <div
        className="terminal-pane flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
        data-focused={focused}
        onPointerDownCapture={() => {
          if (!focused && !removing) useWorkspace.getState().selectTab(tab.id)
        }}
        onFocusCapture={() => {
          if (!focused && !removing) useWorkspace.getState().selectTab(tab.id)
        }}
      >
        {split && (
          <div className="terminal-pane-header flex h-8 shrink-0 items-center gap-1 border-b px-2">
            <span
              className="terminal-pane-title min-w-0 flex-1 truncate text-xs"
              title={tab.cwd || tab.projectPath}
            >
              {tab.cwd || tab.projectPath}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="terminal-pane-split-button"
              aria-label={`向右拆分 ${tab.title}`}
              title="向右拆分"
              disabled={disabled || tabs.length >= MAX_TERMINALS}
              onClick={() => useWorkspace.getState().splitTerminal(tab.id)}
            >
              <Columns2 className="terminal-pane-split-icon" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="terminal-pane-split-down-button"
              aria-label={`向下拆分 ${tab.title}`}
              title="向下拆分"
              disabled={disabled || tabs.length >= MAX_TERMINALS}
              onClick={() => useWorkspace.getState().splitTerminal(tab.id, 'vertical')}
            >
              <Rows2 className="terminal-pane-split-down-icon" data-icon="inline-start" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="terminal-pane-close-button"
              aria-label={`关闭 ${tab.title} 面板`}
              title="关闭面板"
              disabled={disabled}
              onClick={() => void useWorkspace.getState().closePane(tab.id)}
            >
              <X className="terminal-pane-close-icon" />
            </Button>
          </div>
        )}
        <div
          id={`terminal-slot-${node.id}`}
          className="terminal-pane-slot min-h-0 min-w-0 flex-1 overflow-hidden"
        />
      </div>
    )
  }
  return (
    <ResizablePanelGroup
      id={`terminal-split-${node.id}`}
      orientation={node.direction}
      className="terminal-split-group min-h-0 min-w-0"
      defaultLayout={{
        [node.children[0].id]: node.ratio * 100,
        [node.children[1].id]: (1 - node.ratio) * 100,
      }}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return
        const ratio = (meta.requestedLayout || layout)[node.children[0].id] / 100
        if (Math.abs(ratio - node.ratio) > 0.0001)
          useWorkspace.getState().resizeTerminalSplit(node.id, ratio)
      }}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && (
            <ResizableHandle
              className="terminal-pane-resize-handle"
              aria-label="调整终端面板大小"
            />
          )}
          <ResizablePanel
            id={child.id}
            minSize="5%"
            className="terminal-split-panel min-h-0 min-w-0 overflow-hidden"
          >
            <PaneLayout node={child} split />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

function TerminalSurface({
  tab,
  active,
  focused,
  layout,
}: {
  tab: TerminalTab
  active: boolean
  focused: boolean
  layout: Pick<TerminalLayout, 'id' | 'root'>[]
}) {
  const [container] = useState(() => {
    const element = document.createElement('div')
    element.className = 'terminal-surface flex size-full min-h-0 min-w-0'
    return element
  })
  // Reparent only the portal container; xterm and its PTY attachment stay mounted.
  useLayoutEffect(() => {
    const slot = document.getElementById(`terminal-slot-${tab.id}`)
    if (slot && container.parentElement !== slot) slot.appendChild(container)
  }, [container, tab.id, layout])
  useLayoutEffect(() => () => container.remove(), [container])
  return createPortal(<TerminalView tab={tab} active={active} focused={focused} />, container)
}

export function TerminalWorkspace({ activeId, visible }: { activeId?: string; visible: boolean }) {
  const tabs = useWorkspace((state) => state.tabs)
  const layouts = useWorkspace((state) => state.terminalLayouts)
  const ids = new Set(tabs.map((tab) => tab.id))
  const groups = layouts.flatMap((group) => {
    const root = pruneTerminalPane(group.root, ids)
    return root ? [{ ...group, root }] : []
  })
  const grouped = new Set(groups.flatMap((group) => terminalPaneIds(group.root)))
  const roots: Pick<TerminalLayout, 'id' | 'root'>[] = [
    ...groups,
    ...tabs
      .filter((tab) => !grouped.has(tab.id))
      .map((tab) => ({ id: tab.id, root: { type: 'terminal' as const, id: tab.id } })),
  ]
  const activeRoot = roots.find((group) => terminalPaneIds(group.root).includes(activeId || ''))
  const activeIds = new Set(activeRoot ? terminalPaneIds(activeRoot.root) : [])
  return (
    <>
      {roots.map((group) => (
        <div
          key={group.id}
          id={`terminal-panel-${group.id}`}
          role="tabpanel"
          aria-labelledby={`terminal-tab-${group.id}`}
          className={cn(
            'terminal-pane-group col-start-1 row-start-1 min-h-0 min-w-0 overflow-hidden',
            !terminalPaneIds(group.root).includes(activeId || '') && 'hidden',
          )}
        >
          <PaneLayout node={group.root} split={group.root.type === 'split'} />
        </div>
      ))}
      {tabs.map((tab) => (
        <TerminalSurface
          key={tab.id}
          tab={tab}
          layout={roots}
          active={visible && activeIds.has(tab.id)}
          focused={visible && activeId === tab.id}
        />
      ))}
    </>
  )
}
