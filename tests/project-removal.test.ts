import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const frame = { url: 'http://localhost:5173/' }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    appEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
    rendererEvents: new Map<string, () => void>(),
    contents: {
      mainFrame: frame,
      setWindowOpenHandler: vi.fn(),
      on: (name: string, listener: () => void) => mocks.rendererEvents.set(name, listener),
      send: vi.fn(),
      isDestroyed: () => false,
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    },
    confirm: vi.fn(),
    list: vi.fn(),
    config: { preferences: { scrollback: 5000 }, recentProjects: [] as string[] },
    remember: vi.fn(),
    setScrollback: vi.fn(),
    hasLive: vi.fn(),
    needsCloseConfirmation: vi.fn(),
    close: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
    disconnect: vi.fn(),
    quit: vi.fn(),
    closeWorkspace: vi.fn(),
    closeProject: vi.fn(),
    forget: vi.fn(),
    create: vi.fn(),
  }
})
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    on: (name: string, listener: (event: { preventDefault(): void }) => void) =>
      mocks.appEvents.set(name, listener),
    quit: mocks.quit,
    whenReady: () => Promise.resolve(),
    setName: vi.fn(),
    setPath: vi.fn(),
    getPath: () => '/tmp/cota-removal-test',
    exit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = mocks.contents
    on = vi.fn()
    once = vi.fn()
    loadURL = vi.fn()
    isMinimized = () => false
    show = vi.fn()
    focus = vi.fn()
  },
  dialog: { showMessageBox: mocks.confirm, showErrorBox: vi.fn() },
  ipcMain: {
    handle: (channel: string, action: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mocks.handlers.set(channel, action)
    },
    on: vi.fn(),
  },
  nativeTheme: {},
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../src/main/config', () => ({
  ConfigStore: class {
    load = async () => ({})
    forget = mocks.forget
    flush = mocks.flush
    snapshot = () => structuredClone(mocks.config)
    remember = mocks.remember
  },
}))
vi.mock('../src/main/host-client', () => ({
  connectTerminalHost: async () => ({
    disconnect: mocks.disconnect,
    detachAll: vi.fn().mockResolvedValue(undefined),
    request: (method: string, args: unknown[]) => {
      if (method === 'closeWorkspace') return mocks.closeWorkspace(...args)
      if (method === 'closeProject') return mocks.closeProject(...args)
      if (method === 'create') return mocks.create(...args)
      if (method === 'list') return mocks.list()
      if (method === 'setScrollback') return mocks.setScrollback(...args)
      if (method === 'hasLive') return mocks.hasLive()
      if (method === 'needsCloseConfirmation') return mocks.needsCloseConfirmation(...args)
      if (method === 'close') return mocks.close(...args)
      if (method === 'shutdown') return mocks.shutdown()
      throw new Error(`Unexpected method: ${method}`)
    },
  }),
}))

const event = { sender: mocks.contents, senderFrame: mocks.contents.mainFrame }
const path = '/missing/中文 项目'
const target = {
  projectPath: path,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  removeProject: false,
}
const extra = {
  projectPath: path,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  removeProject: false,
}
const remove = (value: unknown = target) => mocks.handlers.get('workspace:remove')!(event, value)

