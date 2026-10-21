import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { gitChangeRows, type GitChangeNode } from '../lib/source-control-tree'
import { Button } from './ui/button'

type SourceFileExplorerItemProps = Pick<
  ComponentProps<typeof Button>,
  | 'role'
  | 'aria-level'
  | 'aria-posinset'
  | 'aria-setsize'
  | 'aria-selected'
  | 'tabIndex'
  | 'onFocus'
  | 'style'
> & { 'data-tree-key': string }

export function SourceFileExplorer<T extends { path: string }>({
  nodes,
  label,
  selectedPath,
  renderFile,
  renderDirectoryActions,
}: {
  nodes: GitChangeNode<T>[]
  label: string
  selectedPath?: string
  renderFile: (entry: T, name: string, itemProps: SourceFileExplorerItemProps) => ReactNode
  renderDirectoryActions?: (entries: T[], path: string) => ReactNode
}) {
  const tree = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [focusedKey, setFocusedKey] = useState<string>()
  const rows = gitChangeRows(nodes, collapsed)
  const focusKey = rows.some((row) => row.key === focusedKey)
    ? focusedKey
    : rows.find(({ node }) => node.kind === 'file' && node.path === selectedPath)?.key ||
      rows[0]?.key

  function focus(key?: string) {
    Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [])
      .find((element) => element.dataset.treeKey === key)
      ?.focus()
  }
  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  useLayoutEffect(() => {
    // 暂存等操作可能移除聚焦行，只在焦点因此落回页面时恢复到树内。
    if (hadFocus.current && document.activeElement === document.body) focus(focusKey)
  })

  return (
    <div
      ref={tree}
      role="tree"
      tabIndex={-1}
      aria-label={label}
      className="source-file-explorer flex min-w-0 flex-col gap-0.5"
      onFocusCapture={() => {
        hadFocus.current = true
      }}
      onBlurCapture={(event) => {
        hadFocus.current =
          !!event.relatedTarget && event.currentTarget.contains(event.relatedTarget)
      }}
      onKeyDown={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
        if (!element || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const index = rows.findIndex((row) => row.key === element.dataset.treeKey)
        const row = rows[index]
        if (!row) return
        switch (event.key) {
          case 'ArrowDown':
            focus(rows[Math.min(index + 1, rows.length - 1)]?.key)
            break
          case 'ArrowUp':
            focus(rows[Math.max(0, index - 1)]?.key)
            break
          case 'Home':
            focus(rows[0]?.key)
            break
          case 'End':
            focus(rows.at(-1)?.key)
            break
          case 'ArrowRight':
            if (row.node.kind !== 'directory') return
            if (collapsed.has(row.node.path)) toggle(row.node.path)
            else if (rows[index + 1]?.parent === row.key) focus(rows[index + 1].key)
            break
          case 'ArrowLeft':
            if (row.node.kind === 'directory' && !collapsed.has(row.node.path))
              toggle(row.node.path)
            else focus(row.parent)
            break
          default:
            return
        }
        event.preventDefault()
      }}
    >
      {rows.map(({ key, node, depth, position, siblings }) => {
        const itemProps: SourceFileExplorerItemProps = {
          role: 'treeitem',
          'aria-level': depth + 1,
          'aria-posinset': position,
          'aria-setsize': siblings,
          'aria-selected': node.kind === 'file' && selectedPath === node.path,
          'data-tree-key': key,
          tabIndex: focusKey === key ? 0 : -1,
          onFocus: () => setFocusedKey(key),
          style: { paddingLeft: 6 + depth * 12 },
        }
        const expanded = node.kind === 'directory' && !collapsed.has(node.path)
        return (
          <div key={key} role="none" className="source-file-explorer-entry min-w-0">
            {node.kind === 'file' ? (
              renderFile(node.entry, node.name, itemProps)
            ) : (
              <div className="source-control-directory-row flex min-w-0 items-center gap-1 pr-1">
                <Button
                  {...itemProps}
                  variant="project"
                  aria-expanded={expanded}
                  className="source-file-explorer-item min-w-0 flex-1 justify-start gap-1.5"
                  title={node.path}
                  aria-label={node.path}
                  onClick={() => toggle(node.path)}
                >
                  <ChevronRight
                    className="source-file-explorer-chevron"
                    data-expanded={expanded}
                    aria-hidden="true"
                  />
                  {expanded ? (
                    <FolderOpen className="source-file-explorer-folder-icon" aria-hidden="true" />
                  ) : (
                    <Folder className="source-file-explorer-folder-icon" aria-hidden="true" />
                  )}
                  <span className="source-file-explorer-name min-w-0 truncate">{node.name}</span>
                </Button>
                {renderDirectoryActions && (
                  <div className="source-control-directory-actions flex shrink-0 items-center gap-0.5">
                    {renderDirectoryActions(node.entries, node.path)}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
