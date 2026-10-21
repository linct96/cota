import { Fragment, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { GitChangeNode } from '../lib/source-control-tree'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export function SourceControlFileTree<T extends { path: string }>({
  nodes,
  renderFile,
  renderDirectoryActions,
}: {
  nodes: GitChangeNode<T>[]
  renderFile: (entry: T, name: string) => ReactNode
  renderDirectoryActions?: (entries: T[], path: string) => ReactNode
}): ReactNode {
  return nodes.map((node) =>
    node.kind === 'file' ? (
      <Fragment key={node.path}>{renderFile(node.entry, node.name)}</Fragment>
    ) : (
      <Collapsible
        key={`directory:${node.path}`}
        defaultOpen
        className="source-control-directory min-w-0"
      >
        <div className="source-control-directory-row flex min-w-0 items-center gap-1 pr-1">
          <CollapsibleTrigger
            render={<Button variant="project" />}
            className="source-control-directory-trigger group/source-control-directory min-w-0 flex-1 justify-start gap-1.5"
            title={node.path}
            aria-label={node.path}
          >
            <ChevronRight
              className="source-control-directory-chevron group-aria-expanded/source-control-directory:rotate-90"
              aria-hidden="true"
            />
            <Folder className="source-control-directory-icon" aria-hidden="true" />
            <FolderOpen className="source-control-directory-open-icon" aria-hidden="true" />
            <span className="source-control-directory-name min-w-0 truncate">{node.name}</span>
          </CollapsibleTrigger>
          {renderDirectoryActions && (
            <div className="source-control-directory-actions flex shrink-0 items-center gap-0.5">
              {renderDirectoryActions(node.entries, node.path)}
            </div>
          )}
        </div>
        <CollapsibleContent className="source-control-directory-children flex min-w-0 flex-col gap-0.5 pl-3">
          <SourceControlFileTree
            nodes={node.children}
            renderFile={renderFile}
            renderDirectoryActions={renderDirectoryActions}
          />
        </CollapsibleContent>
      </Collapsible>
    ),
  )
}
