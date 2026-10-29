import type { ProjectWorkspace } from '../../../shared/contracts'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { CommitHistoryContent } from './SourceControlReview'

export function SourceControlHistoryPanel({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const head = useSourceControl(
    (state) => (state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL).status?.head,
  )
  return (
    <section
      className="source-control-history-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="提交历史"
    >
      <CommitHistoryContent workspace={workspace} active={active} head={head} />
    </section>
  )
}