beforeAll(async () => {
  vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
  try {
    await import('../src/main/index')
    await vi.waitFor(() => expect(mocks.handlers.has('workspace:remove')).toBe(true))
  } finally {
    vi.unstubAllEnvs()
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.closeWorkspace.mockResolvedValue(undefined)
  mocks.closeProject.mockResolvedValue(undefined)
  mocks.forget.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue([])
  mocks.config.recentProjects = []
  mocks.remember.mockImplementation(async (path: string) => {
    mocks.config.recentProjects.push(path)
  })
  mocks.setScrollback.mockResolvedValue(undefined)
  mocks.hasLive.mockResolvedValue(true)
  mocks.needsCloseConfirmation.mockResolvedValue(true)
  mocks.close.mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.shutdown.mockResolvedValue(undefined)
})

describe('workspace removal IPC', () => {
  it('keeps live Host projects discoverable even after recent-project eviction', async () => {
    const session = {
      id: target.workspaceId,
      workspaceId: target.workspaceId,
      projectPath: path,
      cols: 80,
      rows: 24,
      exited: false,
    }
    mocks.list.mockResolvedValueOnce([session, { ...session, id: extra.workspaceId }])
    const result = await mocks.handlers.get('app:bootstrap')!(event)
    expect(result).toEqual({
      ok: true,
      value: {
        config: { ...mocks.config, recentProjects: [path] },
        sessions: [session, { ...session, id: extra.workspaceId }],
        warning: undefined,
      },
    })
    expect(mocks.remember).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.setScrollback).toHaveBeenCalledExactlyOnceWith(5000)
  })
  it('closes all project workspaces before forgetting the project', async () => {
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: true,
    })
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.forget.mock.invocationCallOrder[0],
    )
    expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('blocks project and workspace deletion and terminal creation until project cleanup finishes', async () => {
    let finish!: () => void
    mocks.closeProject.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const pending = mocks.handlers.get('project:remove')!(event, path)
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: false,
    })
    expect(await mocks.handlers.get('terminal:create')!(event, extra)).toMatchObject({ ok: false })
    expect(mocks.forget).not.toHaveBeenCalled()
    finish()
    expect(await pending).toEqual({ ok: true, value: true })
  })
  it('retains project records when project cleanup fails and allows retry', async () => {
    mocks.closeProject.mockRejectedValueOnce(new Error('permission denied'))
    expect(await mocks.handlers.get('project:remove')!(event, path)).toMatchObject({
      ok: false,
      error: expect.stringContaining('项目仍保留'),
    })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: true,
    })
  })
  it.each(['../relative', null, ''])(
    'validates project deletion paths before cleanup: %j',
    async (value) => {
      expect(await mocks.handlers.get('project:remove')!(event, value)).toMatchObject({ ok: false })
      expect(mocks.closeProject).not.toHaveBeenCalled()
      expect(mocks.forget).not.toHaveBeenCalled()
    },
  )
  it('closes only the requested workspace without forgetting its project', async () => {
    expect(await remove()).toEqual({ ok: true, value: true })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.closeWorkspace).toHaveBeenCalledExactlyOnceWith({
      projectPath: target.projectPath,
      workspaceId: target.workspaceId,
    })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(mocks.closeProject).not.toHaveBeenCalled()
  })
  it('forgets the project only after closing its last workspace', async () => {
    expect(await remove({ ...target, removeProject: true })).toEqual({ ok: true, value: true })
    expect(mocks.closeWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.forget.mock.invocationCallOrder[0],
    )
    expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(path)
  })
  it('retains the last workspace when project persistence fails and allows retry', async () => {
    mocks.forget.mockRejectedValueOnce(new Error('disk full'))
    expect(await remove({ ...target, removeProject: true })).toEqual({
      ok: false,
      error: expect.stringContaining('工作区仍保留'),
    })
    expect(await remove({ ...target, removeProject: true })).toEqual({ ok: true, value: true })
  })
  it('retains the workspace when process cleanup fails and allows retry', async () => {
    mocks.closeWorkspace.mockRejectedValueOnce(new Error('permission denied'))
    expect(await remove()).toEqual({ ok: false, error: expect.stringContaining('工作区仍保留') })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(await remove()).toEqual({ ok: true, value: true })
  })
  it('blocks duplicate deletion and creates in that workspace, but permits sibling workspaces', async () => {
    let finish!: () => void
    mocks.closeWorkspace.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const pending = remove()
    expect(await remove()).toEqual({ ok: true, value: false })
    const create = mocks.handlers.get('terminal:create')!
    expect(await create(event, target)).toEqual({
      ok: false,
      error: expect.stringContaining('正在删除'),
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(await create(event, extra)).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenCalledOnce()
    finish()
    expect(await pending).toEqual({ ok: true, value: true })
  })
  it.each([
    null,
    path,
    {},
    { projectPath: '../relative', workspaceId: path },
    { projectPath: path },
    { projectPath: path, workspaceId: '../other' },
    { projectPath: path, workspaceId: '/different/project' },
  ])('rejects malformed targets before ending terminals: %j', async (value) => {
    expect(await remove(value)).toMatchObject({ ok: false })
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.forget).not.toHaveBeenCalled()
  })
  it('rejects invalid project-removal flags before ending terminals', async () => {
    expect(await remove({ ...target, removeProject: 'true' })).toMatchObject({ ok: false })
    expect(await remove({ projectPath: path, workspaceId: target.workspaceId })).toMatchObject({
      ok: false,
    })
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.forget).not.toHaveBeenCalled()
  })
  it('rejects untrusted senders before ending terminals', async () => {
    expect(await mocks.handlers.get('workspace:remove')!({ ...event, sender: {} }, target)).toEqual(
      {
        ok: false,
        error: '拒绝未授权的窗口请求。',
      },
    )
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
  })
})

