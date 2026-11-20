import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, Play, Plus, Server, Terminal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { QuickCommand } from '../../../../../shared/contracts'
import { cn } from '@/lib/utils'
import { currentWorkspace, useWorkspace } from '@/state/workspace'
import { QuickCommandDialog } from '@/features/workspace/quick-commands/QuickCommandDialog'
import { useDialogState } from '@/hooks/use-dialog-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const MAX_QUICK_COMMANDS = 50

function projectBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || '项目'
}

export function QuickCommandsSettings() {
  const commands = useWorkspace((state) => state.preferences.quickCommands)
  const projectPath = useWorkspace((state) => currentWorkspace(state)?.projectPath)
  const [editor, setEditor, editorDialog] = useDialogState<{
    command?: QuickCommand
    scope?: QuickCommand['scope']['type']
  }>()
  const [deleting, setDeleting, deleteDialog] = useDialogState<QuickCommand>()
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
      await navigator.clipboard.writeText(entry.command)
      setCopiedId(entry.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => {
        setCopiedId(undefined)
      }, 1500)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove() {
    if (!deleteDialog.open || !deleting || saving.current) return
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

  const currentProjectCommands = projectPath
    ? commands.filter(
        (entry) => entry.scope.type === 'project' && entry.scope.projectPath === projectPath,
      )
    : []
  const globalCommands = commands.filter((entry) => entry.scope.type === 'global')
  const otherProjectCommands = commands.filter(
    (entry) => entry.scope.type === 'project' && entry.scope.projectPath !== projectPath,
  )

  const groups = [
    {
      id: 'current-project',
      title: projectPath ? `当前项目 · ${projectBasename(projectPath)}` : '当前项目',
      items: currentProjectCommands,
      presetScope: 'project' as const,
      showProjectBadge: false,
    },
    {
      id: 'global',
      title: '全局',
      items: globalCommands,
      presetScope: 'global' as const,
      showProjectBadge: false,
    },
    {
      id: 'other-projects',
      title: '其他项目',
      items: otherProjectCommands,
      presetScope: undefined,
      showProjectBadge: true,
    },
  ].filter((group) => group.items.length > 0)

  const atLimit = commands.length >= MAX_QUICK_COMMANDS

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
        {commands.length > 0 && (
          <span
            className="quick-commands-settings-count text-xs text-app-muted-foreground tabular-nums"
            aria-label={`已保存 ${commands.length} 条，上限 ${MAX_QUICK_COMMANDS} 条`}
          >
            {commands.length} / {MAX_QUICK_COMMANDS}
          </span>
        )}
      </header>
      {!commands.length ? (
        <Card size="sm" className="quick-commands-settings-card gap-0 py-0">
          <Empty className="quick-commands-empty py-10">
            <EmptyMedia variant="icon" className="quick-commands-empty-icon">
              <Terminal />
            </EmptyMedia>
            <EmptyHeader className="quick-commands-empty-header">
              <EmptyTitle className="quick-commands-empty-title">尚未保存快捷命令</EmptyTitle>
              <EmptyDescription className="quick-commands-empty-description">
                添加常用脚本或服务，从顶栏一键启动。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="quick-commands-empty-actions">
              <Button
                type="button"
                className="quick-commands-empty-add"
                disabled={pending}
                onClick={() => setEditor({})}
              >
                <Plus className="quick-commands-empty-add-icon" data-icon="inline-start" />
                新增命令
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="quick-commands-groups flex flex-col gap-6">
          {groups.map((group) => {
            const headingId = `quick-commands-group-${group.id}`
            return (
              <section
                key={group.id}
                className="quick-commands-group flex flex-col gap-2.5"
                aria-labelledby={headingId}
              >
                <header className="quick-commands-group-header flex items-center justify-between gap-3">
                  <div className="quick-commands-group-heading flex min-w-0 items-center gap-2">
                    <h2
                      id={headingId}
                      className="quick-commands-group-title settings-section-title truncate"
                    >
                      {group.title}
                    </h2>
                    <span className="quick-commands-group-count text-xs text-muted-foreground tabular-nums">
                      {group.items.length}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="quick-commands-group-add shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={pending || atLimit}
                    onClick={() => setEditor({ scope: group.presetScope })}
                  >
                    <Plus className="quick-commands-group-add-icon" data-icon="inline-start" />
                    新增
                  </Button>
                </header>
                <Card size="sm" className="quick-commands-settings-card gap-0 py-0">
                  <ul className="quick-commands-list divide-y divide-border">
                    {group.items.map((entry) => (
                      <li key={entry.id} className="quick-commands-list-item">
                        <div className="quick-commands-list-row group/row flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-muted/30">
                          <div className="quick-commands-list-main flex min-w-0 flex-1 items-center gap-3">
                            <span
                              className={cn(
                                'quick-commands-list-mode-icon flex size-7 shrink-0 items-center justify-center rounded-md bg-muted',
                                entry.mode === 'service'
                                  ? 'text-foreground'
                                  : 'text-muted-foreground',
                              )}
                              aria-hidden="true"
                            >
                              {entry.mode === 'service' ? (
                                <Server className="size-3.5" />
                              ) : (
                                <Play className="size-3.5" />
                              )}
                            </span>
                            <div className="quick-commands-list-content flex min-w-0 flex-1 flex-col gap-0.5">
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
                                {group.showProjectBadge && entry.scope.type === 'project' && (
                                  <Badge
                                    className="quick-commands-list-project max-w-full"
                                    variant="outline"
                                  >
                                    <span className="quick-commands-list-project-name truncate">
                                      {projectBasename(entry.scope.projectPath)}
                                    </span>
                                  </Badge>
                                )}
                              </div>
                              <code
                                className="quick-commands-list-command block truncate font-mono text-xs text-muted-foreground"
                                title={entry.command}
                              >
                                <span
                                  className="quick-commands-list-prompt mr-1 opacity-50 select-none"
                                  aria-hidden="true"
                                >
                                  $
                                </span>
                                {entry.command}
                              </code>
                            </div>
                          </div>
                          <div
                            className={cn(
                              'quick-commands-list-actions flex min-h-7 shrink-0 items-center gap-1',
                              copiedId === entry.id
                                ? 'opacity-100'
                                : 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100',
                            )}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="quick-commands-list-copy text-muted-foreground hover:text-foreground"
                              aria-label={
                                copiedId === entry.id ? '已复制命令' : `复制 ${entry.name} 命令`
                              }
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
                </Card>
              </section>
            )
          })}
        </div>
      )}
      <QuickCommandDialog
        {...editorDialog}
        command={editor?.command}
        projectPath={projectPath}
        initialScope={editor?.scope}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
      />
      <AlertDialog
        {...deleteDialog}
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
              删除命令
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
