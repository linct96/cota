import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Network,
  RotateCw,
  Square,
  TerminalSquare,
} from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { WorkspacePort, WorkspacePortSnapshot } from '../../../shared/workspace-ports'
import { useWorkspace } from '../store'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { cn } from '../lib/utils'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet'

function WorkspacePortsPanel({
  workspace,
  close,
  actionBusy,
  onActionBusyChange,
}: {
  workspace: ProjectWorkspace
  close(): void
  actionBusy: RefObject<boolean>
  onActionBusyChange(busy: boolean): void
}) {
  const workspaces = useWorkspace((state) => state.workspaces)
  const tabs = useWorkspace((state) => state.tabs)
  const unavailable = useWorkspace((state) => !!state.removingWorkspace || state.creatingWorktree)
  const [snapshot, setSnapshot] = useState<WorkspacePortSnapshot>()
  const [pending, setPending] = useState(true)
  const refreshing = useLoadingIndicator(pending && !!snapshot)
  const [error, setError] = useState<string>()
  const [acting, setActing] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [stoppingPid, setStoppingPid] = useState<number>()
  const stopping = useLoadingIndicator(acting && stoppingPid !== undefined)
  const refresh = useRef<() => void>(() => {})
  const target = { projectPath: workspace.projectPath, workspaceId: workspace.id }

  useEffect(() => {
    let alive = true
    let busy = false
    const scan = async () => {
      if (!alive || busy || actionBusy.current || document.visibilityState === 'hidden') return
      busy = true
      setPending(true)
      setError(undefined)
      try {
        const result = unwrap(
          await window.desktop.scanWorkspacePorts({
            projectPath: workspace.projectPath,
            workspaceId: workspace.id,
          }),
        )
        if (alive) setSnapshot(result)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        busy = false
        if (alive) setPending(false)
      }
    }
    refresh.current = () => void scan()
    void scan()
    const timer = setInterval(() => void scan(), 5000)
    const resume = () => void scan()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      alive = false
      refresh.current = () => {}
      clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [workspace.projectPath, workspace.id, actionBusy])

  async function act(port: WorkspacePort, action: 'copy' | 'open' | 'terminal' | 'stop') {
    if (actionBusy.current || unavailable) return
    onActionBusyChange(true)
    setActing(true)
    setStoppingPid(action === 'stop' ? port.pid : undefined)
    setNotice(undefined)
    try {
      if (action === 'copy') {
        unwrap(await window.desktop.writeClipboard(port.httpUrl ?? port.connectAddress))
        setNotice('地址已复制。')
      } else if (action === 'open') unwrap(await window.desktop.openWorkspacePort(target, port.id))
      else if (action === 'stop') {
        const stopped = unwrap(await window.desktop.stopWorkspacePort(target, port.id))
        if (stopped) setNotice(`已向进程 ${port.pid} 发送终止请求，正在刷新端口。`)
      } else {
        const state = useWorkspace.getState()
        const terminal = state.tabs.find(
          (tab) => tab.id === port.owner?.terminalId && !tab.closingStatus,
        )
        if (!terminal || !(await state.selectProject(terminal.projectPath, terminal.workspaceId)))
          throw new Error('无法定位终端，工作区可能已关闭或移除。')
        useWorkspace.getState().selectTab(terminal.id)
        close()
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      onActionBusyChange(false)
      setActing(false)
      if (action === 'stop') refresh.current()
    }
  }

  function rows(ports: WorkspacePort[]) {
    return ports.map((port) => {
      const owner = port.owner
      const ownerWorkspace =
        owner &&
        workspaces.find(
          (entry) => entry.id === owner.workspaceId && entry.projectPath === owner.projectPath,
        )
      const terminal = owner?.terminalId
        ? tabs.find(
            (tab) =>
              tab.id === owner.terminalId &&
              tab.workspaceId === owner.workspaceId &&
              tab.projectPath === owner.projectPath &&
              !tab.closingStatus,
          )
        : undefined
      return (
        <li className="workspace-port-row flex flex-col gap-2 py-3 text-xs" key={port.id}>
          <div className="workspace-port-summary flex min-w-0 items-baseline gap-3">
            <span className="workspace-port-number font-mono text-sm font-medium tabular-nums">
              {port.port}
            </span>
            <span
              className="workspace-port-process truncate font-medium text-foreground"
              title={port.processName}
            >
              {port.processName}
            </span>
            <span className="workspace-port-pid ml-auto shrink-0 tabular-nums text-muted-foreground">
              PID {port.pid}
            </span>
          </div>
          <span className="workspace-port-address break-all font-mono tabular-nums text-muted-foreground">
            监听 {port.address.includes(':') ? `[${port.address}]` : port.address}:{port.port}
          </span>
          <span className="workspace-port-owner text-muted-foreground">
            {owner
              ? `${ownerWorkspace?.name ?? '其他工作区'} · ${owner.evidence === 'terminal' ? '终端进程关联' : '目录推断'}`
              : '未能确定工作区归属'}
          </span>
          <div className="workspace-port-actions flex flex-wrap gap-1">
            <Button
              className="workspace-port-copy"
              variant="outline"
              size="sm"
              disabled={acting || unavailable}
              onClick={() => void act(port, 'copy')}
              aria-label={`复制端口 ${port.port} 的地址`}
            >
              <Copy className="workspace-port-copy-icon" data-icon="inline-start" />
              复制地址
            </Button>
            <Button
              className="workspace-port-open"
              variant="outline"
              size="sm"
              disabled={acting || unavailable || !port.httpUrl}
              onClick={() => void act(port, 'open')}
              aria-label={`用 HTTP 打开端口 ${port.port}`}
            >
              <ExternalLink className="workspace-port-open-icon" data-icon="inline-start" />
              HTTP 打开
            </Button>
            {owner?.workspaceId === workspace.id && owner.projectPath === workspace.projectPath && (
              <Button
                className="workspace-port-stop"
                variant="destructive"
                size="sm"
                disabled={acting || unavailable || pending || !!error}
                onClick={() => void act(port, 'stop')}
                aria-label={`关闭端口 ${port.port} 并终止进程 ${port.pid}`}
              >
                <Square className="workspace-port-stop-icon" data-icon="inline-start" />
                {stoppingPid === port.pid && stopping ? '关闭中…' : '关闭端口'}
              </Button>
            )}
            {terminal && (
              <Button
                className="workspace-port-terminal"
                variant="ghost"
                size="sm"
                disabled={acting || unavailable}
                onClick={() => void act(port, 'terminal')}
              >
                <TerminalSquare className="workspace-port-terminal-icon" data-icon="inline-start" />
                定位终端
              </Button>
            )}
          </div>
        </li>
      )
    })
  }

  const ports = snapshot?.ports ?? []
  const belongsToCurrent = (port: WorkspacePort) =>
    port.owner?.workspaceId === workspace.id && port.owner.projectPath === workspace.projectPath
  const current = ports.filter(belongsToCurrent)
  const other = ports.filter((port) => port.owner && !belongsToCurrent(port))
  const unknown = ports.filter((port) => !port.owner)

  return (
    <div className="workspace-ports-panel flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 text-xs">
      <div className="workspace-ports-toolbar flex flex-wrap items-center justify-between gap-2">
        <span className="workspace-ports-updated tabular-nums text-muted-foreground">
          {snapshot
            ? `更新于 ${new Date(snapshot.scannedAt).toLocaleTimeString()}`
            : '尚未完成扫描'}
        </span>
        <Button
          className="workspace-ports-refresh"
          variant="outline"
          size="sm"
          disabled={pending || acting || unavailable}
          onClick={() => refresh.current()}
        >
          <RotateCw
            className={cn('workspace-ports-refresh-icon', refreshing && 'motion-safe:animate-spin')}
            data-icon="inline-start"
          />
          刷新
        </Button>
      </div>
      {error && (
        <Alert className="workspace-ports-error" variant="destructive">
          <AlertDescription className="workspace-ports-error-description">
            {error}
            {snapshot ? ' 当前显示上次成功扫描的结果。' : ''}
          </AlertDescription>
        </Alert>
      )}
      {snapshot?.warnings.map((message) => (
        <Alert className="workspace-ports-warning" key={message}>
          <AlertDescription className="workspace-ports-warning-description">
            {message}
          </AlertDescription>
        </Alert>
      ))}
      {notice && <output className="workspace-ports-notice text-muted-foreground">{notice}</output>}
      <LoadingContent pending={pending && !snapshot} label="端口扫描中…">
        <div className="workspace-ports-results min-h-0 flex-1 overflow-y-auto">
          {snapshot && (
            <>
              <section
                className="workspace-ports-current flex flex-col gap-2"
                aria-labelledby="workspace-ports-current-title"
              >
                <h3
                  className="workspace-ports-current-title text-xs font-medium tabular-nums"
                  id="workspace-ports-current-title"
                >
                  当前工作区 · {current.length}
                </h3>
                {current.length ? (
                  <ul className="workspace-ports-current-list divide-y">{rows(current)}</ul>
                ) : (
                  <Empty className="workspace-ports-empty">
                    <EmptyHeader className="workspace-ports-empty-header">
                      <EmptyTitle className="workspace-ports-empty-title">
                        未发现关联端口
                      </EmptyTitle>
                      <EmptyDescription className="workspace-ports-empty-description">
                        启动开发服务后刷新；归属不明的监听项可在下方查看。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </section>
              {[
                { label: '其他工作区', ports: other },
                { label: '其他本地端口', ports: unknown },
              ].map((group) => (
                <Collapsible className="workspace-ports-other mt-4" key={group.label}>
                  <CollapsibleTrigger
                    className="workspace-ports-other-trigger group w-full justify-start tabular-nums"
                    render={<Button variant="ghost" />}
                  >
                    <ChevronRight
                      className="workspace-ports-other-icon group-aria-expanded:rotate-90"
                      data-icon="inline-start"
                    />
                    {group.label} · {group.ports.length}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="workspace-ports-other-content">
                    <ul className="workspace-ports-other-list divide-y">{rows(group.ports)}</ul>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </>
          )}
        </div>
      </LoadingContent>
    </div>
  )
}

export function WorkspacePortsButton({ workspace }: { workspace: ProjectWorkspace }) {
  const [open, setOpen] = useState(false)
  const actionBusy = useRef(false)
  const unavailable = useWorkspace((state) => !!state.removingWorkspace || state.creatingWorktree)
  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        if (!next && actionBusy.current) {
          details.cancel()
          return
        }
        setOpen(next)
      }}
    >
      <SheetTrigger
        render={
          <Button
            className="workspace-ports-trigger shrink-0"
            variant="outline"
            size="sm"
            disabled={unavailable}
          />
        }
      >
        <Network className="workspace-ports-trigger-icon" data-icon="inline-start" />
        端口
      </SheetTrigger>
      <SheetContent className="workspace-ports-sheet sm:max-w-xl">
        <SheetHeader className="workspace-ports-header pr-12">
          <SheetTitle className="workspace-ports-title">{workspace.name} · 端口</SheetTitle>
          <SheetDescription className="workspace-ports-description">
            本机 TCP 监听端口，每 5 秒刷新。监听不代表服务就绪或支持 HTTP；关闭面板不停止服务。
          </SheetDescription>
        </SheetHeader>
        {open && (
          <WorkspacePortsPanel
            workspace={workspace}
            close={() => setOpen(false)}
            actionBusy={actionBusy}
            onActionBusyChange={(busy) => {
              actionBusy.current = busy
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
