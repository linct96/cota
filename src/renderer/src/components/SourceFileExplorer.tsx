import type { ComponentProps, ReactNode } from 'react'
import type { GitChangeNode } from '../lib/source-control-tree'
import { FileTypeIcon } from './FileTypeIcon'
import { Button } from './ui/button'
import { FileTree, FileTreeActions, FileTreeFolder } from './ui/file-tree'

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
  function renderNodes(children: GitChangeNode<T>[], depth = 0): ReactNode {
    return children.map((node, index) => {
      const key = `${node.kind}:${node.path}`
      const itemProps: SourceFileExplorerItemProps = {
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-posinset': index + 1,
        'aria-setsize': children.length,
        'aria-selected': node.kind === 'file' && selectedPath === node.path,
        'data-tree-key': key,
        style: { paddingLeft: 6 + depth * 12 },
      }
      return node.kind === 'file' ? (
        <div key={key} role="none" className="source-file-explorer-entry min-w-0">
          {renderFile(node.entry, node.name, itemProps)}
        </div>
      ) : (
        <FileTreeFolder
          key={key}
          {...itemProps}
          path={node.path}
          name={node.name}
          icon={(open) => <FileTypeIcon path={node.path} directory open={open} />}
          defaultOpen
          className="source-file-explorer-item gap-1.5"
          rowClassName="source-control-directory-row pr-1"
          title={node.path}
          aria-label={node.path}
          actions={
            renderDirectoryActions && (
              <FileTreeActions className="source-control-directory-actions">
                {renderDirectoryActions(node.entries, node.path)}
              </FileTreeActions>
            )
          }
        >
          {renderNodes(node.children, depth + 1)}
        </FileTreeFolder>
      )
    })
  }

  return (
    <FileTree
      aria-label={label}
      selectedPath={selectedPath ?? null}
      className="source-file-explorer"
    >
      {renderNodes(nodes)}
    </FileTree>
  )
}
