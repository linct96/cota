import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Check, ChevronDown, Copy, Pencil, Play, Plus, Settings2, Trash2 } from 'lucide-react'
import type { ProjectWorkspace, QuickCommand } from '../../../shared/contracts'
import { MAX_TERMINALS } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { QuickCommandDialog } from './QuickCommandDialog'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
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

export function QuickCommandsButton({ workspace }: { workspace: ProjectWorkspace }) {
  const router = useRouter()
  const commands = useWorkspace((state) => state.preferences.quickCommands)
  const recentId = useWorkspace((state) => state.recentQuickCommands[workspace.id])
  const unavailable = useWorkspace(
    (state) =>
      !!state.removingWorkspace ||
      state.creatingWorktree ||
      state.tabs.length >= MAX_TERMINALS ||
      (workspace.kind === 'git-worktree' &&
        state.worktreeScans[workspace.projectPath]?.entries.find(
          (entry) => entry.record.id === workspace.worktreeId,
        )?.status !== 'ready'),
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const [editor, setEditor] = useState<{ command?: QuickCommand }>()
  const [deleting, setDeleting] = useState<QuickCommand>()
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const deleteSaving = useRef(false)

  const [error, setError] = useState<string>()
  const [copiedId, setCopiedId] = useState<string>()
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const projectCommands = commands.filter(
    (entry) => entry.scope.type === 'project' && entry.scope.projectPath === workspace.projectPath,
  )
  const globalCommands = commands.filter((entry) => entry.scope.type === 'global')
  const visible = [...projectCommands, ...globalCommands]
  const recent = visible.find((entry) => entry.id === recentId) || visible[0]

  function run(command: QuickCommand) {
    try {
      useWorkspace.getState().runQuickCommand(command.id, workspace.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

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
    if (!deleting || deleteSaving.current) return
    deleteSaving.current = true
    setDeletePending(true)
    setDeleteError(undefined)
    try {
      const state = useWorkspace.getState()
      await state.savePreferences({
        ...state.preferences,
        quickCommands: state.preferences.quickCommands.filter((entry) => entry.id !== deleting.id),
      })
      setDeleting(undefined)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      deleteSaving.current = false
      setDeletePending(false)
    }
  }

  return (
    <>
      <ButtonGroup className="quick-commands-control mr-2 shrink-0" aria-label="快捷命令">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="quick-commands-run"
          disabled={unavailable || (!recent && commands.length >= 50)}
          title={
            unavailable
              ? '工作区不可用、正在关闭或终端数量已达上限'
              : recent?.command || '新增快捷命令'
          }
          aria-label={recent ? `在新终端运行 ${recent.name}` : '新增快捷命令'}
          onClick={() => (recent ? run(recent) : setEditor({}))}
        >
          <Play className="quick-commands-run-icon" data-icon="inline-start" />
          <span className="quick-commands-run-name max-w-32 truncate">
            {recent?.name || '快捷命令'}
          </span>
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="quick-commands-menu-trigger"
                aria-label="选择快捷命令"
              />
            }
          >
            <ChevronDown className="quick-commands-menu-chevron" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="quick-commands-menu flex w-84 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-1.5"
          >
            <div className="quick-commands-list max-h-80 min-h-0 overflow-y-auto overscroll-contain">
              {(
                [
                  ['当前项目', projectCommands],
                  ['全局', globalCommands],
                ] as const
              ).map(
                ([label, entries]) =>
                  entries.length > 0 && (
                    <DropdownMenuGroup
                      key={label}
                      className="quick-commands-options pb-1"
                      aria-label={label}
                    >
                      <div className="quick-commands-group-label px-2.5 pt-2 pb-1">{label}</div>
                      {entries.map((entry) => (
                        <DropdownMenuItem
                          key={entry.id}
                          className="quick-commands-option group/option relative flex items-center justify-between gap-2 px-2.5 py-1.5"
                          disabled={unavailable}
                          onClick={() => run(entry)}
                        >
                          <div className="quick-commands-option-main flex min-w-0 flex-1 items-start gap-2.5">
                            <Play className="quick-commands-option-icon mt-0.5 shrink-0" />
                            <div className="quick-commands-option-content flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="quick-commands-option-name truncate leading-5 font-medium">
                                {entry.name}
                              </span>
                              <span className="quick-commands-option-command truncate font-mono text-[11px] leading-4 text-muted-foreground">
                                {entry.command}
                              </span>
                            </div>
                          </div>
                          <div
                            className="quick-commands-option-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/option:opacity-100 group-focus-within/option:opacity-100 group-data-[highlighted]/option:opacity-100"
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="quick-commands-option-action quick-commands-option-copy h-6 w-6 rounded p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={
                                copiedId === entry.id ? '已复制命令' : `复制 ${entry.name} 命令`
                              }
                              onClick={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                void copy(entry)
                              }}
                            >
                              {copiedId === entry.id ? (
                                <Check className="quick-commands-item-copied-icon size-3 text-emerald-500" />
                              ) : (
                                <Copy className="quick-commands-item-copy-icon size-3" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="quick-commands-option-action quick-commands-option-edit h-6 w-6 rounded p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`编辑 ${entry.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                setMenuOpen(false)
                                setEditor({ command: entry })
                              }}
                            >
                              <Pencil className="quick-commands-item-edit-icon size-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="quick-commands-option-action quick-commands-option-delete h-6 w-6 rounded p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`删除 ${entry.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                setMenuOpen(false)
                                setDeleteError(undefined)
                                setDeleting(entry)
                              }}
                            >
                              <Trash2 className="quick-commands-item-delete-icon size-3" />
                            </Button>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  ),
              )}
            </div>
            {visible.length > 0 && (
              <DropdownMenuSeparator className="quick-commands-separator mx-0 my-1 shrink-0" />
            )}
            <DropdownMenuGroup className="quick-commands-management shrink-0">
              <DropdownMenuItem
                className="quick-commands-add gap-3 px-2.5 py-2"
                disabled={commands.length >= 50}
                onClick={() => {
                  setMenuOpen(false)
                  setEditor({})
                }}
              >
                <Plus className="quick-commands-add-icon" />
                新增命令…
              </DropdownMenuItem>
              <DropdownMenuItem
                className="quick-commands-manage gap-3 px-2.5 py-2"
                onClick={() => {
                  setMenuOpen(false)
                  void router.navigate({ to: '/settings', search: { section: 'quick-commands' } })
                }}
              >
                <Settings2 className="quick-commands-manage-icon" />
                管理命令…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <QuickCommandDialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
        command={editor?.command}
        projectPath={workspace.projectPath}
      />
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open, details) => {
          if (deleteSaving.current) details.cancel()
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
          {deleteError && (
            <p role="alert" className="quick-command-delete-error text-xs text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter className="quick-command-delete-footer">
            <AlertDialogCancel className="quick-command-delete-cancel" disabled={deletePending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="quick-command-delete-confirm"
              variant="destructive"
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault()
                void remove()
              }}
            >
              {deletePending ? '删除中…' : '删除命令'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!error}
        onOpenChange={(open) => {
          if (!open) setError(undefined)
        }}
      >
        <AlertDialogContent className="quick-commands-error-dialog">
          <AlertDialogHeader className="quick-commands-error-header">
            <AlertDialogTitle className="quick-commands-error-title">
              无法运行快捷命令
            </AlertDialogTitle>
            <AlertDialogDescription className="quick-commands-error-description">
              {error}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="quick-commands-error-footer">
            <AlertDialogCancel className="quick-commands-error-close">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
