import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import { gitFileKey, type GitArea } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { useRightPanel } from '../lib/right-panel-store'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { SourceControlDiff } from './SourceControlDiff'
import { FileTypeIcon } from './FileTypeIcon'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Separator } from './ui/separator'

const areaLabels: Record<GitArea, string> = {
  conflict: '合并冲突',
  staged: '已暂存',
  unstaged: '未暂存',
  untracked: '未跟踪',
}

export function SourceControlChanges({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const panelOpen = useRightPanel((state) => state.open)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string>()
  const target = { projectPath: workspace.projectPath, workspaceId: workspace.id }

  useSourceControlWatch(target, active && !panelOpen, () => setRefresh((value) => value + 1))
  useEffect(() => {
    if (!active || panelOpen) return
    let disposed = false
    window.desktop
      .gitStatus(target)
      .then(unwrap)
      .then((status) => {
        if (disposed) return
        useSourceControl.getState().update(workspace.id, { status, refreshed: Date.now() })
        setError(undefined)
      })
      .catch((error) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [active, panelOpen, refresh, workspace.id, workspace.projectPath])

  const entries = session.status?.entries || []
  return (
    <section
      id={`source-control-panel-${workspace.id}`}
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={`source-control-tab-${workspace.id}`}
      aria-busy={!session.status && !error}
      className="source-control-all-changes flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
    >
      {error && (
        <Alert variant="destructive" className="source-control-all-error m-3 w-auto">
          <AlertDescription className="source-control-all-error-detail whitespace-pre-wrap break-words select-text">
            {error}
          </AlertDescription>
        </Alert>
      )}
      {session.status && !entries.length && (
        <Empty className="source-control-all-empty">
          <EmptyHeader className="source-control-all-empty-header">
            <EmptyTitle className="source-control-all-empty-title">工作区干净</EmptyTitle>
            <EmptyDescription className="source-control-all-empty-description">
              没有未提交的更改。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {entries.map((entry, index) => (
        <Collapsible
          key={gitFileKey(entry)}
          defaultOpen={index === 0}
          className="source-control-all-file flex shrink-0 flex-col"
        >
          <CollapsibleTrigger
            className="source-control-all-file-trigger group/all-file w-full min-w-0 justify-start px-3"
            render={<Button variant="ghost" size="sm" />}
            title={`${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
          >
            <ChevronRight
              className="source-control-all-file-toggle group-aria-expanded/all-file:rotate-90"
              data-icon="inline-start"
            />
            <FileTypeIcon path={entry.path} submodule={entry.submodule} />
            <span className="source-control-all-file-path min-w-0 flex-1 truncate text-left">
              {entry.path}
            </span>
            <span className="source-control-all-file-area shrink-0 text-muted-foreground">
              {areaLabels[entry.area]}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="source-control-all-file-content flex h-96 min-w-0 flex-col">
            <SourceControlDiff workspace={workspace} active={active} selection={entry} />
          </CollapsibleContent>
          <Separator className="source-control-all-file-separator" />
        </Collapsible>
      ))}
    </section>
  )
}
