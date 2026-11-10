import { useShallow } from 'zustand/react/shallow'
import { useRef } from 'react'
import { useWorkspace } from '@/state/workspace'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ComponentProps, RefObject } from 'react'
import { folderName } from '@/lib/utils'

export interface WorkspaceRemovalTarget {
  projectPath: string
  workspace?: ProjectWorkspace
}

export function WorkspaceRemovalDialog({
  target: removal,
  dialog: removalDialog,
  trigger: menuTrigger,
  onClose,
}: {
  target: WorkspaceRemovalTarget | undefined
  dialog: Pick<ComponentProps<typeof AlertDialog>, 'open' | 'onOpenChangeComplete'>
  trigger: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const state = useWorkspace(
    useShallow((currentState) => ({
      removingWorkspace: currentState.removingWorkspace,
      removeProject: currentState.removeProject,
      removeWorkspace: currentState.removeWorkspace,
    })),
  )
  const cancelWorkspaceRemoval = useRef<HTMLButtonElement | null>(null)
  const projectToRemove = removal && !removal.workspace ? removal.projectPath : undefined
  const workspaceToRemove = removal?.workspace?.id
  const pendingWorkspace = removal?.workspace
  return (
    <AlertDialog
      {...removalDialog}
      onOpenChange={(open, details) => {
        if (state.removingWorkspace) {
          details.cancel()
          return
        }
        if (!open) {
          onClose()
        }
      }}
    >
      <AlertDialogContent
        className="workspace-removal-dialog"
        initialFocus={cancelWorkspaceRemoval}
        finalFocus={() =>
          menuTrigger.current?.isConnected
            ? menuTrigger.current
            : document.querySelector<HTMLButtonElement>('.project-add-button')
        }
      >
        <AlertDialogHeader className="workspace-removal-header">
          <AlertDialogTitle className="workspace-removal-title">
            {projectToRemove ? '删除项目？' : '删除工作区？'}
          </AlertDialogTitle>
          <AlertDialogDescription className="workspace-removal-description">
            {projectToRemove
              ? '将删除该项目的所有工作区并结束其中的终端和程序，终端输出不保留。不会删除本地文件。'
              : '将结束该工作区的所有终端和程序，终端输出不保留。不影响其他工作区或本地文件。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="workspace-removal-name min-w-0 text-xs break-all text-app-muted-foreground">
          {projectToRemove ||
            (pendingWorkspace &&
              `${folderName(pendingWorkspace.projectPath)} / ${pendingWorkspace.name}`)}
        </p>
        <AlertDialogFooter className="workspace-removal-footer">
          <AlertDialogCancel
            ref={cancelWorkspaceRemoval}
            className="workspace-removal-cancel"
            disabled={!!state.removingWorkspace}
          >
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="workspace-removal-confirm"
            disabled={!!state.removingWorkspace}
            onClick={async () => {
              if (!removalDialog.open || state.removingWorkspace) return
              if (projectToRemove) await state.removeProject(projectToRemove)
              else if (workspaceToRemove) await state.removeWorkspace(workspaceToRemove)
              onClose()
            }}
          >
            {projectToRemove ? '删除项目' : '删除工作区'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
