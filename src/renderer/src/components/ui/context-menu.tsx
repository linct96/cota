import type { ComponentProps } from 'react'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { cn } from '@/lib/utils'
import { DropdownMenuItem } from './dropdown-menu'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuGroup = ContextMenuPrimitive.Group

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="context-menu-positioner isolate z-50 outline-none"
        collisionPadding={8}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            'context-menu-content z-50 max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem(props: ComponentProps<typeof DropdownMenuItem>) {
  return <DropdownMenuItem data-slot="context-menu-item" {...props} />
}

export { ContextMenu, ContextMenuTrigger, ContextMenuGroup, ContextMenuContent, ContextMenuItem }
