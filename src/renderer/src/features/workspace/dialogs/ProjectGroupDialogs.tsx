import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, RefObject } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { projectGroupNameSchema } from '../../../../../shared/project-groups'
import type { ProjectGroup } from '../../../../../shared/project-groups'
import { useWorkspace } from '@/state/workspace'
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type ProjectGroupNameTarget = { id?: string; name: string; projectPath?: string }
const nameFormSchema = z.object({ name: projectGroupNameSchema })
type DialogState = Pick<ComponentProps<typeof Dialog>, 'open' | 'onOpenChangeComplete'>

function restoreGroupFocus(trigger: RefObject<HTMLElement | null>, projectPath?: string) {
  if (projectPath) {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-project-path="${CSS.escape(projectPath)}"] .project-folder-trigger`,
    )
    if (button) return button
  }
  return trigger.current?.isConnected
    ? trigger.current
    : document.querySelector<HTMLButtonElement>('.project-create-group-button')
}

export function ProjectGroupNameDialog({
  target,
  dialog,
  trigger,
  onClose,
}: {
  target: ProjectGroupNameTarget | undefined
  dialog: DialogState
  trigger: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const changeGrouping = useWorkspace((state) => state.changeProjectGrouping)
  const [saveError, setSaveError] = useState<string>()
  const input = useRef<HTMLInputElement | null>(null)
  const form = useForm({
    defaultValues: { name: '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: nameFormSchema },
    onSubmit: async ({ value }) => {
      if (!dialog.open || !target) return
      setSaveError(undefined)
      try {
        const name = value.name.trim()
        await changeGrouping(
          target.id
            ? { type: 'rename', id: target.id, name }
            : {
                type: 'create',
                name,
                ...(target.projectPath ? { projectPath: target.projectPath } : {}),
              },
        )
        onClose()
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error))
      }
    },
  })
  useLayoutEffect(() => {
    if (!dialog.open || !target) return
    form.reset({ name: target.name })
    // oxlint-disable-next-line react/set-state-in-effect
    setSaveError(undefined)
  }, [dialog.open, target, form])
  return (
    <Dialog
      {...dialog}
      onOpenChange={(open, details) => {
        if (form.state.isSubmitting) {
          details.cancel()
          return
        }
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="project-group-name-dialog"
        showCloseButton={false}
        initialFocus={() => {
          input.current?.select()
          return input.current
        }}
        finalFocus={() => restoreGroupFocus(trigger, target?.projectPath)}
      >
        <DialogHeader className="project-group-name-header">
          <DialogTitle className="project-group-name-title">
            {target?.id ? '重命名分组' : '新建分组'}
          </DialogTitle>
        </DialogHeader>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <form
              className="project-group-name-form flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
              }}
            >
              <FieldGroup className="project-group-name-fields">
                <form.Field name="name">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field className="project-group-name-field" data-invalid={invalid}>
                        <FieldLabel
                          className="project-group-name-label"
                          htmlFor="project-group-name"
                        >
                          名称
                        </FieldLabel>
                        <Input
                          className="project-group-name-input"
                          ref={input}
                          id="project-group-name"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? 'project-group-name-error' : undefined}
                          maxLength={80}
                          autoComplete="off"
                          disabled={submitting}
                        />
                        {invalid && (
                          <FieldError
                            className="project-group-name-field-error"
                            id="project-group-name-error"
                            errors={field.state.meta.errors}
                          />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
              {saveError && (
                <p className="project-group-name-save-error text-destructive" role="alert">
                  {saveError}
                </p>
              )}
              <DialogFooter className="project-group-name-footer">
                <DialogClose
                  render={<Button variant="outline" />}
                  className="project-group-name-cancel"
                  disabled={submitting}
                >
                  取消
                </DialogClose>
                <Button className="project-group-name-submit" type="submit" disabled={submitting}>
                  {target?.id ? '保存' : '创建分组'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </form.Subscribe>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectGroupRemovalDialog({
  target,
  dialog,
  trigger,
  onClose,
}: {
  target: ProjectGroup | undefined
  dialog: DialogState
  trigger: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const changeGrouping = useWorkspace((state) => state.changeProjectGrouping)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const saving = useRef(false)
  const cancel = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    if (!dialog.open) return
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
  }, [dialog.open])
  return (
    <AlertDialog
      {...dialog}
      onOpenChange={(open, details) => {
        if (saving.current) {
          details.cancel()
          return
        }
        if (!open) onClose()
      }}
    >
      <AlertDialogContent
        className="project-group-removal-dialog"
        initialFocus={cancel}
        finalFocus={() => restoreGroupFocus(trigger)}
      >
        <AlertDialogHeader className="project-group-removal-header">
          <AlertDialogTitle className="project-group-removal-title">删除分组？</AlertDialogTitle>
          <AlertDialogDescription className="project-group-removal-description">
            仅删除分组，组内项目将移至未分组，不会关闭工作区或终端。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="project-group-removal-name break-all">{target?.name}</p>
        {error && (
          <p className="project-group-removal-error text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter className="project-group-removal-footer">
          <AlertDialogCancel
            ref={cancel}
            className="project-group-removal-cancel"
            disabled={pending}
          >
            取消
          </AlertDialogCancel>
          <Button
            className="project-group-removal-submit"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!dialog.open || !target || saving.current) return
              saving.current = true
              setPending(true)
              setError(undefined)
              try {
                await changeGrouping({ type: 'remove', id: target.id })
                onClose()
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
              } finally {
                saving.current = false
                setPending(false)
              }
            }}
          >
            删除分组
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
