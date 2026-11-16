import {
  blockHookInspectionUntilInstallStops,
  event,
  mocks,
  remove,
  stopAllAndQuit,
} from './ipc.fixture'
import { describe, expect, it, vi } from 'vitest'

async function startApp() {
  vi.resetModules()
  mocks.handlers.clear()
  vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
  try {
    await import('../../../src/main/index')
    await vi.waitFor(() => expect(mocks.handlers.has('workspace:remove')).toBe(true))
  } finally {
    vi.unstubAllEnvs()
  }
}

const forceExit = (sender = event) => mocks.handlers.get('app:force-exit')!(sender)

describe('error recovery force exit', () => {
  it('rejects an untrusted force-exit request before showing confirmation', async () => {
    await startApp()
    expect(await forceExit({ ...event, sender: {} } as typeof event)).toMatchObject({ ok: false })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.forceStopHost).not.toHaveBeenCalled()
  })

  it('coalesces native confirmations and does not clean up after cancellation', async () => {
    await startApp()
    let cancel: ((result: { response: number }) => void) | undefined
    mocks.confirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          cancel = resolve
        }),
    )
    const cancelled = forceExit()
    try {
      await forceExit()
      expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ buttons: ['取消', '强制关闭'], defaultId: 0, cancelId: 0 }),
      )
      cancel!({ response: 0 })
      expect(await cancelled).toEqual({ ok: true, value: undefined })
      expect(mocks.flush).not.toHaveBeenCalled()
      expect(mocks.forceStopHost).not.toHaveBeenCalled()
      expect(mocks.exit).not.toHaveBeenCalled()
    } finally {
      mocks.confirm.mockReset().mockResolvedValue({ response: 0 })
      cancel?.({ response: 0 })
      await cancelled
    }
  })

  it('retries a failed flush and Host cleanup before disconnecting and exiting', async () => {
    await startApp()
    await blockHookInspectionUntilInstallStops()
    mocks.confirm.mockResolvedValue({ response: 1 })
    mocks.flush.mockRejectedValueOnce(new Error('save failed'))
    expect(await forceExit()).toMatchObject({ ok: false, error: 'save failed' })
    expect(mocks.forceStopHost).not.toHaveBeenCalled()
    mocks.forceStopHost.mockRejectedValueOnce(new Error('cleanup failed'))
    expect(await forceExit()).toMatchObject({ ok: false, error: 'cleanup failed' })
    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await forceExit()
    expect(mocks.forceStopHost).toHaveBeenCalledWith('/tmp/cota-removal-test')
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(mocks.forceStopHost.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.disconnect.mock.invocationCallOrder[0],
    )
    expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exit.mock.invocationCallOrder[0],
    )
    expect(mocks.contents.send).not.toHaveBeenCalledWith('app:confirm', expect.anything())
  })

  it('waits for pending Host cleanup and coalesces repeated force-exit requests', async () => {
    await startApp()
    await blockHookInspectionUntilInstallStops()
    mocks.confirm.mockResolvedValue({ response: 1 })
    vi.useFakeTimers()
    let finish: (() => void) | undefined
    mocks.forceStopHost.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const closing = forceExit()
    try {
      await vi.waitFor(() => expect(mocks.forceStopHost).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5001)
      expect(mocks.exit).not.toHaveBeenCalled()
      expect(mocks.disconnect).not.toHaveBeenCalled()
      await forceExit()
      expect(mocks.forceStopHost).toHaveBeenCalledOnce()
      finish!()
      expect(await closing).toEqual({ ok: true, value: undefined })
      expect(mocks.forceStopHost).toHaveBeenCalledWith('/tmp/cota-removal-test')
      expect(mocks.shutdown).not.toHaveBeenCalled()
      expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0)
      expect(mocks.forceStopHost.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mocks.disconnect.mock.invocationCallOrder[0],
      )
      expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.exit.mock.invocationCallOrder[0],
      )
      expect(mocks.contents.send).not.toHaveBeenCalledWith('app:confirm', expect.anything())
    } finally {
      mocks.forceStopHost.mockReset().mockResolvedValue(undefined)
      finish?.()
      vi.useRealTimers()
      await closing
    }
  })

  it('blocks unavailable Host operations and untrusted exit after startup failure', async () => {
    mocks.connectFailure = new Error('Terminal Host 协议版本不兼容，请先结束旧会话。')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await startApp()
      await vi.waitFor(() => expect(mocks.loadRenderer).toHaveBeenCalledOnce())
      expect(mocks.loadRenderer).toHaveBeenCalledWith(mocks.contents.mainFrame.url)
      expect(mocks.confirm).not.toHaveBeenCalled()
      expect(mocks.forceStopHost).not.toHaveBeenCalled()
      const failure = { ok: false, error: mocks.connectFailure.message }
      expect(await mocks.handlers.get('app:bootstrap')!(event)).toEqual(failure)
      expect(await remove()).toEqual(failure)
      expect(await mocks.handlers.get('terminal:create')!(event, {})).toEqual(failure)
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.saveWorkspaceClosure).not.toHaveBeenCalled()
      expect(() =>
        mocks.rendererEvents.get('did-start-navigation')!({
          isMainFrame: true,
          isSameDocument: false,
        }),
      ).not.toThrow()
      expect(await forceExit({ ...event, sender: {} } as typeof event)).toMatchObject({ ok: false })
      expect(mocks.confirm).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      mocks.connectFailure = undefined
    }
  })

  it('confirms and retries cleanup of an incompatible Host before closing', async () => {
    mocks.connectFailure = new Error('Terminal Host 协议版本不兼容，请先结束旧会话。')
    mocks.confirm.mockResolvedValue({ response: 0 })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let finish: (() => void) | undefined
    let closing: Promise<unknown> | undefined
    try {
      await startApp()
      await vi.waitFor(() => expect(mocks.loadRenderer).toHaveBeenCalledOnce())
      const preventDefault = vi.fn()
      stopAllAndQuit()
      await new Promise(setImmediate)
      expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ buttons: ['取消', '强制关闭'] }),
      )
      expect(mocks.forceStopHost).not.toHaveBeenCalled()
      expect(mocks.exit).not.toHaveBeenCalled()
      expect(mocks.quit).not.toHaveBeenCalled()

      mocks.confirm.mockResolvedValue({ response: 1 })
      mocks.forceStopHost.mockRejectedValueOnce(new Error('cleanup failed'))
      expect(await forceExit()).toEqual({ ok: false, error: 'cleanup failed' })
      expect(mocks.exit).not.toHaveBeenCalled()
      mocks.forceStopHost.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      )
      closing = forceExit()
      await new Promise(setImmediate)
      expect(mocks.forceStopHost).toHaveBeenCalledTimes(2)
      mocks.appEvents.get('before-quit')!({ preventDefault })
      await forceExit()
      expect(mocks.confirm).toHaveBeenCalledTimes(3)
      expect(mocks.exit).not.toHaveBeenCalled()
      finish!()
      expect(await closing).toEqual({ ok: true, value: undefined })
      expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0)
      expect(mocks.forceStopHost).toHaveBeenLastCalledWith('/tmp/cota-removal-test')
      expect(mocks.shutdown).not.toHaveBeenCalled()
      expect(mocks.disconnect).not.toHaveBeenCalled()
    } finally {
      mocks.forceStopHost.mockReset().mockResolvedValue(undefined)
      finish?.()
      await closing
      log.mockRestore()
      mocks.connectFailure = undefined
    }
  })
})
