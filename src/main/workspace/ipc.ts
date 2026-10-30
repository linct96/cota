import { dialog, shell, type BrowserWindow } from 'electron'
import type { WorkspaceLayout, WorkspaceTarget, WorktreeScan } from '../../shared/contracts'
import type { IpcHandler } from '../app/ipc'
import type { ConfigStore } from '../settings/config-store'
import type { AppLifecycle, RemovalTarget } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { HostClient } from '../host/host-client'
import type { WorktreeManager } from '../git/worktrees/manager'
import type { WorktreeSetupService } from '../git/worktrees/setup'
import type { GitResources } from '../git/ipc'
import { listWorkspaceOpeners, openWorkspaceWith } from '../system/open-with'
import { absolutePath, projectDirectory, workspaceRemoval } from '../validation'

export function registerWorkspaceIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  manager: HostClient
  worktrees: WorktreeManager
  worktreeSetups: WorktreeSetupService
  git: GitResources
  lifecycle: AppLifecycle
  renderer: AppRenderer
  getWindow(): BrowserWindow | undefined
  warning: string | undefined
}): void {
  const { handle, config, manager, worktrees, worktreeSetups, git, lifecycle, renderer } = deps
  const assertLifecycle = () => lifecycle.assertAvailable()

  async function removeTarget(target: RemovalTarget): Promise<boolean> {
    if (
      lifecycle.removingWorkspace ||
      worktrees.removing ||
      lifecycle.exitPending ||
      lifecycle.exiting ||
      lifecycle.closingTabs.size
    )
      return false
    if (
      config
        .snapshot()
        .worktreeRecords.some(
          (record) =>
            record.projectPath === target.projectPath &&
            (!target.workspaceId ||
              config
                .snapshot()
                .layout?.workspaces.some(
                  (workspace) =>
                    workspace.id === target.workspaceId && workspace.worktreeId === record.id,
                )) &&
            worktrees.initializing.has(record.id),
        )
    )
      throw new Error('请先停止项目中的工作树初始化，再删除工作区或项目。')
    lifecycle.removingWorkspace = target
    try {
      if (target.workspaceId) {
        await manager.request('closeWorkspace', [
          { projectPath: target.projectPath, workspaceId: target.workspaceId },
        ])
      } else {
        await manager.request('closeProject', [target.projectPath])
      }
      if (target.workspaceId) await config.closeWorkspace(target.workspaceId)
      if (target.removeProject) await config.forget(target.projectPath)
      return true
    } catch (error) {
      throw new Error(
        `删除未完成，${target.workspaceId ? '工作区' : '项目'}仍保留；部分终端可能已结束，请重试。${String(error)}`,
      )
    } finally {
      git.prune()
      lifecycle.removingWorkspace = undefined
    }
  }

  handle('app:bootstrap', async () => {
    renderer.ready = true
    const sessions = await manager.request('list', [])
    // A live Host session must not disappear just because its project aged out of recent items.
    for (const { projectPath } of sessions)
      if (!config.snapshot().recentProjects.includes(projectPath))
        await config.remember(projectPath)
    const initial = config.snapshot()
    const worktreeScans: Record<string, WorktreeScan> = Object.fromEntries(
      await Promise.all(
        [
          ...new Set([
            ...initial.recentProjects,
            ...initial.worktreeRecords.map((entry) => entry.projectPath),
          ]),
        ].map(async (path) => [path, await worktrees.scanWorktrees(path, sessions, true)]),
      ),
    )
    for (const session of sessions) {
      if (session.workspaceKind !== 'git-worktree') continue
      const snapshot = config.snapshot()
      const record = snapshot.worktreeRecords.find(
        (entry) =>
          entry.id === session.worktreeId &&
          entry.projectPath === session.projectPath &&
          entry.path === session.cwd &&
          entry.repoCommonDir === session.repoCommonDir,
      )
      if (
        record &&
        worktreeScans[record.projectPath]?.entries.some(
          (entry) => entry.record.id === record.id && entry.status === 'ready',
        ) &&
        !snapshot.layout?.workspaces.some(
          (entry) =>
            entry.id === session.workspaceId ||
            (entry.kind === 'git-worktree' && entry.worktreeId === record.id),
        )
      )
        await config.registerWorktree(record, {
          id: session.workspaceId,
          projectPath: session.projectPath,
          name: record.initialBranch || '恢复的 Worktree',
          kind: 'git-worktree',
          worktreeId: record.id,
        })
    }
    const snapshot = config.snapshot()
    await manager.request('setScrollback', [snapshot.preferences.scrollback])
    const result = {
      config: snapshot,
      sessions: await manager.request('list', []),
      warning: deps.warning,
      worktreeScans,
    }
    renderer.sendAgentFocus()
    return result
  })
  handle('workspace:save-layout', async (value: WorkspaceLayout) => {
    const previous = config.snapshot().layout?.workspaces || []
    await config.saveLayout(value)
    git.prune()
    const current = config.snapshot().layout?.workspaces || []
    const changed = [...previous, ...current].filter(
      (workspace) =>
        JSON.stringify(previous.find((entry) => entry.id === workspace.id)) !==
        JSON.stringify(current.find((entry) => entry.id === workspace.id)),
    )
    git.invalidateProjects(changed.map((workspace) => workspace.projectPath))
  })
  handle('project:open', async () => {
    const window = deps.getWindow()
    if (!window || window.isDestroyed()) throw new Error('当前没有可用窗口。')
    const selected = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const path = await projectDirectory(selected.filePaths[0])
    if (lifecycle.removingWorkspace) throw new Error('正在删除工作区，请稍后再打开目录。')
    await config.remember(path)
    return path
  })
  handle('project:select', async (value: unknown) => {
    const path = await projectDirectory(value)
    if (lifecycle.removingWorkspace) throw new Error('正在删除工作区，请稍后再切换。')
    if (
      !config.snapshot().recentProjects.includes(path) &&
      config.snapshot().worktreeRecords.some((record) => record.projectPath === path)
    )
      await config.remember(path)
  })
  handle('git:inspect-repository', (path: string) => worktrees.inspectRepository(path))
  handle('git:list-worktrees', (path: string) => worktrees.listWorktrees(path))
  handle('worktree-setup:config', (path: string) => worktreeSetups.definition(path))
  handle('worktree-setup:save-config', (path: string, value: unknown) => {
    assertLifecycle()
    worktreeSetups.definition(path)
    return config.saveWorktreeSetup(path, value)
  })
  handle('worktree-setup:inspect', (target: WorkspaceTarget) => worktreeSetups.inspect(target))
  handle('worktree-setup:start', (target: WorkspaceTarget, definition: unknown) => {
    assertLifecycle()
    if (lifecycle.removingWorkspace) throw new Error('工作区正在关闭。')
    return worktreeSetups.start(
      target,
      definition,
      (description) =>
        renderer.confirm({ title: '初始化工作树？', description, confirmLabel: '执行初始化' }),
      assertLifecycle,
    )
  })
  handle('worktree-setup:stop', (target: WorkspaceTarget) => worktreeSetups.stop(target))
  handle('git:plan-worktree', (input: unknown) => {
    assertLifecycle()
    return worktrees.planWorktree(input)
  })
  handle('git:suggest-worktree-name', (path: string) => {
    assertLifecycle()
    return worktrees.suggestName(path)
  })
  handle('git:scan-worktrees', async (path: string) =>
    worktrees.scanWorktrees(path, await manager.request('list', []), true),
  )
  handle('git:create-worktree', (input: unknown) => {
    assertLifecycle()
    return git.withBranchInvalidation(
      () => worktrees.createWorktree(input),
      typeof (input as { projectPath?: unknown })?.projectPath === 'string'
        ? (input as { projectPath: string }).projectPath
        : undefined,
    )
  })
  handle('git:link-worktree', (path: string, target: string) => {
    assertLifecycle()
    return git.withBranchInvalidation(() => worktrees.linkWorktree(path, target), path)
  })
  handle('git:inspect-removal', async (id: string) =>
    worktrees.inspectRemoval(id, await manager.request('list', [])),
  )
  handle('git:remove-worktree', (id: string, deleteBranch: unknown) => {
    assertLifecycle()
    if (lifecycle.closingTabs.size) throw new Error('终端正在关闭，请稍后再删除工作树。')
    if (typeof deleteBranch !== 'boolean') throw new Error('删除分支参数无效。')
    return git.withBranchInvalidation(
      () =>
        worktrees.removeWorktree(id, {
          deleteBranch,
          sessions: () => manager.request('list', []),
          close: (id) => manager.request('close', [id]),
          confirm: (check, force) => {
            let branchDescription = ''
            if (check.currentBranch)
              branchDescription = deleteBranch
                ? `同时删除本地分支 ${check.currentBranch}。`
                : '本地分支保留。'
            const forceBranchDescription =
              deleteBranch && check.currentBranch
                ? `同时强制删除本地分支 ${check.currentBranch}，未合并提交可能丢失。`
                : ''
            return renderer.confirm({
              title: force ? '强制删除工作树' : '删除工作树',
              description: force
                ? `将永久删除 ${check.worktreePath} 及关联工作区，丢弃未提交、未跟踪和忽略的文件，并结束关联终端。${forceBranchDescription}此操作可能无法恢复。`
                : `将删除 ${check.worktreePath} 及关联工作区，并结束关联终端。${branchDescription}`,
              confirmLabel: force ? '强制删除' : '删除',
            })
          },
        }),
      config.snapshot().worktreeRecords.find((record) => record.id === id)?.projectPath,
    )
  })
  handle('git:unlink-worktree', (id: string) => {
    assertLifecycle()
    if (lifecycle.closingTabs.size) throw new Error('终端正在关闭，请稍后再移除关联。')
    return git.withBranchInvalidation(
      () =>
        worktrees.unlinkWorktree(id, {
          sessions: () => manager.request('list', []),
          close: (id) => manager.request('close', [id]),
          confirm: () =>
            renderer.confirm({
              title: '移除工作区关联',
              description: '将结束关联终端并移除 Cota 工作区与登记，不删除工作树目录或本地分支。',
              confirmLabel: '删除',
            }),
        }),
      config.snapshot().worktreeRecords.find((record) => record.id === id)?.projectPath,
    )
  })
  handle('workspace:path', (target: WorkspaceTarget) =>
    worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
  )
  handle('workspace:openers', () => listWorkspaceOpeners(config.snapshot().preferences))
  handle('workspace:open-with', async (path: unknown, openerId: unknown) => {
    const directory =
      typeof path === 'string'
        ? absolutePath(path)
        : await worktrees.withTerminalTarget(
            path as WorkspaceTarget,
            async (binding) => binding.cwd,
          )
    const snapshot = config.snapshot()
    if (typeof path === 'string' && !snapshot.recentProjects.includes(directory))
      throw new Error('请先打开项目目录。')
    const systemFileManager = openerId === 'system-file-manager'
    const opener = snapshot.preferences.openWith.find((entry) => entry.id === openerId)
    if (!systemFileManager && !opener) throw new Error('打开方式不存在，请检查设置。')
    try {
      if (systemFileManager) {
        const error = await shell.openPath(await projectDirectory(directory))
        if (error) throw new Error(error)
      } else if (opener) {
        await openWorkspaceWith(directory, opener)
      }
    } catch (error) {
      await renderer.confirm({
        title: `无法使用 ${systemFileManager ? '文件管理器' : opener?.name} 打开工作区`,
        description: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })
  handle('workspace:remove', (value: unknown) => removeTarget(workspaceRemoval(value)))
  handle('project:remove', (value: unknown) =>
    removeTarget({ projectPath: absolutePath(value), removeProject: true }),
  )
}
