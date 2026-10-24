import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ChevronRight, FileIcon, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

type Expanded = Readonly<Record<string, boolean>>
type TreeState = {
  expanded: Expanded
  selectedPath?: string | null
  expand: (path: string, open: boolean) => void
  select: (path: string) => void
}
const TreeContext = createContext<TreeState | null>(null)
const LevelContext = createContext({ depth: 0, parent: '' })

function useTree() {
  const tree = useContext(TreeContext)
  if (!tree) throw new Error('File tree items must be rendered inside FileTree')
  return tree
}

function FileTree({
  expanded,
  defaultExpanded = {},
  onExpandedChange,
  selectedPath,
  defaultSelectedPath,
  onSelect,
  className,
  children,
  onKeyDown,
  onFocusCapture,
  onBlurCapture,
  ...props
}: Omit<ComponentProps<'div'>, 'onSelect'> & {
  expanded?: Expanded
  defaultExpanded?: Expanded
  onExpandedChange?: (expanded: Expanded) => void
  selectedPath?: string | null
  defaultSelectedPath?: string
  onSelect?: (path: string) => void
}) {
  const [internalExpanded, setExpanded] = useState(defaultExpanded)
  const [internalSelected, setSelected] = useState(defaultSelectedPath)
  const element = useRef<HTMLDivElement>(null)
  const focused = useRef<HTMLElement | null>(null)
  const hadFocus = useRef(false)
  const state: TreeState = {
    expanded: expanded ?? internalExpanded,
    selectedPath: selectedPath === undefined ? internalSelected : selectedPath,
    expand(path, open) {
      const next = { ...state.expanded, [path]: open }
      if (expanded === undefined) setExpanded(next)
      onExpandedChange?.(next)
    },
    select(path) {
      if (selectedPath === undefined) setSelected(path)
      onSelect?.(path)
    },
  }
  function items() {
    return Array.from(
      element.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [],
    ).filter(
      (item) =>
        !item.closest('[hidden]') &&
        item.getAttribute('aria-disabled') !== 'true' &&
        !item.hasAttribute('disabled'),
    )
  }
  function updateTabStop(previous: HTMLElement | null) {
    const rows = items()
    const target =
      rows.find((item) => item === previous) ||
      rows.find((item) => item.getAttribute('aria-selected') === 'true') ||
      rows[0]
    for (const item of rows) item.tabIndex = item === target ? 0 : -1
    return target
  }
  useLayoutEffect(() => {
    const target = updateTabStop(focused.current)
    // 暂存或外部折叠可能移除聚焦行，只在焦点因此丢失时恢复。
    if (hadFocus.current && document.activeElement === document.body) target?.focus()
  })

  return (
    <TreeContext.Provider value={state}>
      <div
        {...props}
        ref={element}
        role="tree"
        tabIndex={-1}
        className={cn('file-tree flex min-w-0 flex-col gap-0.5', className)}
        onFocusCapture={(event) => {
          hadFocus.current = true
          const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
          if (item) {
            focused.current = item
            updateTabStop(item)
          }
          onFocusCapture?.(event)
        }}
        onBlurCapture={(event) => {
          hadFocus.current =
            !!event.relatedTarget && event.currentTarget.contains(event.relatedTarget)
          onBlurCapture?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return
          const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
          if (!item) return
          const rows = items()
          const index = rows.indexOf(item)
          if (index < 0) return
          const parentOf = (row: HTMLElement) =>
            row.dataset.fileTreeParent ||
            rows.find(
              (candidate) =>
                candidate.getAttribute('aria-controls') === row.closest('[role="group"]')?.id,
            )?.id
          switch (event.key) {
            case 'ArrowDown':
              rows[Math.min(index + 1, rows.length - 1)]?.focus()
              break
            case 'ArrowUp':
              rows[Math.max(0, index - 1)]?.focus()
              break
            case 'Home':
              rows[0]?.focus()
              break
            case 'End':
              rows.at(-1)?.focus()
              break
            case 'ArrowRight':
              if (!item.hasAttribute('aria-expanded')) return
              if (item.getAttribute('aria-expanded') === 'false') item.click()
              else if (rows[index + 1] && parentOf(rows[index + 1]) === item.id)
                rows[index + 1].focus()
              break
            case 'ArrowLeft':
              if (item.getAttribute('aria-expanded') === 'true') item.click()
              else rows.find((row) => row.id === parentOf(item))?.focus()
              break
            default:
              return
          }
          event.preventDefault()
        }}
      >
        {children}
      </div>
    </TreeContext.Provider>
  )
}

