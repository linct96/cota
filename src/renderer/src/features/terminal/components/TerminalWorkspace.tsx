import { Component, Fragment, createRef, useId, useLayoutEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { DragDropProvider, PointerSensor, useDragDropMonitor, useDraggable } from '@dnd-kit/react'
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from '@dnd-kit/dom'
import { Columns2, GripVertical, Maximize, Minimize, Rows2, X } from 'lucide-react'
import { MAX_TERMINALS } from '../../../../../shared/contracts'
import { pruneTerminalPane, terminalPaneIds } from '../../../../../shared/terminal-layout'
import type { TerminalLayout, TerminalPane } from '../../../../../shared/terminal-layout'
import { terminalTabId, useWorkspace } from '@/state/workspace'
import type { TerminalTab } from '@/state/workspace'
import { abbreviateHomePath, cn } from '@/lib/utils'
import { TerminalView } from './TerminalView'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

const paneDragSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]

function animatePaneSwap(source: string, target: string) {
  const sourcePane = document.getElementById(`terminal-slot-${source}`)?.parentElement
  const targetPane = document.getElementById(`terminal-slot-${target}`)?.parentElement
  const group = sourcePane?.closest<HTMLElement>('.terminal-pane-group')
  const scope:
    | (HTMLElement & { startViewTransition?: (update: () => void) => ViewTransition })
    | null
    | undefined = group
  const swap = () => useWorkspace.getState().swapTerminalPanes(source, target)
  if (
    !scope?.startViewTransition ||
    scope.hasAttribute('data-swap-transition') ||
    !sourcePane ||
    !targetPane ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    swap()
    return
  }

  // These two DOM nodes are the slots; their transition names follow the terminal IDs.
  scope.dataset.swapTransition = ''
  sourcePane.dataset.swapAnimating = ''
  targetPane.dataset.swapAnimating = ''
  const transition = scope.startViewTransition(() => {
    if (scope.getClientRects().length) flushSync(swap)
  })
  const cleanup = () => {
    delete scope.dataset.swapTransition
    delete sourcePane.dataset.swapAnimating
    delete targetPane.dataset.swapAnimating
  }
  void transition.finished.then(cleanup, cleanup)
  void transition.ready.catch(() => {})
  return transition
}

