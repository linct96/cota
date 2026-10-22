import { useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { openerFormSchema } from '../lib/form-schemas'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { WorkspaceOpener } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
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
import { OpenerIcon, PRESET_OPENERS, type PresetOpener } from './OpenWithIcons'

export function OpenWithSettings() {
  const preferences = useWorkspace((state) => state.preferences)
  const openers = preferences.openWith
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  // 弹窗状态：用于添加自定义应用或编辑现有应用
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
  const [editingId, setEditingId] = useState<string | null>(null)
  const persisting = useRef(false)
  const form = useForm({
    defaultValues: { name: '', command: '', arguments: '{path}' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: openerFormSchema },
    onSubmit: async ({ value }) => {
      const opener = {
        name: value.name.trim(),
        command: value.command.trim(),
        arguments: value.arguments,
      }
      const current = useWorkspace.getState().preferences.openWith
      const next =
        dialogMode === 'edit' && editingId
          ? current.map((item) => (item.id === editingId ? { ...item, ...opener } : item))
          : [...current, { id: crypto.randomUUID(), ...opener }]
      if (await persist(next)) setDialogOpen(false)
    },
  })

  async function persist(nextOpeners: WorkspaceOpener[]) {
    if (persisting.current) return false
    persisting.current = true
    setSaving(true)
    setError(undefined)
    try {
      await useWorkspace.getState().savePreferences({
        ...useWorkspace.getState().preferences,
        openWith: nextOpeners,
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
    form.reset({ name: opener.name, command: opener.command, arguments: opener.arguments })
    setError(undefined)
    setDialogOpen(true)
  }

  async function handleDelete(id: string) {
    const next = openers.filter((item) => item.id !== id)
    await persist(next)
  }

  return (
    <div className="open-with-settings flex flex-col gap-5">
      {/* 顶部标题与操作栏 */}
      <div className="open-with-settings-header flex items-start justify-between gap-4">
        <div className="open-with-settings-titles flex flex-col">
          <h3 className="open-with-settings-title text-base font-semibold text-foreground">
            在应用程序中打开
          </h3>
          <p className="open-with-settings-description mt-1 text-xs text-app-muted-foreground">
            从工作区的“打开于”菜单中选择应用程序；系统文件管理器始终可用。
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="open-with-add-trigger h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
              />
            }
            disabled={saving || openers.length >= 50}
          >
            <span className="open-with-add-trigger-text">添加应用程序</span>
            <ChevronDown className="open-with-add-trigger-icon size-3.5 opacity-70" />
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
                        className="open-with-preset-icon size-3.5 text-app-muted-foreground"
                      />
                      <span className="open-with-preset-name">{preset.name}</span>
                    </span>
                    {isAdded && (
                      <Badge
                        variant="secondary"
                        className="open-with-preset-status h-4 px-1.5 text-[10px] font-normal"
                      >
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
              <Plus className="open-with-custom-icon size-3.5" />
              <span className="open-with-custom-label">自定义应用程序…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 列表区域 */}
      <div className="open-with-list flex flex-col gap-1.5 pt-1">
        {!openers.length && (
          <Card className="open-with-empty-state rounded-xl border-dashed py-8 text-center text-xs text-app-muted-foreground shadow-none ring-0">
            暂无打开方式，请点击右上角「添加应用程序」进行添加。
          </Card>
        )}

        {openers.map((opener) => (
          <div
            key={opener.id}
            className="open-with-item group flex items-center justify-between gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/40"
          >
            <div className="open-with-item-main flex min-w-0 items-center gap-3">
              <div className="open-with-item-icon-box flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted text-foreground shadow-xs">
                <OpenerIcon
                  name={opener.name}
                  command={opener.command}
                  id={opener.id}
                  className="open-with-item-icon size-5"
                />
              </div>
              <div className="open-with-item-meta flex min-w-0 flex-col">
                <span className="open-with-item-name truncate text-xs font-semibold text-foreground">
                  {opener.name}
                </span>
                <span className="open-with-item-command truncate font-mono text-[11px] text-app-muted-foreground">
                  {opener.command}
                </span>
              </div>
            </div>

            <div className="open-with-item-actions flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="open-with-item-edit text-app-muted-foreground hover:text-foreground"
                aria-label={`编辑 ${opener.name}`}
                title={`编辑 ${opener.name}`}
                disabled={saving}
                onClick={() => handleOpenEditDialog(opener)}
              >
                <Pencil className="open-with-action-icon size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="open-with-item-delete text-app-muted-foreground hover:text-destructive"
                aria-label={`删除 ${opener.name}`}
                title={`删除 ${opener.name}`}
                disabled={saving}
                onClick={() => void handleDelete(opener.id)}
              >
                <Trash2 className="open-with-action-icon size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && !dialogOpen && (
        <p role="alert" className="open-with-settings-error text-xs text-destructive">
          {error}
        </p>
      )}

      {/* 编辑 / 添加 对话框 */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open, details) => {
          if (persisting.current) details.cancel()
          else setDialogOpen(open)
        }}
      >
        <DialogContent className="open-with-dialog max-w-sm">
          <DialogHeader className="open-with-dialog-header">
            <DialogTitle className="open-with-dialog-title">
              {dialogMode === 'add' ? '添加自定义应用程序' : '编辑应用程序'}
            </DialogTitle>
            <DialogDescription className="open-with-dialog-description">
              配置在工作区右键「打开于」菜单中执行的外部应用程序命令。
            </DialogDescription>
          </DialogHeader>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
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
                      data-disabled={saving}
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
                        placeholder="例如 Zed 或 VS Code"
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'dialog-opener-name-error' : undefined}
                      />
                      {invalid && (
                        <FieldError
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
                      data-disabled={saving}
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
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'dialog-opener-command-error' : undefined}
                      />
                      {invalid && (
                        <FieldError
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
                      data-disabled={saving}
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
                        disabled={saving}
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
                        参数中的 {'{path}'} 会替换为工作区目录路径；未填写时自动追加目录。
                      </FieldDescription>
                      {invalid && (
                        <FieldError
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

            <DialogFooter className="open-with-dialog-footer mt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {dialogMode === 'add' ? '添加' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
