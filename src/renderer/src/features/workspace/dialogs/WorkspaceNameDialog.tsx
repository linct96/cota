import { useShallow } from 'zustand/react/shallow'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, RefObject } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { workspaceFormSchema } from '@/features/workspace/dialogs/schemas'
import { useWorkspace } from '@/state/workspace'
import { unwrap } from '../../../../../shared/contracts'
import type { WorktreeRecord, WorktreeState } from '../../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { abbreviateHomePath } from '@/lib/utils'

export interface WorkspaceNameTarget {
  projectPath: string
  name: string
  id?: string
  worktree?: WorktreeRecord
  scan?: WorktreeState
}

export function WorkspaceNameDialog({
  target: workspaceDialog,
  dialog: workspaceNameDialog,
  trigger: workspaceDialogTrigger,
  onClose,
  onCreated,
}: {
  target: WorkspaceNameTarget | undefined
  dialog: Pick<ComponentProps<typeof Dialog>, 'open' | 'onOpenChangeComplete'>
  trigger: RefObject<HTMLElement | null>
  onClose: () => void
  onCreated: (projectPath: string) => void
}) {
  const state = useWorkspace(
    useShallow((currentState) => ({
      removingWorkspace: currentState.removingWorkspace,
      renameWorkspace: currentState.renameWorkspace,
      newWorkspace: currentState.newWorkspace,
      worktreeScans: currentState.worktreeScans,
      creatingWorktree: currentState.creatingWorktree,
      removeWorktree: currentState.removeWorktree,
      worktreeError: currentState.worktreeError,
      orphanSessions: currentState.orphanSessions,
    })),
  )
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string>()
  const workspaceSavePending = useRef(false)
  const workspaceNameInput = useRef<HTMLInputElement | null>(null)
  const [checkingWorktree, setCheckingWorktree] = useState(false)
  const workspaceForm = useForm({
    defaultValues: { name: workspaceDialog?.name || '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: workspaceFormSchema },
    onSubmit: async ({ value }) => {
      if (
        !workspaceNameDialog.open ||
        !workspaceDialog ||
        workspaceSavePending.current ||
        state.removingWorkspace
      )
        return
      workspaceSavePending.current = true
      setSavingWorkspace(true)
      setWorkspaceSaveError(undefined)
      try {
        const name = value.name.trim()
        const saved = workspaceDialog.id
          ? state.renameWorkspace(workspaceDialog.id, name)
          : await state.newWorkspace(workspaceDialog.projectPath, name)
        if (saved) {
          if (!workspaceDialog.id) onCreated(workspaceDialog.projectPath)
          onClose()
        } else setWorkspaceSaveError('无法保存工作区，请检查名称或稍后重试。')
      } catch (cause) {
        setWorkspaceSaveError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        workspaceSavePending.current = false
        setSavingWorkspace(false)
      }
    },
  })
  const editingRecord = workspaceDialog?.worktree
  const editingScan =
    (editingRecord &&
      state.worktreeScans[editingRecord.projectPath]?.entries.find(
        (entry) => entry.record.id === editingRecord.id,
      )) ||
    workspaceDialog?.scan

  useEffect(() => {
    if (!editingRecord) return
    let disposed = false
    // Worktree checks are external requests; lock the dialog while refreshing their snapshot.
    // oxlint-disable-next-line react/set-state-in-effect
    setCheckingWorktree(true)
    setWorkspaceSaveError(undefined)
    useWorkspace.setState({ worktreeError: undefined })
    void useWorkspace
      .getState()
      .refreshWorktrees(editingRecord.projectPath)
      .catch((error) => {
        if (!disposed) setWorkspaceSaveError(error.message)
      })
      .finally(() => {
        if (!disposed) setCheckingWorktree(false)
      })
    return () => {
      disposed = true
    }
  }, [editingRecord])

  useLayoutEffect(() => {
    if (!workspaceDialog) return
    workspaceForm.reset({ name: workspaceDialog.name }, { keepDefaultValues: true })
    // Reset errors with each new dialog target, before autofocus.
    // oxlint-disable-next-line react/set-state-in-effect
    setWorkspaceSaveError(undefined)
  }, [workspaceDialog, workspaceForm])
  return (
    <Dialog
      {...workspaceNameDialog}
      onOpenChange={(open, details) => {
        if (workspaceSavePending.current) {
          details.cancel()
          return
        }
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="workspace-name-dialog max-h-[80vh] overflow-y-auto"
        showCloseButton={false}
        initialFocus={() => {
          workspaceNameInput.current?.select()
          return workspaceNameInput.current
        }}
        finalFocus={workspaceDialogTrigger}
      >
        <form
          className="workspace-name-form flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void workspaceForm.handleSubmit()
          }}
        >
          <DialogHeader className="workspace-name-header">
            <DialogTitle className="workspace-name-title">
              {workspaceDialog?.id ? '编辑工作区' : '新建工作区'}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup className="workspace-name-fields">
            <workspaceForm.Field name="name">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="workspace-name-field"
                    data-invalid={invalid}
                    data-disabled={savingWorkspace}
                  >
                    <FieldLabel className="workspace-name-label" htmlFor="workspace-name">
                      工作区名称
                    </FieldLabel>
                    <Input
                      ref={workspaceNameInput}
                      id="workspace-name"
                      name={field.name}
                      className="workspace-name-input"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      disabled={savingWorkspace}
                      required
                      autoComplete="off"
                      aria-invalid={invalid}
                      aria-describedby={invalid ? 'workspace-name-error' : undefined}
                    />
                    {invalid && (
                      <FieldError id="workspace-name-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </workspaceForm.Field>
          </FieldGroup>
          {editingRecord && (
            <section
              className="workspace-worktree-details flex flex-col gap-2 text-xs"
              aria-label="工作树信息"
            >
              <p className="workspace-worktree-path break-all text-app-muted-foreground">
                {abbreviateHomePath(editingRecord.path)}
              </p>
              {!checkingWorktree && editingScan?.error && (
                <p className="workspace-worktree-scan-error text-destructive" role="alert">
                  {editingScan.error}
                </p>
              )}
              {(editingRecord.origin === 'linked' || editingScan?.status !== 'ready') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="workspace-worktree-unlink self-start"
                  disabled={
                    checkingWorktree ||
                    savingWorkspace ||
                    !!state.removingWorkspace ||
                    state.creatingWorktree
                  }
                  onClick={async () => {
                    if (workspaceSavePending.current) return
                    workspaceSavePending.current = true
                    setSavingWorkspace(true)
                    setWorkspaceSaveError(undefined)
                    try {
                      await state.removeWorktree(editingRecord.id, false, true)
                      if (
                        !useWorkspace
                          .getState()
                          .worktreeRecords.some((entry) => entry.id === editingRecord.id)
                      )
                        onClose()
                    } catch (error) {
                      setWorkspaceSaveError((error as Error).message)
                    } finally {
                      workspaceSavePending.current = false
                      setSavingWorkspace(false)
                    }
                  }}
                >
                  移除关联（保留目录和分支）
                </Button>
              )}
              {state.worktreeError && (
                <p className="workspace-worktree-error text-destructive break-words" role="alert">
                  {state.worktreeError}
                </p>
              )}
            </section>
          )}
          {state.orphanSessions
            .filter((session) => session.projectPath === workspaceDialog?.projectPath)
            .map((session) => (
              <div
                key={session.id}
                className="workspace-orphan-session flex flex-col gap-2 text-xs"
              >
                <p className="workspace-orphan-description text-destructive break-all">
                  终端身份与工作区登记不一致，不会自动连接：{abbreviateHomePath(session.cwd)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="workspace-orphan-close self-start"
                  disabled={savingWorkspace || !!state.removingWorkspace || state.creatingWorktree}
                  onClick={async () => {
                    if (workspaceSavePending.current) return
                    workspaceSavePending.current = true
                    setSavingWorkspace(true)
                    setWorkspaceSaveError(undefined)
                    try {
                      if (unwrap(await window.desktop.closeTerminal(session.id)))
                        useWorkspace.setState((current) => ({
                          orphanSessions: current.orphanSessions.filter(
                            (entry) => entry.id !== session.id,
                          ),
                        }))
                    } catch (error) {
                      setWorkspaceSaveError((error as Error).message)
                    } finally {
                      workspaceSavePending.current = false
                      setSavingWorkspace(false)
                    }
                  }}
                >
                  结束此终端
                </Button>
              </div>
            ))}
          {workspaceSaveError && (
            <p role="alert" className="workspace-name-error text-destructive">
              {workspaceSaveError}
            </p>
          )}
          <DialogFooter className="workspace-name-footer">
            <DialogClose
              render={<Button variant="outline" />}
              className="workspace-name-cancel"
              disabled={savingWorkspace}
            >
              取消
            </DialogClose>
            <Button
              type="submit"
              className="workspace-name-confirm"
              disabled={savingWorkspace || !!state.removingWorkspace}
            >
              {workspaceDialog?.id ? '保存修改' : '创建工作区'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