describe('renderer confirmation IPC', () => {
  const quit = () => mocks.appEvents.get('before-quit')!({ preventDefault: vi.fn() })
  const reply = (id: unknown, confirmed: unknown, sender = event) =>
    mocks.handlers.get('app:confirm-response')!(sender, id, confirmed)
  const prompt = async () => {
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith('app:confirm', expect.any(Object)),
    )
    return mocks.contents.send.mock.calls.at(-1)![1] as {
      id: string
      title: string
      confirmLabel?: string
    }
  }

  beforeEach(async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
  })

  it('cancels quit without cleanup and rejects duplicate, malformed, stale and untrusted replies', async () => {
    quit()
    const request = await prompt()
    quit()
    expect(mocks.contents.send).toHaveBeenCalledOnce()
    expect(await reply(request.id, 'true')).toMatchObject({ ok: false })
    expect(await reply('stale', true)).toMatchObject({ ok: false })
    expect(await reply(request.id, true, { ...event, sender: {} } as typeof event)).toMatchObject({
      ok: false,
    })
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('terminal:create')!(event, target)).toMatchObject({ ok: false })
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(await reply(request.id, false)).toEqual({ ok: true, value: undefined })
    expect(await reply(request.id, true)).toMatchObject({ ok: false })
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })

  it.each(['did-start-loading', 'render-process-gone', 'destroyed'])(
    'cancels pending quit on %s and permits retry',
    async (name) => {
      quit()
      const request = await prompt()
      mocks.rendererEvents.get(name)!()
      await Promise.resolve()
      expect(await reply(request.id, true)).toMatchObject({ ok: false })
      expect(mocks.shutdown).not.toHaveBeenCalled()
      await mocks.handlers.get('app:bootstrap')!(event)
      mocks.contents.send.mockClear()
      quit()
      const retry = await prompt()
      expect(retry.id).not.toBe(request.id)
      await reply(retry.id, false)
    },
  )

  it('confirms busy terminal closure, cancels safely, and skips confirmation for idle or exited sessions', async () => {
    const close = () => mocks.handlers.get('terminal:close')!(event, target.workspaceId)
    mocks.needsCloseConfirmation.mockResolvedValue(true)
    const cancelled = close()
    const request = await prompt()
    expect(mocks.close).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('terminal:write')!(event, target.workspaceId, 'sleep 120\r'),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('正在关闭'),
    })
    expect(await close()).toEqual({ ok: true, value: false })
    await reply(request.id, false)
    expect(await cancelled).toEqual({ ok: true, value: false })
    mocks.contents.send.mockClear()
    const confirmed = close()
    await reply((await prompt()).id, true)
    expect(await confirmed).toEqual({ ok: true, value: true })
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(target.workspaceId)
    mocks.contents.send.mockClear()
    mocks.needsCloseConfirmation.mockResolvedValue(false)
    expect(await close()).toEqual({ ok: true, value: true })
    expect(mocks.contents.send).not.toHaveBeenCalled()
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
    quit()
    await reply((await prompt()).id, true)
    await vi.waitFor(() => expect(mocks.contents.send).toHaveBeenCalledTimes(2))
    const failure = await prompt()
    expect(failure.title).toContain('应用暂未退出')
    expect(failure.confirmLabel).toBeUndefined()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await reply(failure.id, false)
    mocks.contents.send.mockClear()
    quit()
    await reply((await prompt()).id, true)
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(mocks.flush.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.shutdown.mock.invocationCallOrder.at(-1)!,
    )
    expect(mocks.shutdown.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.disconnect.mock.invocationCallOrder[0],
    )
  })
})
