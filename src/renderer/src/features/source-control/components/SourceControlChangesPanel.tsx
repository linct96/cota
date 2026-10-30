import { useSourceControl } from '@/state/source-control-store'
import { Separator } from '@/components/ui/separator'
import type { SourceControlChangesPanelProps } from './source-control-changes-types'
import { SourceControlFileGroups } from './SourceControlFileGroups'
import { SourceControlNetworkActions } from './SourceControlNetworkActions'
import { SourceControlCommitForm } from './SourceControlCommitForm'

export function SourceControlChangesPanel(props: SourceControlChangesPanelProps) {
  const status = useSourceControl((state) => state.sessions[props.workspace.id]?.status)
  const { references } = props
  const selectedRemote =
    references?.remotes.find((entry) => entry === status?.tracking?.remote) ||
    references?.remotes.find((entry) => entry === 'origin') ||
    references?.remotes[0] ||
    ''
  return (
    <>
      <SourceControlFileGroups
        workspace={props.workspace}
        pending={props.pending}
        mutate={props.mutate}
      />
      <SourceControlNetworkActions
        workspace={props.workspace}
        pending={props.pending}
        syncing={props.syncing}
        references={references}
        mutate={props.mutate}
        selectedRemote={selectedRemote}
      />
      <Separator className="source-control-commit-separator" />
      <SourceControlCommitForm
        workspace={props.workspace}
        pending={props.pending}
        generation={props.generation}
        writing={props.writing}
        mutate={props.mutate}
        onError={props.onError}
        selectedRemote={selectedRemote}
      />
    </>
  )
}