function PaneSwapHandle({ tab, candidates }: { tab: TerminalTab; candidates: TerminalTab[] }) {
  const { id } = tab
  const swapFocus = useRef<string>(undefined)
  // The handle stays in its split slot while terminal IDs move between slots.
  const draggableId = useId()
  const { ref: dragRef } = useDraggable({ id: draggableId, data: { terminalId: id } })
  const [menuOpen, setMenuOpen] = useState(false)
  useDragDropMonitor({ onDragStart: () => setMenuOpen(false) })

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        // Base UI normally opens on mouse down, before a drag can activate.
        onMouseDown={(event) => event.preventBaseUIHandler()}
        onClick={(event) => {
          event.preventBaseUIHandler()
          swapFocus.current = undefined
          setMenuOpen((open) => !open)
        }}
        render={
          <Button
            ref={dragRef}
            id={`terminal-pane-reorder-${id}`}
            variant="ghost"
            size="icon-xs"
            className="terminal-pane-reorder-button cursor-grab touch-none"
            aria-label={`交换终端面板 ${tab.title}`}
            title="拖拽交换面板，或点击选择目标"
          />
        }
      >
        <GripVertical className="terminal-pane-reorder-icon" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        finalFocus={() =>
          swapFocus.current
            ? document.getElementById(`terminal-pane-reorder-${swapFocus.current}`)
            : true
        }
      >
        {candidates
          .filter((target) => target.id !== id)
          .map((target) => (
            <DropdownMenuItem
              key={target.id}
              className="terminal-pane-swap-target"
              onClick={() => {
                if (useWorkspace.getState().swapTerminalPanes(id, target.id)) swapFocus.current = id
              }}
            >
              {target.title}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type PaneOptions = {
  canMaximize: boolean
  maximizedId?: string
  swapCandidates: TerminalTab[]
  draggingId?: string
  dropTargetId?: string
}

function PaneView({
  id,
  canMaximize,
  maximizedId,
  swapCandidates,
  draggingId,
  dropTargetId,
}: PaneOptions & { id: string }) {
  const tabs = useWorkspace((state) => state.tabs)
  const activeTabs = useWorkspace((state) => state.activeTabs)
  const removing = useWorkspace((state) => state.removingWorkspace)
  const closing = useWorkspace((state) => state.closingTerminalTabs)
  const tab = tabs.find((candidateTab) => candidateTab.id === id)!
  const focused = activeTabs[tab.workspaceId] === id
  const maximized = maximizedId === id
  const maximizeLabel = maximized ? '还原终端面板' : '放大终端面板'
  const MaximizeIcon = maximized ? Minimize : Maximize
  const disabled =
    !!removing ||
    !!tab.closingStatus ||
    tab.status === 'starting' ||
    closing.includes(terminalTabId(useWorkspace.getState(), id))
  const canSwap = swapCandidates.length > 1 && swapCandidates.includes(tab)

  const activatePane = (event: SyntheticEvent<HTMLDivElement>) => {
    const { target, currentTarget } = event
    if (
      !focused &&
      !removing &&
      target instanceof Element &&
      currentTarget.contains(target) &&
      !target.closest('.terminal-pane-reorder-button')
    )
      useWorkspace.getState().selectTab(id)
  }

  return (
    <div
      className="terminal-pane flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-terminal-pane-id={id}
      data-terminal-swap-name={`terminal-swap-${id}`}
      data-focused={focused}
      data-maximized={maximized || undefined}
      data-dragging={(canSwap && id === draggingId) || undefined}
      data-drop-target={(canSwap && id === dropTargetId) || undefined}
      onPointerDownCapture={activatePane}
      onFocusCapture={activatePane}
    >
      <div className="terminal-pane-header flex h-8 shrink-0 items-center gap-1 border-b px-2">
        {canSwap && <PaneSwapHandle tab={tab} candidates={swapCandidates} />}
        <span
          className="terminal-pane-title min-w-0 flex-1 truncate text-xs"
          title={abbreviateHomePath(tab.cwd || tab.projectPath)}
        >
          {abbreviateHomePath(tab.cwd || tab.projectPath)}
        </span>
        {canMaximize && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="terminal-pane-maximize-button"
            aria-label={`${maximizeLabel} ${tab.title}`}
            title={maximizeLabel}
            disabled={disabled}
            onClick={() =>
              useWorkspace.setState({ maximizedTerminalId: maximized ? undefined : id })
            }
          >
            <MaximizeIcon className="terminal-pane-maximize-icon" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="terminal-pane-split-button"
          aria-label={`向右拆分 ${tab.title}`}
          title="向右拆分"
          disabled={disabled || tabs.length >= MAX_TERMINALS}
          onClick={() => useWorkspace.getState().splitTerminal(id)}
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
          onClick={() => useWorkspace.getState().splitTerminal(id, 'vertical')}
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
          onClick={() => void useWorkspace.getState().closePane(id)}
        >
          <X className="terminal-pane-close-icon" />
        </Button>
      </div>
      <div
        id={`terminal-slot-${id}`}
        className="terminal-pane-slot isolate min-h-0 min-w-0 flex-1 overflow-hidden"
      />
    </div>
  )
}

function PaneLayout({ node, ...options }: PaneOptions & { node: TerminalPane }) {
  return (
    <div
      id={`terminal-region-${node.id}`}
      className="terminal-pane-region size-full min-h-0 min-w-0"
    >
      {node.type === 'terminal' ? (
        <PaneView id={node.id} {...options} />
      ) : (
        <PaneSplit node={node} {...options} />
      )}
    </div>
  )
}

function PaneSplit({
  node,
  ...options
}: PaneOptions & { node: Extract<TerminalPane, { type: 'split' }> }) {
  const { maximizedId } = options

  // Panel sizes belong to layout slots, not the terminals that occupy them.
  const panelIds = node.children.map((child, index) =>
    child.type === 'split' ? child.id : `${node.id}-slot-${index}`,
  )
  return (
    <ResizablePanelGroup
      id={`terminal-split-${node.id}`}
      orientation={node.direction}
      className="terminal-split-group min-h-0 min-w-0"
      disabled={!!maximizedId}
      style={maximizedId ? { position: 'static', overflow: 'visible' } : undefined}
      defaultLayout={{
        [panelIds[0]]: node.ratio * 100,
        [panelIds[1]]: (1 - node.ratio) * 100,
      }}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return
        const ratio = (meta.requestedLayout || layout)[panelIds[0]] / 100
        if (Math.abs(ratio - node.ratio) > 0.0001)
          useWorkspace.getState().resizeTerminalSplit(node.id, ratio)
      }}
    >
      {node.children.map((child, index) => (
        <Fragment key={panelIds[index]}>
          {index > 0 && (
            <ResizableHandle
              className="terminal-pane-resize-handle"
              aria-label="调整终端面板大小"
            />
          )}
          <ResizablePanel
            id={panelIds[index]}
            minSize="5%"
            className="terminal-split-panel min-h-0 min-w-0 overflow-hidden"
            style={maximizedId ? { overflow: 'visible' } : undefined}
          >
            <PaneLayout node={child} {...options} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

type PaneGroupProps = PaneOptions & {
  groupId: string
  node: TerminalPane
  active: boolean
  animateCollapse: boolean
}

// When one leaf closes, only the sibling of that leaf inherits the split's space.
function findExpandingRegion(node: TerminalPane, closed: string): string | undefined {
  if (node.type === 'terminal') return
  const [first, second] = node.children
  if (first.type === 'terminal' && first.id === closed) return second.id
  if (second.type === 'terminal' && second.id === closed) return first.id
  return findExpandingRegion(first, closed) ?? findExpandingRegion(second, closed)
}

type CollapseSnapshot = { regionId: string; rect: DOMRect }

class TerminalPaneGroup extends Component<PaneGroupProps> {
  private readonly scope = createRef<HTMLDivElement>()

  getSnapshotBeforeUpdate(previous: PaneGroupProps): CollapseSnapshot | null {
    const { node, animateCollapse } = this.props
    if (!animateCollapse || !previous.animateCollapse || node === previous.node) return null
    const oldIds = new Set(terminalPaneIds(previous.node))
    const remaining = terminalPaneIds(node)
    if (oldIds.size !== remaining.length + 1) return null
    for (const id of remaining) if (!oldIds.delete(id)) return null
    if (
      this.scope.current?.hasAttribute('data-swap-transition') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return null

    const [closed] = oldIds
    const survivor = findExpandingRegion(previous.node, closed)
    if (!survivor) return null
    const regionId = `terminal-region-${survivor}`
    const rect = document.getElementById(regionId)?.firstElementChild?.getBoundingClientRect()
    return rect?.width && rect.height ? { regionId, rect } : null
  }

  componentDidUpdate(previous: PaneGroupProps, _state: unknown, before: CollapseSnapshot | null) {
    if (previous.animateCollapse && !this.props.animateCollapse) {
      for (const region of this.scope.current?.querySelectorAll('[data-pane-expanding]') ?? [])
        region.getAnimations().forEach((animation) => animation.cancel())
    }
    if (!before) return
    const region = document.getElementById(before.regionId)
    if (!region) return
    region.getAnimations().forEach((animation) => animation.cancel())
    const from = before.rect
    const to = region.getBoundingClientRect()
    const insets = [
      from.top - to.top,
      to.right - from.right,
      to.bottom - from.bottom,
      from.left - to.left,
    ]
    if (!insets.some((inset) => inset >= 1)) return

    // Reserve the old footprint with padding so nested handles and headers move without scaling.
    const animation = region.animate(
      [{ padding: insets.map((inset) => `${Math.max(0, inset)}px`).join(' ') }, { padding: '0px' }],
      { duration: 120, easing: 'linear' },
    )
    region.dataset.paneExpanding = ''
    const cleanup = () => {
      if (!region.getAnimations().length) delete region.dataset.paneExpanding
    }
    void animation.finished.then(cleanup, cleanup)
  }

  render() {
    const { groupId, node, active, animateCollapse: _animateCollapse, ...options } = this.props
    return (
      <div
        ref={this.scope}
        id={`terminal-panel-${groupId}`}
        role="tabpanel"
        aria-labelledby={`terminal-tab-${groupId}`}
        data-pane-maximized={!!options.maximizedId || undefined}
        className={cn(
          'terminal-pane-group relative col-start-1 row-start-1 min-h-0 min-w-0 overflow-hidden p-2',
          !active && 'hidden',
        )}
      >
        <PaneLayout node={node} {...options} />
      </div>
    )
  }
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
  const maximizedTerminalId = useWorkspace((state) => state.maximizedTerminalId)
  const removing = useWorkspace((state) => state.removingWorkspace)
  const closing = useWorkspace((state) => state.closingTerminalTabs)
  const [draggingId, setDraggingId] = useState<string>()
  const [dropTargetId, setDropTargetId] = useState<string>()
  const preview = useRef<HTMLDivElement>(null)
  const pointer = useRef<PointerEvent>(undefined)
  const swapTransition = useRef<ViewTransition>(undefined)
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
  const swapCandidates =
    visible &&
    activeRoot?.root.type === 'split' &&
    !maximizedTerminalId &&
    !removing &&
    !closing.includes(activeRoot.id)
      ? tabs.filter(
          (tab) => activeIds.has(tab.id) && tab.status !== 'starting' && !tab.closingStatus,
        )
      : []
  const draggedTab = swapCandidates.find((tab) => tab.id === draggingId)
  const positionPreview = () => {
    const element = preview.current
    if (!element || !pointer.current) return
    const { clientX, clientY } = pointer.current
    // Flip when there is no room below for the preview, pointer gap, and edge margin.
    element.toggleAttribute('data-above-pointer', window.innerHeight - clientY < 28 + 6 + 8)
    element.style.setProperty('--terminal-drag-x', `${clientX}px`)
    element.style.setProperty('--terminal-drag-y', `${clientY}px`)
  }
  const dropTargetAt = (event: Event | undefined, source: string | undefined) => {
    if (!source || !(event instanceof PointerEvent)) return
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.terminal-pane')?.dataset.terminalPaneId
    if (target !== source && swapCandidates.some((tab) => tab.id === target)) return target
  }

  return (
    <DragDropProvider<{ terminalId: string }>
      sensors={paneDragSensors}
      plugins={(defaults) =>
        defaults.filter(
          (plugin) => plugin !== Feedback && plugin !== AutoScroller && plugin !== Accessibility,
        )
      }
      onDragStart={({ operation, nativeEvent }) => {
        swapTransition.current?.skipTransition()
        if (nativeEvent instanceof PointerEvent) pointer.current = nativeEvent
        setDraggingId(operation.source?.data.terminalId)
      }}
      onDragMove={({ operation, nativeEvent }) => {
        if (nativeEvent instanceof PointerEvent) {
          pointer.current = nativeEvent
          positionPreview()
        }
        setDropTargetId(dropTargetAt(nativeEvent, operation.source?.data.terminalId))
      }}
      onDragEnd={({ canceled, operation, nativeEvent }) => {
        setDraggingId(undefined)
        setDropTargetId(undefined)
        pointer.current = undefined
        const source = operation.source?.data.terminalId
        if (canceled || !source) return
        const target = dropTargetAt(nativeEvent, source)
        if (target) swapTransition.current = animatePaneSwap(source, target)
      }}
    >
      {draggedTab &&
        createPortal(
          <div
            ref={(element) => {
              preview.current = element
              positionPreview()
            }}
            aria-hidden="true"
            className="terminal-pane-drag-preview"
          >
            <GripVertical className="terminal-pane-drag-preview-icon" />
            <span className="terminal-pane-drag-preview-title truncate">{draggedTab.title}</span>
          </div>,
          document.body,
        )}
      {roots.map((group) => {
        const canMaximize = group.root.type === 'split'
        const maximizedId =
          group === activeRoot && canMaximize && activeId === maximizedTerminalId
            ? activeId
            : undefined
        return (
          <TerminalPaneGroup
            key={group.id}
            groupId={group.id}
            node={group.root}
            active={group === activeRoot}
            animateCollapse={
              visible &&
              group === activeRoot &&
              !maximizedId &&
              !draggingId &&
              !removing &&
              !closing.includes(group.id)
            }
            canMaximize={canMaximize}
            maximizedId={maximizedId}
            swapCandidates={group === activeRoot ? swapCandidates : []}
            draggingId={draggingId}
            dropTargetId={dropTargetId}
          />
        )
      })}
      {tabs.map((tab) => (
        <TerminalSurface
          key={tab.id}
          tab={tab}
          layout={roots}
          active={visible && activeIds.has(tab.id)}
          focused={visible && activeId === tab.id}
        />
      ))}
    </DragDropProvider>
  )
}
