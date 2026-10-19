import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { WorkspaceOpener } from '../../../shared/contracts'
import { parseArguments } from '../../../shared/open-with'
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
import { Field, FieldGroup, FieldLabel } from './ui/field'
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
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argumentsTemplate, setArgumentsTemplate] = useState('')
  const [dialogError, setDialogError] = useState<string>()

  async function persist(nextOpeners: WorkspaceOpener[]) {
    if (saving) return
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
    setName('')
    setCommand('')
    setArgumentsTemplate('{path}')
    setDialogError(undefined)
    setDialogOpen(true)
  }

  function handleOpenEditDialog(opener: WorkspaceOpener) {
    setDialogMode('edit')
    setEditingId(opener.id)
    setName(opener.name)
    setCommand(opener.command)
    setArgumentsTemplate(opener.arguments)
    setDialogError(undefined)
    setDialogOpen(true)
  }

  async function handleDelete(id: string) {
    const next = openers.filter((item) => item.id !== id)
    await persist(next)
  }

  async function handleDialogSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedCommand = command.trim()

    if (!trimmedName) {
      setDialogError('请输入应用程序名称。')
      return
    }
    if (!trimmedCommand) {
      setDialogError('请输入启动命令或可执行文件路径。')
      return
    }
    try {
      parseArguments(argumentsTemplate)
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : '启动参数格式无效。')
      return
    }

    let nextOpeners: WorkspaceOpener[]
    if (dialogMode === 'edit' && editingId) {
      nextOpeners = openers.map((item) =>
        item.id === editingId
          ? {
              ...item,
              name: trimmedName,
              command: trimmedCommand,
              arguments: argumentsTemplate,
            }
          : item,
      )
    } else {
      nextOpeners = [
        ...openers,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          command: trimmedCommand,
          arguments: argumentsTemplate,
        },
      ]
    }

    const success = await persist(nextOpeners)
    if (success) {
      setDialogOpen(false)
    }
  }

  return (
    <div className="open-with-settings flex flex-col gap-5">
      {/* 顶部标题与操作栏 */}
      <div className="open-with-settings-header flex items-start justify-between gap-4">
        <div className="open-with-settings-titles flex flex-col">
          <h3 className="open-with-settings-title text-base font-semibold text-foreground">
            在应用程序中打开
          </h3>
          <p className="open-with-settings-description mt-1 text-xs text-muted-foreground">
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
                        className="open-with-preset-icon size-3.5 text-muted-foreground"
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
          <Card className="open-with-empty-state rounded-xl border-dashed py-8 text-center text-xs text-muted-foreground shadow-none ring-0">
            暂无打开方式，请点击右上角「添加应用程序」进行添加。
          </Card>
        )}

        {openers.map((opener) => (
          <div
            key={opener.id}
            className="open-with-item group flex items-center justify-between gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/40"
          >
            <div className="open-with-item-main flex min-w-0 items-center gap-3">
              <div className="open-with-item-icon-box flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-foreground shadow-xs">
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
                <span className="open-with-item-command truncate font-mono text-[11px] text-muted-foreground">
                  {opener.command}
                </span>
              </div>
            </div>

            <div className="open-with-item-actions flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="open-with-item-edit text-muted-foreground hover:text-foreground"
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
                className="open-with-item-delete text-muted-foreground hover:text-destructive"
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

      {error && (
        <p role="alert" className="open-with-settings-error text-xs text-destructive">
          {error}
        </p>
      )}

      {/* 编辑 / 添加 对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
            onSubmit={(event) => void handleDialogSubmit(event)}
            className="open-with-dialog-form flex flex-col gap-4"
          >
            <FieldGroup className="open-with-dialog-fields">
              <Field className="open-with-dialog-name-field">
                <FieldLabel htmlFor="dialog-opener-name" className="text-xs">
                  显示名称
                </FieldLabel>
                <Input
                  id="dialog-opener-name"
                  required
                  maxLength={80}
                  value={name}
                  placeholder="例如 Zed 或 VS Code"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <Field className="open-with-dialog-command-field">
                <FieldLabel htmlFor="dialog-opener-command" className="text-xs">
                  启动命令
                </FieldLabel>
                <Input
                  id="dialog-opener-command"
                  required
                  maxLength={4096}
                  value={command}
                  placeholder="zed 或 /usr/local/bin/zed"
                  onChange={(event) => setCommand(event.target.value)}
                />
              </Field>

              <Field className="open-with-dialog-arguments-field">
                <FieldLabel htmlFor="dialog-opener-arguments" className="text-xs">
                  启动参数
                </FieldLabel>
                <Input
                  id="dialog-opener-arguments"
                  maxLength={4096}
                  value={argumentsTemplate}
                  placeholder="{path}"
                  onChange={(event) => setArgumentsTemplate(event.target.value)}
                />
                <p className="open-with-dialog-arguments-hint mt-1 text-[11px] text-muted-foreground">
                  参数中的 {'{path}'} 会替换为工作区目录路径；未填写时自动追加目录。
                </p>
              </Field>
            </FieldGroup>

            {dialogError && (
              <p role="alert" className="open-with-dialog-error text-xs text-destructive">
                {dialogError}
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
                {saving ? '保存中…' : dialogMode === 'add' ? '添加' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
