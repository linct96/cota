import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { Result } from '../../shared/contracts'
import type { AppLifecycle } from './lifecycle'
import { WorktreeError } from '../git/worktrees/git'
import { HostingError } from '../code-hosting/cli-runner'

export type IpcHandler = <Args extends unknown[], T>(
  channel: string,
  action: (...args: Args) => Promise<T> | T,
) => void

const exitChannels = new Set([
  'app:confirm-response',
  'app:exit-layout',
  'app:force-exit',
  'window:is-maximized',
  'workspace:save-layout',
  'terminal:detach',
  'git:unwatch',
  'git:release-branches',
  'git:cancel-commit-message',
  'files:unwatch',
  'agent:cli-install-detach',
  'agent:cli-install-ack',
])

const workspaceOperations = new Set([
  'terminal:create',
  'terminal:close',
  'workspace:remove',
  'project:remove',
  'git:create-worktree',
  'git:link-worktree',
  'git:remove-worktree',
  'git:unlink-worktree',
  'git:mutate',
  'worktree-setup:start',
  'code-hosting:create',
  'code-hosting:merge',
  'code-hosting:clear-creation',
  'agent:hooks-install',
  'agent:hooks-uninstall',
])

export function createIPC(
  getWindow: () => BrowserWindow | undefined,
  rendererURL: string | undefined,
  lifecycle: AppLifecycle,
) {
  function trusted(event: {
    sender: Electron.WebContents
    senderFrame: Electron.WebFrameMain | null
  }): void {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      // Hash routes share the same trusted renderer document.
      event.senderFrame.url.split('#')[0] !== rendererURL
    ) {
      throw new Error('拒绝未授权的窗口请求。')
    }
  }

  function handle<Args extends unknown[], T>(
    channel: string,
    action: (...args: Args) => Promise<T> | T,
  ): void {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
        let authorized = false
        const exitPending = () =>
          (!exitChannels.has(channel) ||
            (channel === 'workspace:save-layout' && lifecycle.layoutSealed)) &&
          (lifecycle.exitPending || lifecycle.exiting)
        try {
          trusted(event)
          authorized = true
          const startupError = lifecycle.startupError
          if (startupError && channel !== 'app:force-exit' && channel !== 'window:is-maximized')
            throw startupError
          if (exitPending()) await lifecycle.waitForExit()
          const run = () => action(...(args as Args))
          return {
            ok: true,
            value: await (workspaceOperations.has(channel) ? lifecycle.trackOperation(run) : run()),
          }
        } catch (error) {
          // In-flight refreshes can fail during teardown; do not surface them over a normal quit.
          if (authorized && !lifecycle.startupError && exitPending()) await lifecycle.waitForExit()
          return {
            ok: false,
            error: error instanceof Error ? error.message : '操作失败。',
            ...(error instanceof WorktreeError ? { code: error.code, details: error.details } : {}),
            ...(error instanceof HostingError ? { hostingFailure: error.kind } : {}),
          }
        }
      },
    )
  }
  return { handle, trusted }
}

export type TrustedIPC = ReturnType<typeof createIPC>['trusted']
