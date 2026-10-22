import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import {
  Accessibility,
  DragDropManager,
  Feedback,
  PointerActivationConstraints,
  type DragDropManagerInput,
} from '@dnd-kit/dom'
import { RestrictToHorizontalAxis } from '@dnd-kit/abstract/modifiers'
import { useWorkspace, type TerminalTab as TerminalTabData } from '../store'
import { TerminalTab } from './TerminalTab'
import { ScrollArea, ScrollBar } from './ui/scroll-area'

const accessibilityOptions: ConstructorParameters<typeof Accessibility>[1] = {
  screenReaderInstructions: {
    draggable:
      '按 Shift 加空格拿起终端标签，使用左右方向键调整位置，按空格或回车放下，按 Escape 取消。',
  },
  announcements: {
    dragstart: ({ operation }) => `已拿起 ${operation.source?.data.title}。`,
    dragover: ({ operation }) =>
      isSortable(operation.source)
        ? `${operation.source.data.title}，第 ${operation.source.index + 1} 个位置。`
        : undefined,
    dragend: ({ canceled, operation }) =>
      canceled
        ? '已取消排序。'
        : isSortable(operation.source)
          ? `${operation.source.data.title} 已移至第 ${operation.source.index + 1} 个位置。`
          : undefined,
  },
}

const dragOptions: DragDropManagerInput = {
  modifiers: [RestrictToHorizontalAxis],
  sensors: [
    PointerSensor.configure({
      activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
    }),
    KeyboardSensor.configure({
      keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ['Space'] },
      preventActivation: (event, source) => !event.shiftKey || event.target !== source.element,
    }),
  ],
  plugins: (defaults) => [
    ...defaults.filter((plugin) => plugin !== Accessibility && plugin !== Feedback),
    { plugin: Accessibility, options: accessibilityOptions },
    Feedback.configure({ feedback: 'clone' }),
  ],
}

export function TerminalTabList({
  workspaceId,
  tabs,
  activeId,
  disabled,
  children,
}: {
  workspaceId: string
  tabs: TerminalTabData[]
  activeId?: string
  disabled: boolean
  children?: ReactNode
}) {
  const [manager] = useState(() => new DragDropManager(dragOptions))
  const listRef = useRef<HTMLDivElement>(null)
  const tabIds = tabs
    .map((tab) => `${tab.id}:${tab.status === 'starting' || !!tab.closingStatus}`)
    .join(',')

  useLayoutEffect(() => {
    const cancel = () => {
      if (manager.dragOperation.status.dragging) manager.actions.stop({ canceled: true })
    }
    const checkDrop = (event: PointerEvent) => {
      const rect = listRef.current?.getBoundingClientRect()
      if (
        rect &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerup', checkDrop, true)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerup', checkDrop, true)
      cancel()
    }
  }, [manager, tabIds, disabled])

  return (
    <DragDropProvider
      manager={manager}
      {...dragOptions}
      onDragEnd={({ canceled, operation }) => {
        if (canceled || !operation.target || !isSortable(operation.source)) return
        const { source } = operation
        useWorkspace.getState().reorderTab(workspaceId, String(source.id), source.index)
      }}
    >
      <ScrollArea ref={listRef} className="terminal-tab-scroll-area h-full min-w-0 max-w-full">
        <div
          role="tablist"
          tabIndex={-1}
          aria-label="工作区标签"
          className="terminal-tab-list flex h-full w-max min-w-full items-center gap-1"
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              !manager.dragOperation.status.idle ||
              (event.target as HTMLElement).getAttribute('role') !== 'tab'
            )
              return
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="tab"]:not([aria-hidden="true"])',
              ),
            )
            const index = items.indexOf(event.target as HTMLElement)
            const next =
              event.key === 'ArrowRight'
                ? items[(index + 1) % items.length]
                : event.key === 'ArrowLeft'
                  ? items[(index - 1 + items.length) % items.length]
                  : event.key === 'Home'
                    ? items[0]
                    : event.key === 'End'
                      ? items.at(-1)
                      : undefined
            if (!next) return
            event.preventDefault()
            next.click()
            next.focus()
          }}
        >
          {tabs.map((tab, index) => (
            <TerminalTab
              key={tab.id}
              tab={tab}
              index={index}
              active={tab.id === activeId}
              closeDisabled={tab.status === 'starting' || !!tab.closingStatus || disabled}
              onSelect={() => useWorkspace.getState().selectTab(tab.id)}
              onClose={() => void useWorkspace.getState().closeTab(tab.id)}
            />
          ))}
          {children}
        </div>
        <ScrollBar orientation="horizontal" className="terminal-tab-scrollbar" />
      </ScrollArea>
    </DragDropProvider>
  )
}
