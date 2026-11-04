import { app, dialog, type BrowserWindow } from 'electron'
import type { AppExitProgress } from '../../shared/contracts'
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
  exitConfirming = false
  layoutSealed = false
  removingWorkspace: RemovalTarget | undefined
  readonly closingTabs = new Set<string>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly exitWaiters = new Set<() => void>()

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

  assertAvailable(readOnly = false): void {
    // Reads already serialize and revalidate through the repository gate, not the global removal lock.
    if (
      (!readOnly && (this.removingWorkspace || this.dependencies.getWorktrees()?.removing)) ||
      this.exitPending ||
      this.exiting
    )
      throw new Error('正在关闭或移除工作区，请稍后重试。')
  }

  async trackOperation<T>(action: () => Promise<T> | T): Promise<T> {
    const operation = Promise.resolve(action())
    this.operations.add(operation)
    try {
      return await operation
    } finally {
      this.operations.delete(operation)
    }
  }

  async waitForExit(): Promise<void> {
    // Successful quit never resumes renderer requests; a cancelled or failed quit does.
    while (this.exitPending || this.exiting)
      await new Promise<void>((resolve) => this.exitWaiters.add(resolve))
  }

  private progress(description: string, keepSessions: boolean): void {
    this.dependencies.renderer.quitting = true
    this.dependencies.renderer.send('app:exit-progress', {
      title: keepSessions ? '正在退出 Cota' : '正在结束任务并退出',
      description,
      keepSessions,
    } satisfies AppExitProgress)
  }

  private async saveExitLayout(): Promise<void> {
    const layout = await this.dependencies.renderer.captureExitLayout()
    this.layoutSealed = true
    const config = this.dependencies.getConfig()
    if (layout !== undefined) await config?.saveLayout(layout)
    await config?.flush()
  }

  private finishExit(): void {
    this.exitConfirming = false
    this.exitPending = false
    if (this.exiting) return
    this.layoutSealed = false
    this.dependencies.renderer.quitting = false
    this.dependencies.renderer.send('app:exit-progress', null)
    for (const resolve of this.exitWaiters) resolve()
    this.exitWaiters.clear()
  }

  async requestForceExit(): Promise<void> {
    if (this.exitConfirming || this.exitPending || this.exiting) return
    this.exitConfirming = true
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
      this.exitConfirming = false
    }
    if (response === 1) await this.forceExit()
  }

  async forceExit(): Promise<void> {
    if (this.exitConfirming || this.exitPending || this.exiting) return
    this.exitPending = true
    const deps = this.dependencies
    try {
      deps.renderer.settleConfirmation(false)
      this.progress('正在停止 CLI 安装与更新', false)
      // Hooks inspection can be queued behind an install; stop it before waiting for operations.
      await deps.cliInstallTerminals?.close()
      this.progress('正在等待工作区操作完成', false)
      await Promise.allSettled([...this.operations])
      this.progress('正在停止后台任务', false)
      await deps.getWorktreeSetups()?.close()
      await deps.commitMessages.close()
      await this.saveExitLayout()
      deps.closeResources()
      await forceStopTerminalHost(app.getPath('userData'))
      deps.getManager()?.disconnect()
      await deps.getAccounts()?.close()
      await deps.getConfig()?.flush()
      deps.agentSleep.dispose()
      this.exiting = true
      app.exit(0)
    } finally {
      this.finishExit()
    }
  }

  async requestExit(stopSessions = false): Promise<void> {
    const deps = this.dependencies
    if (this.exitConfirming || this.exitPending || this.exiting) return
    if (stopSessions && this.startupError) {
      await this.requestForceExit()
      return
    }
    this.exitConfirming = stopSessions
    try {
      const manager = deps.getManager()
      const window = deps.getWindow()
      if (stopSessions) {
        const title = '结束全部任务并退出 Cota？'
        const description =
          '将结束所有终端及运行中的程序，终端输出不保留，未保存的内容可能丢失。普通退出会保留终端会话。'
        const confirmLabel = '结束任务并退出'
        if (deps.renderer.ready && window && !window.webContents.isDestroyed()) {
          if (!(await deps.renderer.confirm({ title, description, confirmLabel }))) return
        } else {
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
      this.exitConfirming = false
      this.exitPending = true
      deps.renderer.settleConfirmation(false)
      this.progress('正在停止 CLI 安装与更新', !stopSessions)
      // Hooks inspection can be queued behind an install; stop it before waiting for operations.
      await deps.cliInstallTerminals?.close()
      this.progress('正在等待工作区操作完成', !stopSessions)
      await Promise.allSettled([...this.operations])
      this.progress('正在清理界面后台任务', !stopSessions)
      await deps.getWorktreeSetups()?.close()
      await deps.commitMessages.close()
      this.progress('正在保存设置与工作区布局', !stopSessions)
      await this.saveExitLayout()
      if (stopSessions) {
        this.progress('正在依次结束终端和程序', false)
        await manager?.request('shutdown', [])
      }
      deps.closeResources()
      await deps.getAccounts()?.close()
      if (!stopSessions) {
        this.progress('正在断开界面连接，终端任务继续运行', true)
        // Closing the socket also detaches on the Host, even if its acknowledgement is lost.
        await manager?.detachAll().catch((error) => console.warn('终端视图断开失败', error))
      }
      await deps.getConfig()?.flush()
      manager?.disconnect()
      deps.agentSleep.dispose()
      this.exiting = true
      app.quit()
    } catch (error) {
      deps.renderer.quitting = false
      deps.renderer.send('app:exit-progress', null)
      const window = deps.getWindow()
      if (deps.renderer.ready && window && !window.webContents.isDestroyed()) {
        await deps.renderer.confirm({
          title: '退出失败',
          description: `退出清理失败，应用暂未退出。\n${String(error)}`,
        })
      } else {
        await dialog.showMessageBox({
          type: 'error',
          title: '退出失败',
          message: '退出清理失败，应用暂未退出。',
          detail: String(error),
          buttons: ['知道了'],
          noLink: true,
        })
      }
    } finally {
      this.finishExit()
    }
  }
}
