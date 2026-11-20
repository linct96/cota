import { useEffect, useId, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import type { QuickCommand } from '../../../../../shared/contracts'
import { quickCommandFormSchema } from '@/features/workspace/quick-commands/schemas'
import { abbreviateHomePath } from '@/lib/utils'
import { useWorkspace } from '@/state/workspace'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function QuickCommandDialog({
  open,
  onOpenChange,
  onOpenChangeComplete,
  command,
  projectPath,
  initialScope,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  command?: QuickCommand
  projectPath?: string
  initialScope?: QuickCommand['scope']['type']
}) {
  const id = useId()
  const saving = useRef(false)
  const [error, setError] = useState<string>()
  const projects = useWorkspace((state) => state.projects)
  const defaultProjectPath =
    command?.scope.type === 'project'
      ? command.scope.projectPath
      : projectPath && projects.includes(projectPath)
        ? projectPath
        : projects[0] || ''
  const defaultScope: QuickCommand['scope']['type'] =
    command?.scope.type ||
    (initialScope === 'global' || (initialScope === 'project' && defaultProjectPath)
      ? initialScope
      : defaultProjectPath
        ? 'project'
        : 'global')
  const form = useForm({
    defaultValues: {
      name: command?.name || '',
      command: command?.command || '',
      mode: command?.mode || ('task' as const),
      port: command?.port?.toString() || '',
      scope: defaultScope,
      projectPath: defaultProjectPath,
    },
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: quickCommandFormSchema },
    onSubmit: async ({ value }) => {
      if (!open || saving.current) return
      saving.current = true
      setError(undefined)
      try {
        const state = useWorkspace.getState()
        if (command && !state.preferences.quickCommands.some((entry) => entry.id === command.id))
          throw new Error('该命令已被删除，请关闭弹窗后重试。')
        let scope: QuickCommand['scope'] = { type: 'global' }
        if (value.scope === 'project') {
          if (!state.projects.includes(value.projectPath))
            throw new Error('所选项目已被移除，请重新选择。')
          scope = { type: 'project', projectPath: value.projectPath }
        }
        const next: QuickCommand = {
          id: command?.id || crypto.randomUUID(),
          name: value.name.trim(),
          command: value.command.replace(/\r\n?/g, '\n'),
          mode: value.mode,
          ...(value.mode === 'service' && value.port.trim()
            ? { port: value.port.trim() === 'auto' ? ('auto' as const) : Number(value.port.trim()) }
            : {}),
          scope,
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
  const scope = useStore(form.store, (state) => state.values.scope)
  const mode = useStore(form.store, (state) => state.values.mode)
  useEffect(() => {
    if (!open) return
    form.reset({
      name: command?.name || '',
      command: command?.command || '',
      mode: command?.mode || 'task',
      port: command?.port?.toString() || '',
      scope: defaultScope,
      projectPath: defaultProjectPath,
    })
  }, [open, command, defaultScope, defaultProjectPath, form])

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (form.state.isSubmitting) details.cancel()
        else onOpenChange(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next && !open) setError(undefined)
        onOpenChangeComplete(next)
      }}
    >
      <DialogContent
        className="quick-command-dialog max-h-[calc(100%-2rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader className="quick-command-dialog-header">
          <DialogTitle className="quick-command-dialog-title">
            {command ? '编辑快捷命令' : '新增快捷命令'}
          </DialogTitle>
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
            <form.Field name="name">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="quick-command-name-field"
                    data-invalid={invalid}
                    data-disabled={submitting}
                  >
                    <FieldLabel className="quick-command-name-label" htmlFor={`${id}-name`}>
                      名称
                    </FieldLabel>
                    <Input
                      id={`${id}-name`}
                      name={field.name}
                      className="quick-command-name-input"
                      value={field.state.value}
                      maxLength={80}
                      autoComplete="off"
                      disabled={submitting}
                      required
                      placeholder="例如：启动开发服务"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? `${id}-name-error` : undefined}
                    />
                    {invalid && (
                      <FieldError
                        className="quick-command-name-error"
                        id={`${id}-name-error`}
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="command">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="quick-command-command-field"
                    data-invalid={invalid}
                    data-disabled={submitting}
                  >
                    <FieldLabel className="quick-command-command-label" htmlFor={`${id}-command`}>
                      Shell 命令
                    </FieldLabel>
                    <Textarea
                      id={`${id}-command`}
                      name={field.name}
                      className="quick-command-command-input font-mono"
                      value={field.state.value}
                      maxLength={8192}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      disabled={submitting}
                      required
                      placeholder="pnpm dev"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? `${id}-command-error` : undefined}
                    />
                    {invalid && (
                      <FieldError
                        className="quick-command-command-error"
                        id={`${id}-command-error`}
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <Field className="quick-command-scope-project-field" data-disabled={submitting}>
              <FieldLabel className="quick-command-scope-project-label" id={`${id}-scope-label`}>
                作用域
              </FieldLabel>
              <form.Field name="scope">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="quick-command-scope-field"
                      data-invalid={invalid}
                      data-disabled={submitting}
                    >
                      <ToggleGroup
                        className="quick-command-scope-options grid w-full grid-cols-2"
                        variant="segmented"
                        spacing={1}
                        value={[field.state.value]}
                        disabled={submitting}
                        onBlur={field.handleBlur}
                        onValueChange={([value]) => {
                          if (value === 'global' || (value === 'project' && projects.length > 0))
                            field.handleChange(value)
                        }}
                        aria-labelledby={`${id}-scope-label`}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? `${id}-scope-error` : undefined}
                      >
                        <ToggleGroupItem className="quick-command-scope-global" value="global">
                          全局
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          className="quick-command-scope-project"
                          value="project"
                          disabled={projects.length === 0}
                        >
                          指定项目
                        </ToggleGroupItem>
                      </ToggleGroup>
                      {invalid && (
                        <FieldError
                          className="quick-command-scope-error"
                          id={`${id}-scope-error`}
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {scope === 'project' && (
                <form.Field name="projectPath">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className="quick-command-project-field"
                        data-invalid={invalid}
                        data-disabled={submitting}
                      >
                        <FieldLabel
                          className="quick-command-project-label sr-only"
                          htmlFor={`${id}-project`}
                        >
                          项目
                        </FieldLabel>
                        <Select
                          name={field.name}
                          value={field.state.value || null}
                          disabled={submitting}
                          onValueChange={(value) => {
                            if (value) field.handleChange(value)
                          }}
                        >
                          <SelectTrigger
                            className="quick-command-project-select w-full"
                            id={`${id}-project`}
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? `${id}-project-error` : undefined}
                          >
                            <SelectValue
                              className="quick-command-project-value truncate"
                              placeholder="选择项目"
                              title={field.state.value}
                            >
                              {(value: string) =>
                                value.split(/[\\/]/).filter(Boolean).pop() || value
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="quick-command-project-options">
                            <SelectGroup className="quick-command-project-group">
                              {projects.map((path) => (
                                <SelectItem
                                  className="quick-command-project-option"
                                  key={path}
                                  value={path}
                                  title={abbreviateHomePath(path)}
                                >
                                  <span className="quick-command-project-name truncate">
                                    {path.split(/[\\/]/).filter(Boolean).pop() || path}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {invalid && (
                          <FieldError
                            className="quick-command-project-error"
                            id={`${id}-project-error`}
                            errors={field.state.meta.errors}
                          />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              )}
            </Field>
            <div className="quick-command-service-section flex flex-col gap-3 border-t border-border pt-3">
              <form.Field name="mode">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="quick-command-mode-field"
                      data-invalid={invalid}
                      data-disabled={submitting}
                    >
                      <div className="quick-command-mode-row flex items-center justify-between gap-3">
                        <FieldLabel className="quick-command-mode-label" htmlFor={`${id}-mode`}>
                          作为长驻服务运行
                        </FieldLabel>
                        <Switch
                          id={`${id}-mode`}
                          className="quick-command-mode-switch"
                          checked={field.state.value === 'service'}
                          disabled={submitting}
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? `${id}-mode-error` : undefined}
                          onCheckedChange={(checked) =>
                            field.handleChange(checked ? 'service' : 'task')
                          }
                        />
                      </div>
                      {invalid && (
                        <FieldError
                          className="quick-command-mode-error"
                          id={`${id}-mode-error`}
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {mode === 'service' && (
                <form.Field name="port">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className="quick-command-port-field"
                        data-invalid={invalid}
                        data-disabled={submitting}
                      >
                        <FieldLabel className="quick-command-port-label" htmlFor={`${id}-port`}>
                          端口（可选）
                        </FieldLabel>
                        <Input
                          className="quick-command-port-input font-mono"
                          id={`${id}-port`}
                          name={field.name}
                          value={field.state.value}
                          disabled={submitting}
                          placeholder="auto 或 1024–65535"
                          maxLength={5}
                          spellCheck={false}
                          autoCorrect="off"
                          autoCapitalize="off"
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? `${id}-port-error` : undefined}
                        />
                        {invalid && (
                          <FieldError
                            className="quick-command-port-error"
                            id={`${id}-port-error`}
                            errors={field.state.meta.errors}
                          />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              )}
            </div>
          </FieldGroup>
          {error && (
            <Alert className="quick-command-save-error" variant="destructive">
              <AlertDescription className="quick-command-save-error-message">
                {error}
              </AlertDescription>
            </Alert>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(formSubmitting) => (
              <DialogFooter className="quick-command-dialog-footer">
                <Button
                  type="button"
                  variant="outline"
                  className="quick-command-cancel"
                  disabled={formSubmitting}
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button type="submit" className="quick-command-save" disabled={formSubmitting}>
                  {formSubmitting ? '保存中…' : command ? '保存' : '创建'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}
