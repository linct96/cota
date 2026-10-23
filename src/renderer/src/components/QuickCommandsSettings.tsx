import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import type { QuickCommand } from '../../../shared/contracts'
import { currentWorkspace, useWorkspace } from '../store'
import { QuickCommandDialog } from './QuickCommandDialog'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

export function QuickCommandsSettings() {
  const commands = useWorkspace((state) => state.preferences.quickCommands)
  const projectPath = useWorkspace((state) => currentWorkspace(state)?.projectPath)
  const [editor, setEditor] = useState<{ command?: QuickCommand }>()
  const [deleting, setDeleting] = useState<QuickCommand>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const saving = useRef(false)

  const [copiedId, setCopiedId] = useState<string>()
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  async function copy(entry: QuickCommand) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(entry.command)
      } else {
        throw new Error('当前环境不支持剪贴板操作')
      }
      setCopiedId(entry.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => {
        setCopiedId(undefined)
      }, 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove() {
    if (!deleting || saving.current) return
    saving.current = true
    setPending(true)
    setError(undefined)
    try {
      const state = useWorkspace.getState()
      await state.savePreferences({
        ...state.preferences,
        quickCommands: state.preferences.quickCommands.filter((entry) => entry.id !== deleting.id),
      })
      setDeleting(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  return (
    <section
      className="quick-commands-settings flex flex-col gap-5"
      aria-labelledby="quick-commands-settings-title"
    >
      <div className="quick-commands-settings-header flex items-start justify-between gap-4">
        <div className="quick-commands-settings-heading flex min-w-0 flex-col gap-1">
          <h3
            id="quick-commands-settings-title"
            className="quick-commands-settings-title text-base font-semibold"
          >
            快捷命令
          </h3>
          <p className="quick-commands-settings-description text-muted-foreground">
            从顶部栏一键运行。项目命令与其 Worktree 共享，每次在当前工作区的新终端中执行。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="quick-commands-settings-add shrink-0"
          disabled={pending || commands.length >= 50}
          onClick={() => setEditor({})}
        >
          <Plus className="quick-commands-settings-add-icon" data-icon="inline-start" />
          新增命令
        </Button>
      </div>
      {!commands.length ? (
        <Empty className="quick-commands-empty">
          <EmptyHeader className="quick-commands-empty-header">
            <EmptyTitle className="quick-commands-empty-title">尚未保存快捷命令</EmptyTitle>
            <EmptyDescription className="quick-commands-empty-description">
              添加常用命令，例如 pnpm dev。保存后不会自动执行。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="quick-commands-list flex flex-col gap-4">
          {commands.map((entry) => (
            <li
              key={entry.id}
              className="quick-commands-list-item flex items-start justify-between gap-3"
            >
              <div className="quick-commands-list-content flex min-w-0 flex-col gap-1">
                <span className="quick-commands-list-name truncate font-medium">{entry.name}</span>
                <code className="quick-commands-list-command block truncate" title={entry.command}>
                  {entry.command}
                </code>
                <span
                  className="quick-commands-list-scope truncate text-muted-foreground"
                  title={entry.scope.type === 'global' ? undefined : entry.scope.projectPath}
                >
                  {entry.scope.type === 'global' ? '所有项目' : entry.scope.projectPath}
                </span>
              </div>
              <div className="quick-commands-list-actions flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="quick-commands-list-copy"
                  aria-label={copiedId === entry.id ? '已复制命令' : `复制 ${entry.name} 命令`}
                  disabled={pending}
                  onClick={() => void copy(entry)}
                >
                  {copiedId === entry.id ? (
                    <Check className="quick-commands-list-copied-icon size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="quick-commands-list-copy-icon size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="quick-commands-list-edit"
                  aria-label={`编辑 ${entry.name}`}
                  disabled={pending}
                  onClick={() => setEditor({ command: entry })}
                >
                  <Pencil className="quick-commands-list-edit-icon" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="quick-commands-list-delete"
                  aria-label={`删除 ${entry.name}`}
                  disabled={pending}
                  onClick={() => {
                    setError(undefined)
                    setDeleting(entry)
                  }}
                >
                  <Trash2 className="quick-commands-list-delete-icon" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <QuickCommandDialog
        open={!!editor}
        command={editor?.command}
        projectPath={projectPath}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
      />
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open, details) => {
          if (saving.current) details.cancel()
          else if (!open) setDeleting(undefined)
        }}
      >
        <AlertDialogContent className="quick-command-delete-dialog">
          <AlertDialogHeader className="quick-command-delete-header">
            <AlertDialogTitle className="quick-command-delete-title">
              删除「{deleting?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="quick-command-delete-description">
              仅移除保存的命令，不会停止已运行的终端。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="quick-command-delete-error text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter className="quick-command-delete-footer">
            <AlertDialogCancel className="quick-command-delete-cancel" disabled={pending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="quick-command-delete-confirm"
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                void remove()
              }}
            >
              {pending ? '删除中…' : '删除命令'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
