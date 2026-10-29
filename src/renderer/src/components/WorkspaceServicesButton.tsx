import { useRef, useState } from 'react'
import { ExternalLink, RotateCw, Server, Square, TerminalSquare } from 'lucide-react'
import { MAX_TERMINALS, unwrap } from '../../../shared/contracts'
import { useWorkspace, type TerminalTab } from '../store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

export function WorkspaceServicesButton({ workspaceId }: { workspaceId: string }) {
  const tabs = useWorkspace((state) => state.tabs)
  const definitions = useWorkspace((state) => state.preferences.quickCommands)
  const unavailable = useWorkspace((state) => !!state.removingWorkspace || state.creatingWorktree)
  const services = tabs.filter((tab) => tab.workspaceId === workspaceId && tab.service)
  const running = services.filter((tab) => tab.status === 'running' || tab.status === 'starting')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string>()
  const busy = useRef(false)
  const [error, setError] = useState<string>()

  async function act(tab: TerminalTab, action: 'stop' | 'restart' | 'open') {
    if (busy.current) return
    busy.current = true
    setPending(tab.id)
    setError(undefined)
    try {
      const state = useWorkspace.getState()
      if (action === 'open') unwrap(await window.desktop.openService(tab.id))
      else {
        if (action === 'restart' && state.tabs.length >= MAX_TERMINALS)
          throw new Error('终端数量已达上限，请先关闭旧日志或其他终端。')
        if (
          action === 'restart' &&
          !state.preferences.quickCommands.some(
            (entry) => entry.id === tab.service?.commandId && entry.mode === 'service',
          )
        )
          throw new Error('服务定义已删除或改为普通命令，请重新配置。')
        if (tab.status === 'running') {
          unwrap(await window.desktop.stopService(tab.id))
          useWorkspace.getState().updateTab(tab.id, { status: 'exited' })
        }
        if (action === 'restart') {
          useWorkspace.getState().runQuickCommand(tab.service!.commandId, workspaceId)
          setOpen(false)
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busy.current = false
      setPending(undefined)
    }
  }

  if (!services.length) return null
  return (
    <>
      <Button
        className="workspace-services-trigger shrink-0 tabular-nums"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(undefined)
          setOpen(true)
        }}
      >
        <Server className="workspace-services-icon" data-icon="inline-start" />
        服务 {running.length}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="workspace-services-dialog max-h-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader className="workspace-services-header">
            <DialogTitle className="workspace-services-title">工作区服务</DialogTitle>
            <DialogDescription className="workspace-services-description">
              运行中仅表示进程尚未退出，不代表服务已就绪。关闭面板不停止服务；日志保留在原终端中。
            </DialogDescription>
          </DialogHeader>
          <div className="workspace-services-list flex flex-col gap-3">
            {services.map((tab) => (
              <div
                className="workspace-service-row flex flex-wrap items-center justify-between gap-3"
                key={tab.id}
              >
                <div className="workspace-service-summary grid min-w-0 flex-1 gap-0.5">
                  <span className="workspace-service-name truncate text-xs font-medium text-foreground">
                    {tab.service!.name}
                  </span>
                  <span className="workspace-service-status text-xs tabular-nums text-muted-foreground">
                    {tab.status === 'starting'
                      ? '启动中'
                      : tab.status === 'running'
                        ? '运行中'
                        : tab.status === 'error'
                          ? '启动失败'
                          : `已结束${tab.exitCode === undefined ? '' : ` · 退出码 ${tab.exitCode}`}`}
                    {tab.service!.port ? ` · 端口 ${tab.service!.port}` : ''}
                  </span>
                </div>
                <div className="workspace-service-actions flex flex-wrap gap-1">
                  <Button
                    className="workspace-service-logs"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      useWorkspace.getState().selectTab(tab.id)
                      setOpen(false)
                    }}
                  >
                    <TerminalSquare
                      className="workspace-service-logs-icon"
                      data-icon="inline-start"
                    />
                    日志
                  </Button>
                  <Button
                    className="workspace-service-open"
                    variant="outline"
                    size="sm"
                    disabled={
                      !!pending || unavailable || tab.status !== 'running' || !tab.service!.port
                    }
                    onClick={() => void act(tab, 'open')}
                  >
                    <ExternalLink
                      className="workspace-service-open-icon"
                      data-icon="inline-start"
                    />
                    打开
                  </Button>
                  <Button
                    className="workspace-service-restart"
                    variant="outline"
                    size="sm"
                    disabled={
                      !!pending ||
                      unavailable ||
                      tab.status === 'starting' ||
                      !!tab.closingStatus ||
                      !definitions.some(
                        (entry) => entry.id === tab.service!.commandId && entry.mode === 'service',
                      )
                    }
                    onClick={() => void act(tab, 'restart')}
                  >
                    <RotateCw className="workspace-service-restart-icon" data-icon="inline-start" />
                    重启
                  </Button>
                  <Button
                    className="workspace-service-stop"
                    variant="destructive"
                    size="sm"
                    disabled={
                      !!pending || unavailable || tab.status !== 'running' || !!tab.closingStatus
                    }
                    onClick={() => void act(tab, 'stop')}
                  >
                    <Square className="workspace-service-stop-icon" data-icon="inline-start" />
                    {pending === tab.id ? '处理中…' : '停止'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {error && (
            <p className="workspace-services-error text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
