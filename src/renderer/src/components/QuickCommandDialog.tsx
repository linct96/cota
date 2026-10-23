import { useEffect, useId, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import type { QuickCommand } from '../../../shared/contracts'
import { quickCommandFormSchema } from '../lib/form-schemas'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

export function QuickCommandDialog({
  open,
  onOpenChange,
  command,
  projectPath,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  command?: QuickCommand
  projectPath?: string
}) {
  const id = useId()
  const saving = useRef(false)
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: {
      name: command?.name || '',
      command: command?.command || '',
    },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: quickCommandFormSchema },
    onSubmit: async ({ value }) => {
      if (saving.current) return
      saving.current = true
      setError(undefined)
      try {
        const state = useWorkspace.getState()
        if (command && !state.preferences.quickCommands.some((entry) => entry.id === command.id))
          throw new Error('该命令已被删除，请关闭弹窗后重试。')
        const next: QuickCommand = {
          id: command?.id || crypto.randomUUID(),
          name: value.name.trim(),
          command: value.command.replace(/\r\n?/g, '\n'),
          scope:
            command?.scope || (projectPath ? { type: 'project', projectPath } : { type: 'global' }),
        }
        await state.savePreferences({
          ...state.preferences,
          quickCommands: command
            ? state.preferences.quickCommands.map((entry) => (entry.id === next.id ? next : entry))
            : [...state.preferences.quickCommands, next],
        })
        onOpenChange(false)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        saving.current = false
      }
    },
  })
  const submitting = useStore(form.store, (state) => state.isSubmitting)
  useEffect(() => {
    if (!open) return
    form.reset({
      name: command?.name || '',
      command: command?.command || '',
    })
  }, [open, command, form])

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (form.state.isSubmitting) details.cancel()
        else {
          setError(undefined)
          onOpenChange(next)
        }
      }}
    >
      <DialogContent
        className="quick-command-dialog max-h-[calc(100%-2rem)] overflow-y-auto"
        showCloseButton={false}
        initialFocus={false}
      >
        <DialogHeader className="quick-command-dialog-header">
          <DialogTitle className="quick-command-dialog-title">
            {command ? '编辑快捷命令' : '新增快捷命令'}
          </DialogTitle>
          <DialogDescription className="quick-command-dialog-description">
            新增快捷命令描述占位
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="quick-command-form flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <FieldGroup className="quick-command-fields">
            {(['name', 'command'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  const Control = name === 'command' ? Textarea : Input
                  return (
                    <Field
                      className={`quick-command-${name}-field`}
                      data-invalid={invalid}
                      data-disabled={submitting}
                    >
                      <FieldLabel
                        className={`quick-command-${name}-label`}
                        htmlFor={`${id}-${name}`}
                      >
                        {name === 'name' ? '名称' : 'Shell 命令'}
                      </FieldLabel>
                      <Control
                        id={`${id}-${name}`}
                        name={field.name}
                        className={`quick-command-${name}-input`}
                        value={field.state.value}
                        maxLength={name === 'name' ? 80 : 8192}
                        disabled={submitting}
                        required
                        placeholder={name === 'name' ? '例如：启动开发服务' : 'pnpm dev'}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={`${id}-${name}-hint${invalid ? ` ${id}-${name}-error` : ''}`}
                      />
                      <FieldDescription
                        className={`quick-command-${name}-hint`}
                        id={`${id}-${name}-hint`}
                      >
                        {name === 'name'
                          ? '显示在顶部按钮和终端标签上。'
                          : '支持多行；按所选 Shell 的语法执行。需要 Bash、Zsh、Fish 或 PowerShell，不要保存密码。'}
                      </FieldDescription>
                      {invalid && (
                        <FieldError
                          className={`quick-command-${name}-error`}
                          id={`${id}-${name}-error`}
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            ))}
          </FieldGroup>
          {error && (
            <p role="alert" className="quick-command-save-error text-destructive">
              {error}
            </p>
          )}
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, submitting]) => (
              <DialogFooter className="quick-command-dialog-footer">
                <Button
                  type="button"
                  variant="outline"
                  className="quick-command-cancel"
                  disabled={submitting}
                  onClick={() => {
                    setError(undefined)
                    onOpenChange(false)
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  className="quick-command-save"
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? '保存中…' : '保存命令'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}
