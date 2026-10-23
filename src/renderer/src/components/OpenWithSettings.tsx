import { Fragment, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { openerFormSchema } from '../lib/form-schemas'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { WorkspaceOpener } from '../../../shared/contracts'
import { preferredWorkspaceOpener, withSystemFileManager } from '../../../shared/open-with'
import { useWorkspace } from '../store'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import { OpenerIcon, PRESET_OPENERS, type PresetOpener } from './OpenWithIcons'

export function OpenWithSettings() {
  const preferences = useWorkspace((state) => state.preferences)
  const openers = preferences.openWith
  const availableOpeners = withSystemFileManager(openers, window.desktop.platform)
  const defaultOpener = preferredWorkspaceOpener({
    preferences,
    workspaceOpeners: availableOpeners,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  // 弹窗状态：用于添加自定义应用或编辑现有应用
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
  const [editingId, setEditingId] = useState<string | null>(null)
  const persisting = useRef(false)
  const form = useForm({
    defaultValues: { name: '', command: '', arguments: '{path}' },
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: openerFormSchema },
    onSubmit: async ({ value }) => {
      if (persisting.current) return
      const opener = {
        name: value.name.trim(),
        command: value.command.trim(),
        arguments: value.arguments,
      }
      const currentState = useWorkspace.getState()
      const current = currentState.preferences.openWith
      const next =
        dialogMode === 'edit' && editingId
          ? current.map((item) => (item.id === editingId ? { ...item, ...opener } : item))
          : [{ id: crypto.randomUUID(), ...opener }, ...current]
      if (await persist(next, preferredWorkspaceOpener(currentState)?.id)) setDialogOpen(false)
    },
  })
  const dialogPending = useStore(form.store, (state) => state.isSubmitting) || saving

  async function persist(
    nextOpeners: WorkspaceOpener[],
    preferredOpenerId = useWorkspace.getState().preferences.preferredOpenerId,
  ) {
    if (persisting.current) return false
    persisting.current = true
    setSaving(true)
    setError(undefined)
    try {
      await useWorkspace.getState().savePreferences({
        ...useWorkspace.getState().preferences,
        openWith: nextOpeners,
        preferredOpenerId,
      })
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      persisting.current = false
      setSaving(false)
    }
  }

  async function handleAddPreset(preset: PresetOpener) {
    const id = openers.some((item) => item.id === preset.id) ? crypto.randomUUID() : preset.id
    const next: WorkspaceOpener = {
      id,
      name: preset.name,
      command: preset.command,
      arguments: preset.arguments,
    }
    await persist([...openers, next])
  }

  function handleOpenAddDialog() {
    setDialogMode('add')
    setEditingId(null)
    form.reset({ name: '', command: '', arguments: '{path}' })
    setError(undefined)
    setDialogOpen(true)
  }

  function handleOpenEditDialog(opener: WorkspaceOpener) {
    setDialogMode('edit')
    setEditingId(opener.id)
    form.reset(
      { name: opener.name, command: opener.command, arguments: opener.arguments },
      { keepDefaultValues: true },
    )
    setError(undefined)
    setDialogOpen(true)
  }

  async function handleDelete(id: string) {
    const next = openers.filter((item) => item.id !== id)
    await persist(next)
  }

  return (
    <section
      className="open-with-settings flex flex-col gap-6"
      aria-labelledby="open-with-settings-title"
    >
      <div className="open-with-settings-heading typeset">
        <h1 id="open-with-settings-title" className="open-with-settings-title">
          打开方式
        </h1>
      </div>
      <section
        className="open-with-settings-group flex flex-col gap-3"
        aria-labelledby="open-with-settings-group-title"
      >
        <div className="open-with-settings-group-header flex flex-wrap items-start justify-between gap-3">
          <h4
            id="open-with-settings-group-title"
            className="open-with-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
          >
            应用程序
          </h4>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="open-with-add-trigger"
                />
              }
              disabled={saving || openers.length >= 50}
            >
              <span className="open-with-add-trigger-text">添加应用程序</span>
              <ChevronDown className="open-with-add-trigger-icon" data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="open-with-add-menu w-48">
              <DropdownMenuGroup className="open-with-presets-group">
                {PRESET_OPENERS.map((preset) => {
                  const isAdded = openers.some(
                    (item) => item.id === preset.id || item.command === preset.command,
                  )
                  return (
                    <DropdownMenuItem
                      key={preset.id}
                      disabled={isAdded || saving}
                      className="open-with-preset-item flex items-center justify-between"
                      onClick={() => void handleAddPreset(preset)}
                    >
                      <span className="open-with-preset-name-wrap flex items-center gap-2">
                        <OpenerIcon
                          name={preset.name}
                          command={preset.command}
                          id={preset.id}
                          className="open-with-preset-icon"
                        />
                        <span className="open-with-preset-name">{preset.name}</span>
                      </span>
                      {isAdded && (
                        <Badge variant="secondary" className="open-with-preset-status">
                          已添加
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="open-with-menu-separator" />
              <DropdownMenuItem
                className="open-with-custom-item flex items-center gap-2"
                onClick={handleOpenAddDialog}
              >
                <Plus className="open-with-custom-icon" />
                <span className="open-with-custom-label">自定义应用程序</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && !dialogOpen && (
          <FieldError className="open-with-settings-error">{error}</FieldError>
        )}
        <Card className="open-with-list" aria-busy={saving}>
          {availableOpeners.map((opener, index) => (
            <Fragment key={opener.id}>
              {index > 0 && <Separator className="open-with-item-separator" />}
              <div className="open-with-item flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5">
                <div className="open-with-item-main flex min-w-0 flex-1 basis-64 items-center gap-3">
                  <OpenerIcon
                    name={opener.name}
                    command={opener.command}
                    id={opener.id}
                    className="open-with-item-icon size-6"
                  />
                  <div className="open-with-item-meta flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className="open-with-item-name truncate text-sm font-medium"
                      title={opener.name}
                    >
                      {opener.name}
                    </span>
                    {opener.id !== 'system-file-manager' && (
                      <p
                        className="open-with-item-command truncate font-mono text-xs text-muted-foreground"
                        title={opener.command}
                      >
                        {opener.command}
                      </p>
                    )}
                  </div>
                </div>
                <div className="open-with-item-actions ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="open-with-item-set-default"
                    aria-label={`将 ${opener.name} 设为默认打开方式`}
                    disabled={saving || defaultOpener?.id === opener.id}
                    onClick={() =>
                      void persist(useWorkspace.getState().preferences.openWith, opener.id)
                    }
                  >
                    {defaultOpener?.id === opener.id ? '默认' : '设为默认'}
                  </Button>
                  {opener.id !== 'system-file-manager' && (
                    <>
                      {!PRESET_OPENERS.some((preset) => preset.id === opener.id) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          className="open-with-item-edit"
                          aria-label={`编辑 ${opener.name}`}
                          title={`编辑 ${opener.name}`}
                          disabled={saving}
                          onClick={() => handleOpenEditDialog(opener)}
                        >
                          <Pencil className="open-with-action-icon" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-lg"
                        className="open-with-item-delete"
                        aria-label={`删除 ${opener.name}`}
                        title={`删除 ${opener.name}`}
                        disabled={saving}
                        onClick={() => void handleDelete(opener.id)}
                      >
                        <Trash2 className="open-with-action-icon" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </Card>
      </section>

      {/* 编辑 / 添加 对话框 */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open, details) => {
          if (persisting.current || form.state.isSubmitting) details.cancel()
          else {
            setError(undefined)
            setDialogOpen(open)
          }
        }}
      >
        <DialogContent
          className="open-with-dialog max-h-[calc(100%-2rem)] overflow-y-auto"
          showCloseButton={false}
          initialFocus={false}
        >
          <DialogHeader className="open-with-dialog-header">
            <DialogTitle className="open-with-dialog-title">
              {dialogMode === 'add' ? '添加自定义应用程序' : '编辑应用程序'}
            </DialogTitle>
          </DialogHeader>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (persisting.current || form.state.isSubmitting) return
              void form.handleSubmit()
            }}
            className="open-with-dialog-form flex flex-col gap-4"
          >
            <FieldGroup className="open-with-dialog-fields">
              <form.Field name="name">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="open-with-dialog-name-field"
                      data-invalid={invalid}
                      data-disabled={dialogPending}
                    >
                      <FieldLabel
                        htmlFor="dialog-opener-name"
                        className="open-with-dialog-name-label"
                      >
                        显示名称
                      </FieldLabel>
                      <Input
                        className="open-with-dialog-name-input"
                        id="dialog-opener-name"
                        name={field.name}
                        required
                        maxLength={80}
                        value={field.state.value}
                        placeholder="例如：Zed 或 VS Code"
                        disabled={dialogPending}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'dialog-opener-name-error' : undefined}
                      />
                      {invalid && (
                        <FieldError
                          className="open-with-dialog-name-error"
                          id="dialog-opener-name-error"
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
                      className="open-with-dialog-command-field"
                      data-invalid={invalid}
                      data-disabled={dialogPending}
                    >
                      <FieldLabel
                        htmlFor="dialog-opener-command"
                        className="open-with-dialog-command-label"
                      >
                        启动命令
                      </FieldLabel>
                      <Input
                        className="open-with-dialog-command-input"
                        id="dialog-opener-command"
                        name={field.name}
                        required
                        maxLength={4096}
                        value={field.state.value}
                        placeholder="zed 或 /usr/local/bin/zed"
                        disabled={dialogPending}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'dialog-opener-command-error' : undefined}
                      />
                      {invalid && (
                        <FieldError
                          className="open-with-dialog-command-error"
                          id="dialog-opener-command-error"
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="arguments">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="open-with-dialog-arguments-field"
                      data-invalid={invalid}
                      data-disabled={dialogPending}
                    >
                      <FieldLabel
                        htmlFor="dialog-opener-arguments"
                        className="open-with-dialog-arguments-label"
                      >
                        启动参数
                      </FieldLabel>
                      <Input
                        className="open-with-dialog-arguments-input"
                        id="dialog-opener-arguments"
                        name={field.name}
                        maxLength={4096}
                        value={field.state.value}
                        placeholder="{path}"
                        disabled={dialogPending}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={
                          invalid
                            ? 'dialog-opener-arguments-hint dialog-opener-arguments-error'
                            : 'dialog-opener-arguments-hint'
                        }
                      />
                      <FieldDescription
                        id="dialog-opener-arguments-hint"
                        className="open-with-dialog-arguments-hint"
                      >
                        {'{path}'} 代表工作区目录；留空时自动追加目录。
                      </FieldDescription>
                      {invalid && (
                        <FieldError
                          className="open-with-dialog-arguments-error"
                          id="dialog-opener-arguments-error"
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>

            {error && (
              <p role="alert" className="open-with-dialog-error text-xs text-destructive">
                {error}
              </p>
            )}

            <form.Subscribe selector={(state) => state.canSubmit}>
              {(canSubmit) => (
                <DialogFooter className="open-with-dialog-footer">
                  <Button
                    type="button"
                    variant="outline"
                    className="open-with-dialog-cancel"
                    disabled={dialogPending}
                    onClick={() => {
                      setError(undefined)
                      setDialogOpen(false)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    className="open-with-dialog-save"
                    disabled={!canSubmit || dialogPending}
                  >
                    {dialogPending ? '保存中…' : dialogMode === 'add' ? '添加' : '保存'}
                  </Button>
                </DialogFooter>
              )}
            </form.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
