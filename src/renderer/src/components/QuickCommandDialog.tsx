import { useEffect, useId, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import type { QuickCommand } from '../../../shared/contracts'
import { quickCommandFormSchema } from '../lib/form-schemas'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Textarea } from './ui/textarea'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

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
  const projects = useWorkspace((state) => state.projects)
  const defaultProjectPath =
    command?.scope.type === 'project'
      ? command.scope.projectPath
      : projectPath && projects.includes(projectPath)
        ? projectPath
        : projects[0] || ''
  const defaultScope: QuickCommand['scope']['type'] =
    command?.scope.type || (defaultProjectPath ? 'project' : 'global')
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
      if (saving.current) return
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
                        aria-describedby={invalid ? `${id}-${name}-error` : undefined}
                      />
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
            <form.Field name="mode">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="quick-command-mode-field" data-invalid={invalid}>
                    <FieldLabel className="quick-command-mode-label" id={`${id}-mode-label`}>
                      运行类型
                    </FieldLabel>
                    <ToggleGroup
                      className="quick-command-mode-options"
                      variant="outline"
                      spacing={0}
                      value={[field.state.value]}
                      disabled={submitting}
                      onBlur={field.handleBlur}
                      aria-labelledby={`${id}-mode-label`}
                      aria-invalid={invalid}
                      aria-describedby={`${id}-mode-description${invalid ? ` ${id}-mode-error` : ''}`}
                      onValueChange={([value]) => {
                        if (value === 'task' || value === 'service') field.handleChange(value)
                      }}
                    >
                      <ToggleGroupItem className="quick-command-mode-task" value="task">
                        普通命令
                      </ToggleGroupItem>
                      <ToggleGroupItem className="quick-command-mode-service" value="service">
                        长驻服务
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription
                      className="quick-command-mode-description"
                      id={`${id}-mode-description`}
                    >
                      {field.state.value === 'service'
                        ? '每个工作区只运行一个实例；命令退出后服务结束。请以前台方式运行，不要使用 & 或 daemon。'
                        : '在新终端中执行，执行后保留 Shell。'}
                    </FieldDescription>
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
                    <Field className="quick-command-port-field" data-invalid={invalid}>
                      <FieldLabel className="quick-command-port-label" htmlFor={`${id}-port`}>
                        端口（可选）
                      </FieldLabel>
                      <Input
                        className="quick-command-port-input"
                        id={`${id}-port`}
                        name={field.name}
                        value={field.state.value}
                        disabled={submitting}
                        placeholder="auto 或 3000"
                        maxLength={5}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={`${id}-port-description${invalid ? ` ${id}-port-error` : ''}`}
                      />
                      <FieldDescription
                        className="quick-command-port-description"
                        id={`${id}-port-description`}
                      >
                        auto 自动分配，留空不分配。通过 PORT 和 COTA_PORT
                        传入；命令须读取该环境变量。
                      </FieldDescription>
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
            <Field className="quick-command-scope-project-field" data-disabled={submitting}>
              <FieldLabel className="quick-command-scope-project-label">范围和项目</FieldLabel>
              <div className="quick-command-scope-project-controls flex min-w-0 items-start gap-2">
                <form.Field name="scope">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className="quick-command-scope-field w-auto shrink-0"
                        data-invalid={invalid}
                        data-disabled={submitting}
                      >
                        <FieldLabel
                          id={`${id}-scope-label`}
                          className="quick-command-scope-label sr-only"
                        >
                          范围
                        </FieldLabel>
                        <ToggleGroup
                          className="quick-command-scope-options"
                          variant="outline"
                          spacing={0}
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
                            项目
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
                          className="quick-command-project-field flex-1"
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
                                  value?.split(/[\\/]/).filter(Boolean).pop() || value
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
                                    title={path}
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
              </div>
            </Field>
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
