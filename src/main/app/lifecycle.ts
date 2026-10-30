import { app, dialog, type BrowserWindow } from 'electron'
import type { ConfigStore } from '../settings/config-store'
import type { AccountService } from '../accounts/service'
import type { WorktreeManager } from '../git/worktrees/manager'
import type { WorktreeSetupService } from '../git/worktrees/setup'
import type { AgentSleepPrevention } from '../agents/runtime/sleep-prevention'
import type { CommitMessageService } from '../git/commit-message/service'
import type { AgentCliInstallTerminals } from '../agents/cli/install-terminal'
import { forceStopTerminalHost, type HostClient } from '../host/host-client'
import type { AppRenderer } from './renderer'

export type RemovalTarget = { projectPath: string; workspaceId?: string; removeProject: boolean }

export class AppLifecycle {
  startupError: Error | undefined
  exiting = false
  exitPending = false
  removingWorkspace: RemovalTarget | undefined
  readonly closingTabs = new Set<string>()

  constructor(
    private readonly dependencies: {
      getWindow(): BrowserWindow | undefined
      getManager(): HostClient | undefined
      getConfig(): ConfigStore | undefined
      getWorktrees(): WorktreeManager | undefined
      getWorktreeSetups(): WorktreeSetupService | undefined
      getAccounts(): AccountService | undefined
      closeResources(): void
      renderer: AppRenderer
      agentSleep: AgentSleepPrevention
      commitMessages: CommitMessageService
      cliInstallTerminals?: AgentCliInstallTerminals
    },
  ) {}

  assertAvailable(): void {
    if (
      this.removingWorkspace ||
      this.dependencies.getWorktrees()?.removing ||
      this.exitPending ||
      this.exiting
    )
      throw new Error('正在关闭或移除工作区，请稍后重试。')
  }

  async requestForceExit(): Promise<void> {
    if (this.exitPending || this.exiting) return
    this.exitPending = true
    let response: number
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '强制关闭 Cota？',
        message: '强制关闭 Cota？',
        detail:
          '将结束当前应用的所有终端、后台任务及 Terminal Host，清理完成后关闭应用。未保存的内容可能丢失。',
        buttons: ['取消', '强制关闭'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      response = result.response
    } finally {
      this.exitPending = false
    }
    if (response === 1) await this.forceExit()
  }

  async forceExit(): Promise<void> {
    if (this.exitPending || this.exiting) return
    this.exitPending = true
    const deps = this.dependencies
    try {
      deps.renderer.settleConfirmation(false)
      await deps.cliInstallTerminals?.close()
      await deps.getWorktreeSetups()?.close()
      await deps.getConfig()?.flush()
      deps.closeResources()
      await deps.commitMessages.close()
      await forceStopTerminalHost(app.getPath('userData'))
      deps.getManager()?.disconnect()
      await deps.getAccounts()?.close()
      deps.agentSleep.dispose()
      this.exiting = true
      app.exit(0)
    } finally {
      this.exitPending = false
    }
  }

  async requestExit(): Promise<void> {
    const deps = this.dependencies
    if (
      this.exitPending ||
      this.exiting ||
      this.closingTabs.size ||
      this.removingWorkspace ||
      deps.getWorktrees()?.removing
    )
      return
    try {
      if (this.startupError) {
        await this.requestForceExit()
        return
      }
      this.exitPending = true
      const worktreeSetups = deps.getWorktreeSetups()!
      const manager = deps.getManager()!
      const window = deps.getWindow()
      if (
        deps.cliInstallTerminals?.running ||
        worktreeSetups.running ||
        (await manager.request('hasLive', []))
      ) {
        const title = '退出 Cota？'
        const description = '退出将结束所有终端及运行中的程序，项目设置将会保留。'
        const confirmLabel = '结束终端并退出'
        if (deps.renderer.ready && window && !window.webContents.isDestroyed()) {
          if (!(await deps.renderer.confirm({ title, description, confirmLabel }))) return
        } else {
          // Keep exit available when the renderer cannot display the shadcn dialog.
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            title,
            message: title,
            detail: description,
            buttons: ['取消', confirmLabel],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          })
          if (response !== 1) return
        }
      }
      await deps.cliInstallTerminals?.close()
      await worktreeSetups.close()
      await deps.getConfig()!.flush()
      await manager.request('shutdown', [])
      await deps.commitMessages.close()
      manager.disconnect()
      deps.closeResources()
      await deps.getAccounts()!.close()
      deps.agentSleep.dispose()
      this.exiting = true
      app.quit()
    } catch (error) {
      const window = deps.getWindow()
      if (deps.renderer.ready && window && !window.webContents.isDestroyed()) {
        await deps.renderer.confirm({
          title: '退出失败',
          description: `终端清理失败，应用暂未退出。\n${String(error)}`,
        })
      } else {
        await dialog.showMessageBox({
          type: 'error',
          title: '退出失败',
          message: '终端清理失败，应用暂未退出。',
          detail: String(error),
          buttons: ['知道了'],
          noLink: true,
        })
      }
    } finally {
      this.exitPending = false
    }
  }
}
