import { useMemo, useState, type ComponentProps } from 'react'
import { GitPullRequest } from 'lucide-react'
import { type ProjectWorkspace } from '../../../../../shared/contracts'
import { useSourceControl } from '@/state/source-control-store'
import { Button } from '@/components/ui/button'
import { CreateHostedReviewDialog } from './CreateHostedReviewDialog'

export function HostedReviewCreateButton({
  workspace,
  pending,
  defaults,
}: {
  workspace: ProjectWorkspace
  pending: boolean
  defaults?: ComponentProps<typeof CreateHostedReviewDialog>['defaults']
}) {
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const [open, setOpen] = useState(false)
  const provider = useSourceControl(
    (state) => state.sessions[workspace.id]?.hosting?.context?.source?.provider,
  )
  const label = provider ? (provider === 'gitlab' ? 'MR' : 'PR') : 'PR/MR'

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="source-control-comparison-create-review ml-auto"
        disabled={pending}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <GitPullRequest
          className="source-control-comparison-create-review-icon"
          data-icon="inline-start"
          aria-hidden="true"
        />
        创建 {label}
      </Button>
      {open && (
        <CreateHostedReviewDialog
          target={target}
          open
          defaults={defaults}
          onOpenChange={setOpen}
          onCreated={() => setOpen(false)}
        />
      )}
    </>
  )
}
