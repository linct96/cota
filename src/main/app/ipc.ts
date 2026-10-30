import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { Result } from '../../shared/contracts'
import { WorktreeError } from '../git/worktrees/git'
import { HostingError } from '../code-hosting/cli-runner'

export type IpcHandler = <Args extends unknown[], T>(
  channel: string,
  action: (...args: Args) => Promise<T> | T,
) => void

export function createIPC(
  getWindow: () => BrowserWindow | undefined,
  rendererURL: string | undefined,
  getStartupError: () => Error | undefined,
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
        try {
          trusted(event)
          const startupError = getStartupError()
          if (startupError && channel !== 'app:force-exit' && channel !== 'window:is-maximized')
            throw startupError
          return { ok: true, value: await action(...(args as Args)) }
        } catch (error) {
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
