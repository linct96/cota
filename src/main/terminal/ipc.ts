import { ipcMain, shell } from 'electron'
import type { AttachTerminal, CreateTerminal } from '../../shared/contracts'
import type { ConfigStore } from '../settings/config-store'
import type { AgentCliManagement } from '../agents/cli/management'
import type { HostClient } from '../host/host-client'
import type { WorktreeManager } from '../git/worktrees/manager'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler, TrustedIPC } from '../app/ipc'
import { startupCommand, terminalId, terminalLaunch } from '../validation'

export function registerTerminalIPC(deps: {
  handle: IpcHandler
  trusted: TrustedIPC
  config: ConfigStore
  manager: HostClient
  agentClis: AgentCliManagement
  worktrees: WorktreeManager
  lifecycle: AppLifecycle
  renderer: AppRenderer
}): void {
  const { handle, trusted, config, manager, agentClis, worktrees, lifecycle, renderer } = deps
  handle('terminal:create', (value: CreateTerminal) => {
    if (!value || typeof value !== 'object') throw new Error('终端参数无效。')
    if (
      lifecycle.removingWorkspace?.projectPath === value.projectPath &&
      (lifecycle.removingWorkspace.removeProject ||
        lifecycle.removingWorkspace.workspaceId === value.workspaceId)
    )
      throw new Error('正在删除此工作区，无法新建终端。')
    const launch = terminalLaunch(value)
    const command = startupCommand(value.startupCommand)
    if (command !== undefined && launch.kind === 'agent')
      throw new Error('快捷命令只能在新建 Shell 中执行。')
    const snapshot = config.snapshot()
    if (lifecycle.exiting || lifecycle.exitPending) throw new Error('应用正在退出。')
    return worktrees.withTerminalTarget(value, (binding) => {
      if (
        (lifecycle.removingWorkspace?.projectPath === value.projectPath &&
          (lifecycle.removingWorkspace.removeProject ||
            lifecycle.removingWorkspace.workspaceId === value.workspaceId)) ||
        worktrees.removing ||
        lifecycle.exiting ||
        lifecycle.exitPending
      )
        throw new Error('工作区正在关闭，无法新建终端。')
      const create = (agentCliCache?: import('../../shared/agent-cli').AgentCliCache) =>
        manager.request('create', [
          {
            id: value.id,
            cols: value.cols,
            rows: value.rows,
            ...binding,
            ...launch,
            ...(agentCliCache ? { agentCliCache } : {}),
            ...(command === undefined ? {} : { startupCommand: command }),
            ...(value.service === undefined ? {} : { service: value.service }),
          },
          snapshot.preferences,
        ])
      return launch.kind === 'agent'
        ? agentClis.run(launch.provider, snapshot.preferences, (_command, cache) => create(cache))
        : create()
    })
  })
  handle('service:stop', (id: string) => {
    lifecycle.assertAvailable()
    return manager.request('stopService', [terminalId(id)])
  })
  handle('service:open', async (id: string) => {
    lifecycle.assertAvailable()
    const session = (await manager.request('list', [])).find((entry) => entry.id === terminalId(id))
    if (!session?.service?.port || session.exited) throw new Error('服务未运行或未配置端口。')
    await shell.openExternal(`http://127.0.0.1:${session.service.port}`)
  })
  handle('terminal:attach', (value: AttachTerminal) => {
    if (!value || !config.snapshot().recentProjects.includes(value.projectPath))
      throw new Error('请先打开项目目录。')
    return worktrees.withTerminalTarget(value, (binding) =>
      manager.request('attach', [{ id: value.id, attachmentId: value.attachmentId, ...binding }]),
    )
  })
  handle('terminal:detach', (id: string, attachmentId: string) =>
    manager.request('detach', [id, attachmentId]),
  )
  handle('terminal:write', (id: string, data: string, encoding: 'utf8' | 'binary' = 'utf8') => {
    if (lifecycle.closingTabs.has(id)) throw new Error('终端正在关闭，暂不接受输入。')
    return manager.request('write', [id, data, encoding])
  })
  handle('terminal:resize', (id: string, cols: number, rows: number) =>
    manager.request('resize', [id, cols, rows]),
  )
  handle('terminal:close', async (value: unknown) => {
    const id = terminalId(value)
    if (
      lifecycle.closingTabs.has(id) ||
      lifecycle.exitPending ||
      lifecycle.removingWorkspace ||
      worktrees.removing
    )
      return false
    lifecycle.closingTabs.add(id)
    try {
      const needsConfirmation =
        config.snapshot().preferences.confirmCloseRunningTerminal &&
        (await manager.request('needsCloseConfirmation', [id]).catch(() => true))
      if (
        needsConfirmation &&
        !(await renderer.confirm({
          title: '关闭终端？',
          description:
            '将结束此终端及其中正在执行的程序（包括 Agent），终端输出不保留。其他终端不受影响。',
          confirmLabel: '结束并关闭终端',
        }))
      )
        return false
      await manager.request('close', [id])
      return true
    } finally {
      lifecycle.closingTabs.delete(id)
    }
  })
  ipcMain.on('terminal:ack', (event, id: string, attachmentId: string, length: number) => {
    try {
      trusted(event)
      void manager.request('acknowledge', [id, attachmentId, length]).catch(() => {})
    } catch {
      /* Ignore malformed fire-and-forget acknowledgements. */
    }
  })
}