type ItemProps = Omit<ComponentProps<typeof Button>, 'onSelect' | 'variant' | 'size'> & {
  path: string
}

function FileTreeFolder({
  path,
  name,
  defaultOpen = false,
  icon,
  actions,
  rowClassName,
  render,
  className,
  children,
  id: providedId,
  style,
  ...props
}: ItemProps & {
  name: string
  defaultOpen?: boolean
  icon?: ReactNode | ((open: boolean) => ReactNode)
  actions?: ReactNode
  rowClassName?: string
}) {
  const tree = useTree()
  const { depth, parent } = useContext(LevelContext)
  const generatedId = useId()
  const id = providedId ?? generatedId
  const contentId = `${id}-children`
  const open = tree.expanded[path] ?? defaultOpen
  return (
    <Collapsible
      className="file-tree-folder min-w-0"
      role="none"
      open={open}
      onOpenChange={(next) => tree.expand(path, next)}
    >
      <div
        role="none"
        className={cn('file-tree-folder-row flex min-w-0 items-center gap-1', rowClassName)}
      >
        <CollapsibleTrigger
          {...props}
          id={id}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={tree.selectedPath === path}
          aria-owns={open ? contentId : undefined}
          data-file-tree-item="folder"
          data-file-tree-parent={parent}
          data-path={path}
          tabIndex={-1}
          className={cn(
            'file-tree-folder-trigger w-full min-w-0 flex-1 justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50',
            className,
          )}
          style={{ paddingLeft: 6 + depth * 12, ...style }}
          render={<Button variant="ghost" size="sm" render={render} />}
        >
          <ChevronRight
            className="file-tree-chevron transition-transform group-data-panel-open/button:rotate-90"
            aria-hidden="true"
          />
          <FileTreeIcon>
            {(typeof icon === 'function' ? icon(open) : icon) ??
              (open ? <FolderOpen /> : <Folder />)}
          </FileTreeIcon>
          <FileTreeName>{name}</FileTreeName>
        </CollapsibleTrigger>
        {actions}
      </div>
      {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- ARIA 树的子节点须使用 group 而非表单元素。 */}
      <CollapsibleContent
        id={contentId}
        role="group"
        className="file-tree-folder-content flex min-w-0 flex-col gap-0.5"
      >
        <LevelContext.Provider value={{ depth: depth + 1, parent: id }}>
          {children}
        </LevelContext.Provider>
      </CollapsibleContent>
      {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
    </Collapsible>
  )
}

function FileTreeFile({
  path,
  onSelect,
  onClick,
  className,
  children,
  id: providedId,
  style,
  ...props
}: ItemProps & { onSelect?: (path: string) => void }) {
  const tree = useTree()
  const { depth, parent } = useContext(LevelContext)
  const generatedId = useId()
  const content: ReactNode[] = []
  const actions: ReactNode[] = []
  Children.toArray(children).forEach((child) => {
    if (isValidElement(child) && child.type === FileTreeActions) actions.push(child)
    else content.push(child)
  })
  const button = (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      id={providedId ?? generatedId}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={tree.selectedPath === path}
      data-file-tree-item="file"
      data-file-tree-parent={parent}
      data-path={path}
      tabIndex={-1}
      className={cn(
        'file-tree-file min-w-0 justify-start aria-selected:bg-accent aria-selected:text-accent-foreground',
        actions.length ? 'flex-1' : 'w-full',
        className,
      )}
      style={{ paddingLeft: 6 + depth * 12, ...style }}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        tree.select(path)
        onSelect?.(path)
      }}
    >
      {content}
    </Button>
  )
  return actions.length ? (
    <div role="none" className="file-tree-file-row flex min-w-0 items-center gap-1">
      {button}
      {actions}
    </div>
  ) : (
    button
  )
}

function FileTreeIcon({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn('file-tree-icon inline-flex shrink-0', className)}
    >
      {children ?? <FileIcon />}
    </span>
  )
}

function FileTreeName({ className, ...props }: ComponentProps<'span'>) {
  return <span {...props} className={cn('file-tree-name min-w-0 truncate pe-0.5', className)} />
}

function FileTreeActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('file-tree-actions flex shrink-0 items-center gap-0.5', className)}
    />
  )
}

export { FileTree, FileTreeFolder, FileTreeFile, FileTreeIcon, FileTreeName, FileTreeActions }
