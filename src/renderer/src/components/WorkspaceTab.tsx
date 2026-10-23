import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

interface WorkspaceTabProps extends ComponentProps<'div'> {
  label: string
  icon: ReactNode
  active: boolean
  width?: CSSProperties['width']
  closeDisabled?: boolean
  closeLabel?: string
  onSelect: () => void
  onClose: () => void
}

export function WorkspaceTab({
  label,
  icon,
  active,
  width,
  closeDisabled = false,
  closeLabel = `关闭 ${label}`,
  onSelect,
  onClose,
  className,
  style,
  ...props
}: WorkspaceTabProps) {
  const titleRef = useRef<HTMLSpanElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [needsOverlay, setNeedsOverlay] = useState(false)
  const [measuredWidth, setMeasuredWidth] = useState(160)
  const tabWidth = typeof width === 'number' ? width : measuredWidth
  const overlayClose = width === undefined && needsOverlay

  useLayoutEffect(() => {
    const title = titleRef.current
    const icon = iconRef.current
    const close = closeRef.current
    const tab = title?.parentElement
    if (typeof width === 'number' || !title || !icon || !close || !tab) return

    let frame = 0
    const measure = () => {
      const actualWidth = tab.clientWidth
      if (!actualWidth) return
      setMeasuredWidth(actualWidth)
      if (width !== undefined) return
      const styles = getComputedStyle(tab)
      // Use the full inline layout, regardless of the current close-button position.
      const inlineWidth =
        title.scrollWidth +
        icon.offsetWidth +
        close.offsetWidth +
        Number.parseFloat(styles.paddingLeft) +
        Number.parseFloat(styles.paddingRight) +
        Number.parseFloat(styles.columnGap) * 2
      setNeedsOverlay(inlineWidth > Number.parseFloat(styles.maxWidth))
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(tab)
    if (width === undefined) for (const element of [title, icon, close]) observer.observe(element)
    document.fonts.addEventListener('loadingdone', schedule)
    measure()
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', schedule)
      cancelAnimationFrame(frame)
    }
  }, [label, width])

  return (
    <div
      {...props}
      role="tab"
      aria-selected={active}
      data-width-range={tabWidth <= 80 ? 'short' : tabWidth <= 128 ? 'medium' : 'wide'}
      tabIndex={active ? 0 : -1}
      onClick={(event) => {
        if (!event.defaultPrevented) onSelect()
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && !closeDisabled) {
          event.preventDefault()
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || (event.key === ' ' && !event.shiftKey))
        ) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'workspace-tab group/workspace-tab relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs/relaxed font-medium transition-colors select-none outline-none motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
        width === undefined ? 'w-auto max-w-40' : 'max-w-none',
        active && 'shadow-xs',
        className,
      )}
      style={{ width, ...style }}
    >
      <span ref={iconRef} className="workspace-tab-icon inline-flex shrink-0">
        {icon}
      </span>
      <span ref={titleRef} className="workspace-tab-title min-w-0 flex-1 truncate">
        {label}
      </span>
      <span
        className={cn(
          'workspace-tab-actions pointer-events-none flex items-center justify-end opacity-0 transition-opacity group-focus-visible/workspace-tab:opacity-100 group-hover/workspace-tab:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none',
          overlayClose
            ? 'workspace-tab-actions-overlay absolute inset-y-0 right-0 w-12 max-w-[calc(100%-1.5rem)] rounded-r-md pr-2.5'
            : 'relative size-4 shrink-0',
        )}
      >
        <button
          ref={closeRef}
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          disabled={closeDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="workspace-tab-close-button pointer-events-none relative inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-muted-foreground/80 transition-colors group-focus-visible/workspace-tab:pointer-events-auto group-hover/workspace-tab:pointer-events-auto focus-visible:pointer-events-auto hover:bg-foreground/10 hover:text-foreground active:scale-90 focus-visible:outline-none disabled:pointer-events-none [&:disabled>svg]:opacity-30"
        >
          <X className="workspace-tab-close-icon size-3" />
        </button>
      </span>
    </div>
  )
}
