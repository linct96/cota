import {
  blockHookInspectionUntilInstallStops,
  event,
  extra,
  mocks,
  path,
  remove,
  stopAllAndQuit,
  target,
} from './ipc.fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

describe('renderer confirmation IPC', () => {
  const quit = () => mocks.appEvents.get('before-quit')!({ preventDefault: vi.fn() })
  const reply = (id: unknown, confirmed: unknown, sender = event) =>
    mocks.handlers.get('app:confirm-response')!(sender, id, confirmed)
  const prompt = async () => {
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith('app:confirm', expect.any(Object)),
    )
    return mocks.contents.send.mock.calls
      .filter(([channel]) => channel === 'app:confirm')
      .at(-1)![1] as {
      id: string
      title: string
      confirmLabel?: string
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    mocks.handlers.clear()
    vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
    try {
      await import('../../../src/main/index')
      await vi.waitFor(() => expect(mocks.handlers.has('workspace:remove')).toBe(true))
    } finally {
      vi.unstubAllEnvs()
    }
    await mocks.handlers.get('app:bootstrap')!(event)
  })

  it('cancels terminal closure and rejects duplicate, malformed, stale and untrusted replies', async () => {
    const close = () => mocks.handlers.get('terminal:close')!(event, target.workspaceId)
    const closing = close()
    const request = await prompt()
    expect(await close()).toEqual({ ok: true, value: false })
    expect(mocks.contents.send).toHaveBeenCalledOnce()
    expect(await reply(request.id, 'true')).toMatchObject({ ok: false })
    expect(await reply('stale', true)).toMatchObject({ ok: false })
    expect(await reply(request.id, true, { ...event, sender: {} } as typeof event)).toMatchObject({
      ok: false,
    })
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('terminal:write')!(event, target.workspaceId, 'echo test\r'),
    ).toMatchObject({ ok: false })
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(await reply(request.id, false)).toEqual({ ok: true, value: undefined })
    expect(await closing).toEqual({ ok: true, value: false })
    expect(await reply(request.id, true)).toMatchObject({ ok: false })
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })

  it('quits silently after workspace cleanup, defers refreshes, and disconnects without stopping sessions', async () => {
    await blockHookInspectionUntilInstallStops()
    let finishRemoval!: () => void
    let finishDetach!: () => void
    mocks.closeWorkspace.mockReturnValueOnce(
      new Promise<void>((resolve) => (finishRemoval = resolve)),
    )
    mocks.detachAll.mockReturnValueOnce(new Promise<void>((resolve) => (finishDetach = resolve)))
    const removing = remove()
    quit()
    quit()
    let refreshed = false
    void mocks.handlers.get('git:status')!(event, extra).then(() => (refreshed = true))
    await new Promise(setImmediate)
    expect(mocks.contents.send).toHaveBeenCalledWith(
      'app:exit-progress',
      expect.objectContaining({ keepSessions: true, description: '正在等待工作区操作完成' }),
    )
    expect(refreshed).toBe(false)
    expect(mocks.closeCliInstalls).toHaveBeenCalledOnce()
    expect(mocks.gitStatus).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('git:status')!({ ...event, sender: {} }, extra)).toMatchObject({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    finishRemoval()
    expect(await removing).toEqual({ ok: true, value: true })
    await vi.waitFor(() => expect(mocks.detachAll).toHaveBeenCalledOnce())
    expect(mocks.quit).not.toHaveBeenCalled()
    finishDetach()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.detachAll.mock.invocationCallOrder[0],
    )
    expect(mocks.flush.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.disconnect.mock.invocationCallOrder[0],
    )
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(mocks.forceStopHost).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.contents.send).not.toHaveBeenCalledWith('app:confirm', expect.anything())
    expect(refreshed).toBe(false)
  })

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'])(
    'uses native stop-all confirmation after %s without locking refreshes before confirmation',
    async (name) => {
      mocks.rendererEvents.get(name)!(
        name === 'did-start-navigation' ? { isMainFrame: true, isSameDocument: false } : undefined,
      )
      let cancel!: (result: { response: number }) => void
      mocks.confirm.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            cancel = resolve
          }),
      )
      stopAllAndQuit()
      await vi.waitFor(() =>
        expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            type: 'warning',
            buttons: ['取消', '结束任务并退出'],
            defaultId: 0,
            cancelId: 0,
          }),
        ),
      )
      quit()
      expect(mocks.confirm).toHaveBeenCalledOnce()
      expect(mocks.contents.send).not.toHaveBeenCalledWith('app:confirm', expect.anything())
      expect(mocks.shutdown).not.toHaveBeenCalled()
      mocks.gitStatus.mockResolvedValueOnce({ files: [] })
      let refreshed = false
      const refresh = mocks.handlers.get('git:status')!(event, extra)
      void refresh.then(() => (refreshed = true))
      await new Promise(setImmediate)
      expect(refreshed).toBe(true)
      cancel({ response: 0 })
      expect(await refresh).toEqual({ ok: true, value: { files: [] } })
      await new Promise(setImmediate)
      expect(mocks.flush).not.toHaveBeenCalled()
      expect(mocks.quit).not.toHaveBeenCalled()
      mocks.confirm.mockResolvedValueOnce({ response: 0 })
      stopAllAndQuit()
      await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2))
      await new Promise(setImmediate)
      expect(mocks.shutdown).not.toHaveBeenCalled()
    },
  )

  it('keeps in-flight writes available before stop-all confirmation and cancels without a closing error', async () => {
    let continueMutation!: () => void
    mocks.withTerminalTarget.mockImplementationOnce(async (_target, action) => {
      await new Promise<void>((resolve) => (continueMutation = resolve))
      return action({ cwd: path })
    })
    mocks.gitMutate.mockResolvedValueOnce(true)
    const mutation = mocks.handlers.get('git:mutate')!(event, { ...target, action: 'stage' })
    stopAllAndQuit()
    const request = await prompt()
    quit()
    expect(
      mocks.contents.send.mock.calls.filter(([channel]) => channel === 'app:confirm'),
    ).toHaveLength(1)
    continueMutation()
    expect(await mutation).toEqual({ ok: true, value: true })
    expect(mocks.shutdown).not.toHaveBeenCalled()
    await reply(request.id, false)
    await new Promise(setImmediate)
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.closeCliInstalls).not.toHaveBeenCalled()
  })

  it('captures and seals the final layout, defers late saves, and flushes after detach', async () => {
    let finishDetach!: () => void
    mocks.detachAll.mockReturnValueOnce(new Promise<void>((resolve) => (finishDetach = resolve)))
    mocks.contents.send.mockImplementation(() => {})
    quit()
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:exit-layout-request',
        expect.any(String),
      ),
    )
    const id = mocks.contents.send.mock.calls.find(
      ([channel]) => channel === 'app:exit-layout-request',
    )![1]
    const respond = (candidateId: unknown, layout: unknown, sender = event) =>
      mocks.handlers.get('app:exit-layout')!(sender, candidateId, layout)
    expect(await respond('stale', {})).toMatchObject({ ok: false })
    expect(await respond(id, {}, { ...event, sender: {} } as typeof event)).toMatchObject({
      ok: false,
    })
    const layout = { workspaces: [], tabs: [], selectedWorkspaces: {}, activeTabs: {} }
    let finishSave!: () => void
    mocks.saveLayout.mockReturnValueOnce(new Promise<void>((resolve) => (finishSave = resolve)))
    expect(await respond(id, layout)).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(mocks.saveLayout).toHaveBeenCalledExactlyOnceWith(layout))
    expect(await respond(id, layout)).toMatchObject({ ok: false })
    expect(mocks.detachAll).not.toHaveBeenCalled()
    finishSave()
    await vi.waitFor(() => expect(mocks.detachAll).toHaveBeenCalledOnce())
    let lateSaved = false
    void mocks.handlers.get('workspace:save-layout')!(event, layout).then(() => (lateSaved = true))
    await new Promise(setImmediate)
    expect(lateSaved).toBe(false)
    expect(mocks.saveLayout).toHaveBeenCalledOnce()
    const flushesBeforeDetach = mocks.flush.mock.calls.length
    finishDetach()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(mocks.flush.mock.calls.length).toBeGreaterThan(flushesBeforeDetach)
    expect(mocks.flush.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.disconnect.mock.invocationCallOrder[0],
    )
    expect(mocks.saveLayout).toHaveBeenCalledOnce()
    expect(lateSaved).toBe(false)
  })

  it.each(['timeout', 'renderer disconnect', 'save failure'])(
    'aborts exit and permits retry when final layout capture fails: %s',
    async (failure) => {
      mocks.contents.send.mockImplementation(() => {})
      mocks.confirm.mockResolvedValue({ response: 0 })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        quit()
        await vi.waitFor(() =>
          expect(mocks.contents.send).toHaveBeenCalledWith(
            'app:exit-layout-request',
            expect.any(String),
          ),
        )
        const id = mocks.contents.send.mock.calls.find(
          ([channel]) => channel === 'app:exit-layout-request',
        )![1]
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10001)
        else if (failure === 'renderer disconnect')
          mocks.rendererEvents.get('render-process-gone')!()
        else {
          mocks.saveLayout.mockRejectedValueOnce(new Error('save failed'))
          await mocks.handlers.get('app:exit-layout')!(event, id, {})
        }
        if (failure === 'renderer disconnect') {
          await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
        } else {
          const request = await prompt()
          expect(request.title).toBe('退出失败')
          await reply(request.id, false)
        }
        await new Promise(setImmediate)
        expect(mocks.quit).not.toHaveBeenCalled()
        expect(mocks.disconnect).not.toHaveBeenCalled()
        expect(await mocks.handlers.get('app:exit-layout')!(event, id, {})).toMatchObject({
          ok: false,
        })
        expect(await mocks.handlers.get('workspace:save-layout')!(event, {})).toMatchObject({
          ok: true,
        })
        mocks.contents.send.mockImplementation((channel: string, value: unknown) => {
          if (channel === 'app:exit-layout-request')
            void mocks.handlers.get('app:exit-layout')!(event, value, undefined)
        })
        quit()
        await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('keeps refreshes available during terminal confirmation and cleanup, preserves close guards, and skips idle confirmation', async () => {
    const close = () => mocks.handlers.get('terminal:close')!(event, target.workspaceId)
    const checkClosing = async () => {
      mocks.gitStatus.mockResolvedValueOnce({ files: [] })
      expect(await mocks.handlers.get('git:status')!(event, target)).toEqual({
        ok: true,
        value: { files: [] },
      })
      mocks.gitReferences.mockRejectedValueOnce(new Error('Git unavailable'))
      expect(await mocks.handlers.get('git:branch-snapshot')!(event, target, randomUUID())).toEqual(
        {
          ok: false,
          error: 'Git unavailable',
        },
      )
      expect(
        await mocks.handlers.get('terminal:write')!(event, target.workspaceId, 'sleep 120\r'),
      ).toMatchObject({ ok: false, error: expect.stringContaining('正在关闭') })
      expect(await close()).toEqual({ ok: true, value: false })
      expect(await remove()).toEqual({ ok: true, value: false })
      for (const channel of ['git:remove-worktree', 'git:unlink-worktree'])
        expect(await mocks.handlers.get(channel)!(event, target.workspaceId, false)).toMatchObject({
          ok: false,
          error: expect.stringContaining('终端正在关闭'),
        })
    }
    mocks.needsCloseConfirmation.mockResolvedValue(true)
    const cancelled = close()
    const request = await prompt()
    expect(mocks.close).not.toHaveBeenCalled()
    await checkClosing()
    await reply(request.id, false)
    expect(await cancelled).toEqual({ ok: true, value: false })
    mocks.contents.send.mockClear()
    let finish!: () => void
    mocks.close.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    const confirmed = close()
    await reply((await prompt()).id, true)
    try {
      await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce())
      await checkClosing()
    } finally {
      finish()
      await confirmed
    }
    expect(await confirmed).toEqual({ ok: true, value: true })
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(target.workspaceId)
    mocks.contents.send.mockClear()
    mocks.needsCloseConfirmation.mockResolvedValue(false)
    expect(await close()).toEqual({ ok: true, value: true })
    expect(mocks.contents.send).not.toHaveBeenCalled()

    mocks.config.preferences.confirmCloseRunningTerminal = false
    mocks.needsCloseConfirmation.mockClear().mockResolvedValue(true)
    mocks.close.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    const withoutConfirmation = close()
    try {
      await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(3))
      await checkClosing()
    } finally {
      finish()
      await withoutConfirmation
    }
    expect(await withoutConfirmation).toEqual({ ok: true, value: true })
    expect(mocks.needsCloseConfirmation).not.toHaveBeenCalled()
    expect(mocks.contents.send).not.toHaveBeenCalled()
    mocks.config.preferences.confirmCloseRunningTerminal = true
    const reconfirmed = close()
    await reply((await prompt()).id, false)
    expect(await reconfirmed).toEqual({ ok: true, value: false })
    expect(mocks.close).toHaveBeenCalledTimes(3)
  })

  it('still asks before closing when process inspection is unavailable', async () => {
    mocks.needsCloseConfirmation.mockRejectedValueOnce(new Error('Host unavailable'))
    const closing = mocks.handlers.get('terminal:close')!(event, target.workspaceId)
    await reply((await prompt()).id, false)
    expect(await closing).toEqual({ ok: true, value: false })
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('preserves the application after failed cleanup, then flushes and shuts down only after confirmation', async () => {
    mocks.shutdown.mockRejectedValueOnce(new Error('cleanup failed'))
    stopAllAndQuit()
    const request = await prompt()
    expect(request).toMatchObject({
      title: '结束全部任务并退出 Cota？',
      confirmLabel: '结束任务并退出',
    })
    mocks.contents.send.mockClear()
    await reply(request.id, true)
    const failure = await prompt()
    expect(failure).toMatchObject({
      title: '退出失败',
      description: '退出清理失败，应用暂未退出。\nError: cleanup failed',
    })
    expect(failure.confirmLabel).toBeUndefined()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await reply(failure.id, false)
    await new Promise(setImmediate)
    mocks.contents.send.mockClear()
    stopAllAndQuit()
    await reply((await prompt()).id, true)
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(mocks.flush.mock.invocationCallOrder.at(-2)).toBeLessThan(
      mocks.shutdown.mock.invocationCallOrder.at(-1)!,
    )
    expect(mocks.shutdown.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.disconnect.mock.invocationCallOrder[0],
    )
  })
})
