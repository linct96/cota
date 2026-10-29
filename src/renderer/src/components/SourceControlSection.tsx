import { useState, type ReactNode } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable'

export function SourceControlSectionLayout({
  children,
  section,
  resizeLabel,
  defaultOpen = true,
}: {
  children: ReactNode
  section?: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode
  resizeLabel: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelRef = usePanelRef()

  function changeOpen(open: boolean) {
    const panel = panelRef.current
    if (!panel) return
    if (open) panel.expand()
    else panel.collapse()
    setOpen(!panel.isCollapsed())
  }

  if (!section) return children

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="source-control-section-layout min-h-0 min-w-0 flex-1"
    >
      <ResizablePanel
        defaultSize={defaultOpen ? '60%' : undefined}
        minSize="20%"
        className="source-control-section-primary-panel flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        {children}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        className="source-control-section-resize-handle"
        aria-label={resizeLabel}
      />
      <ResizablePanel
        panelRef={panelRef}
        defaultSize={defaultOpen ? '40%' : '2rem'}
        minSize="6rem"
        collapsible
        collapsedSize="2rem"
        onResize={() => {
          const panel = panelRef.current
          if (panel) setOpen(!panel.isCollapsed())
        }}
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
  children,
}: {
  title: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
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
