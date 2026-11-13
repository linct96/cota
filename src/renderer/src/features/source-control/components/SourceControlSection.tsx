import { useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { flushSync } from 'react-dom'
import { usePanelCallbackRef } from 'react-resizable-panels'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

export function SourceControlSectionLayout({
  children,
  section,
  resizeLabel,
  defaultOpen = false,
  defaultExpandedSize = '40%',
  onOpenChange,
}: {
  children: ReactNode
  section?: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode
  resizeLabel: string
  defaultOpen?: boolean
  defaultExpandedSize?: string
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expandedSize = useRef<string | undefined>(undefined)
  const [panel, setPanel] = usePanelCallbackRef()

  function changeOpen(nextOpen: boolean) {
    if (!panel) return
    // 先提交新的尺寸约束，避免 resize 被上一状态的最大高度截断。
    flushSync(() => {
      setOpen(nextOpen)
      onOpenChange?.(nextOpen)
    })
    panel.resize(nextOpen ? (expandedSize.current ?? defaultExpandedSize) : '2rem')
  }

  if (!section) return children

  return (
    <ResizablePanelGroup
      orientation="vertical"
      onLayoutChanged={(_, { isUserInteraction }) => {
        if (open && isUserInteraction && panel) {
          expandedSize.current = `${panel.getSize().asPercentage}%`
        }
      }}
      className="source-control-section-layout min-h-0 min-w-0 flex-1"
    >
      <ResizablePanel
        minSize="20%"
        className="source-control-section-primary-panel flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        {children}
      </ResizablePanel>
      <ResizableHandle
        withHandle={open}
        className={cn('source-control-section-resize-handle', !open && 'pointer-events-none')}
        aria-label={resizeLabel}
        disabled={!open}
        disableDoubleClick
      />
      <ResizablePanel
        panelRef={setPanel}
        defaultSize={defaultOpen ? defaultExpandedSize : '2rem'}
        minSize={open ? '6.6rem' : '2rem'}
        maxSize={open ? undefined : '2rem'}
        className="source-control-section-secondary-panel flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        {section(open, changeOpen)}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export function SourceControlSection({
  title,
  open,
  onOpenChange,
  disabled,
  triggerRef,
  children,
}: {
  title: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
  triggerRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="source-control-section flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <h3 className="source-control-section-header flex h-8 shrink-0 border-b">
        <CollapsibleTrigger
          ref={triggerRef}
          disabled={disabled}
          className="source-control-section-trigger group/source-control-section flex h-full min-w-0 flex-1 items-center justify-between gap-2 bg-transparent px-3 text-left text-xs font-medium text-app-muted-foreground transition-colors hover:bg-background-hover hover:text-foreground aria-expanded:text-foreground"
        >
          <span className="source-control-section-title flex min-w-0 items-center gap-2">
            {title}
          </span>
          <ChevronRight
            className="source-control-section-toggle-icon size-3.5 shrink-0 group-aria-expanded/source-control-section:rotate-90"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent
        keepMounted
        className="source-control-section-content flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
