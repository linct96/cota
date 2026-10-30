import { app, shell } from 'electron'
import type { ConfigStore } from '../settings/config-store'
import type { HostClient } from '../host/host-client'
import type { WorktreeManager } from '../git/worktrees/manager'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler } from '../app/ipc'
import { workspaceTarget } from '../validation'
import { WorkspacePorts, requireOwnedPort } from './workspace-ports'
import { terminatePortProcess } from './terminate-port-process'

export function registerPortsIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  manager: HostClient
  worktrees: WorktreeManager
  lifecycle: AppLifecycle
  renderer: AppRenderer
}): WorkspacePorts {
  const { handle, config, manager, worktrees, lifecycle, renderer } = deps
  const assertLifecycle = () => lifecycle.assertAvailable()
  const workspacePorts = new WorkspacePorts(async () => {
    await config.flush()
    const snapshot = config.snapshot()
    const workspaces = (snapshot.layout?.workspaces ?? []).flatMap((workspace) => {
      if (!snapshot.recentProjects.includes(workspace.projectPath)) return []
      const record =
        workspace.kind === 'git-worktree'
          ? snapshot.worktreeRecords.find(
              (entry) =>
                entry.id === workspace.worktreeId && entry.projectPath === workspace.projectPath,
            )
          : undefined
      if (workspace.kind === 'git-worktree' && !record) return []
      return [
        {
          projectPath: workspace.projectPath,
          workspaceId: workspace.id,
          name: workspace.name,
          cwd: record?.path ?? workspace.projectPath,
        },
      ]
    })
    return { workspaces, roots: await manager.request('processRoots', []) }
  })
  const authorizePorts = async (value: unknown) => {
    assertLifecycle()
    const target = workspaceTarget(value)
    await config.flush()
    const snapshot = config.snapshot()
    if (
      !snapshot.recentProjects.includes(target.projectPath) ||
      !snapshot.layout?.workspaces.some(
        (entry) => entry.id === target.workspaceId && entry.projectPath === target.projectPath,
      )
    )
      throw new Error('工作区未保存或已移除，请重新选择。')
    assertLifecycle()
    return target
  }
  let stoppingPort = false
  const protectedPortPids = () => [
    process.pid,
    process.ppid,
    manager.pid ?? 0,
    ...app.getAppMetrics().map((entry) => entry.pid),
  ]
  handle('ports:stop', async (value: unknown, id: unknown) => {
    if (stoppingPort) throw new Error('正在关闭端口，请稍后重试。')
    stoppingPort = true
    try {
      const target = await authorizePorts(value)
      const before = await workspacePorts.scan(true)
      const port = requireOwnedPort(before, target, id, protectedPortPids())
      const affected = [
        ...new Set(before.ports.filter((row) => row.pid === port.pid).map((row) => row.port)),
      ]
      if (
        !(await renderer.confirm({
          title: `关闭端口 ${port.port}？`,
          description: `将强制终止 ${port.processName}（PID ${port.pid}）。\n此进程监听的端口：${affected.join('、')}。\n同一进程的所有端口都会关闭，未保存的数据可能丢失。不会递归终止子进程；若服务被自动重启，端口可能再次出现。`,
          confirmLabel: '终止进程并关闭端口',
        }))
      )
        return false
      await authorizePorts(target)
      return await worktrees.withTerminalTarget(target, async () => {
        const fresh = await workspacePorts.scan(true)
        await authorizePorts(target)
        const current = requireOwnedPort(fresh, target, id, protectedPortPids())
        if (fresh.ports.some((row) => row.pid === current.pid && !affected.includes(row.port)))
          throw new Error('此进程新增了监听端口，请刷新后重新确认。')
        assertLifecycle()
        terminatePortProcess(current)
        workspacePorts.invalidate()
        return true
      })
    } finally {
      stoppingPort = false
    }
  })
  handle('ports:scan', async (value: unknown) => {
    const target = await authorizePorts(value)
    const snapshot = await workspacePorts.scan()
    await authorizePorts(target)
    return snapshot
  })
  handle('ports:open', async (value: unknown, id: unknown) => {
    const target = await authorizePorts(value)
    const url = await workspacePorts.httpUrl(id)
    await authorizePorts(target)
    await shell.openExternal(url)
  })
  return workspacePorts
}
