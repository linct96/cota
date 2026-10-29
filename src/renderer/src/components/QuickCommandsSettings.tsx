import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import type { QuickCommand } from '../../../shared/contracts'
import { currentWorkspace, useWorkspace } from '../store'
import { QuickCommandDialog } from './QuickCommandDialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
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
      <header className="quick-commands-settings-header flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="quick-commands-settings-heading flex flex-col gap-1">
          <h1
            id="quick-commands-settings-title"
            className="quick-commands-settings-title settings-page-title"
          >
            快捷命令
          </h1>
          <p className="quick-commands-settings-subtitle text-xs text-muted-foreground">
            管理工作区常用脚本与长驻服务，支持从顶栏一键启动。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="quick-commands-settings-add shrink-0"
          disabled={pending || commands.length >= 50}
          onClick={() => setEditor({})}
        >
          <Plus className="quick-commands-settings-add-icon" data-icon="inline-start" />
          新增命令
        </Button>
      </header>
      <Card size="sm" className="quick-commands-settings-card gap-0 py-0">
        {!commands.length ? (
          <Empty className="quick-commands-empty py-8">
            <EmptyHeader className="quick-commands-empty-header">
              <EmptyTitle className="quick-commands-empty-title">尚未保存快捷命令</EmptyTitle>
              <EmptyDescription className="quick-commands-empty-description">
                添加常用命令，例如 pnpm dev。保存后不会自动执行。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="quick-commands-list divide-y divide-border">
            {commands.map((entry) => (
              <li key={entry.id} className="quick-commands-list-item">
                <div className="quick-commands-list-row flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30">
                  <div className="quick-commands-list-content flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                    <div className="quick-commands-list-heading flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className="quick-commands-list-name min-w-0 truncate text-xs leading-5 font-medium text-foreground"
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      {entry.mode === 'service' && (
                        <Badge
                          className="quick-commands-list-service tabular-nums"
                          variant="secondary"
                        >
                          服务
                          {entry.port === undefined
                            ? ''
                            : ` · ${entry.port === 'auto' ? '自动端口' : entry.port}`}
                        </Badge>
                      )}
                      {entry.scope.type === 'project' && (
                        <Badge className="quick-commands-list-project max-w-full" variant="outline">
                          <span className="quick-commands-list-project-name truncate">
                            {entry.scope.projectPath.split(/[\\/]/).filter(Boolean).pop() || '项目'}
                          </span>
                        </Badge>
                      )}
                    </div>
                    <code
                      className="quick-commands-list-command block truncate font-mono text-xs text-muted-foreground"
                      title={entry.command}
                    >
                      {entry.command}
                    </code>
                  </div>
                  <div className="quick-commands-list-actions flex min-h-7 shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="quick-commands-list-copy text-muted-foreground hover:text-foreground"
                      aria-label={copiedId === entry.id ? '已复制命令' : `复制 ${entry.name} 命令`}
                      disabled={pending}
                      onClick={() => void copy(entry)}
                    >
                      {copiedId === entry.id ? (
                        <Check className="quick-commands-list-copied-icon" />
                      ) : (
                        <Copy className="quick-commands-list-copy-icon" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="quick-commands-list-edit text-muted-foreground hover:text-foreground"
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
                      className="quick-commands-list-delete text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
