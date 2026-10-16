import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const frame = { url: 'http://localhost:5173/' }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    contents: {
      mainFrame: frame,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    },
    confirm: vi.fn(),
    closeProject: vi.fn(),
    forget: vi.fn(),
    create: vi.fn(),
  }
})
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    setName: vi.fn(),
    getPath: () => '/tmp/cota-removal-test',
    exit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = mocks.contents
    on = vi.fn()
    once = vi.fn()
    loadURL = vi.fn()
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
    snapshot = () => ({ preferences: {}, recentProjects: [] })
  },
}))
vi.mock('../src/main/terminals', () => ({
  TerminalManager: class {
    closeProject = mocks.closeProject
    create = mocks.create
  },
}))

const event = { sender: mocks.contents, senderFrame: mocks.contents.mainFrame }
const path = '/missing/中文 项目'
const remove = (value: unknown = path) => mocks.handlers.get('project:remove')!(event, value)

beforeAll(async () => {
  vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
  try {
    await import('../src/main/index')
    await vi.waitFor(() => expect(mocks.handlers.has('project:remove')).toBe(true))
  } finally {
    vi.unstubAllEnvs()
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue({ response: 1 })
  mocks.closeProject.mockResolvedValue(undefined)
  mocks.forget.mockResolvedValue(undefined)
})

describe('project removal IPC', () => {
  it('defaults to cancellation and changes nothing when cancelled', async () => {
    mocks.confirm.mockResolvedValueOnce({ response: 0 })
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringContaining('不会删除本地文件'),
      }),
    )
    expect(mocks.closeProject).not.toHaveBeenCalled()
    expect(mocks.forget).not.toHaveBeenCalled()
  })
  it('closes project terminals before forgetting even a missing directory', async () => {
    expect(await remove()).toEqual({ ok: true, value: true })
    expect(mocks.closeProject).toHaveBeenCalledWith(path)
    expect(mocks.forget).toHaveBeenCalledWith(path)
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.forget.mock.invocationCallOrder[0],
    )
  })
  it('retains project records when process cleanup fails and allows retry', async () => {
    mocks.closeProject.mockRejectedValueOnce(new Error('permission denied'))
    expect(await remove()).toEqual({ ok: false, error: expect.stringContaining('项目记录仍保留') })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(await remove()).toEqual({ ok: true, value: true })
  })
  it('reports persistence failure instead of claiming deletion succeeded', async () => {
    mocks.forget.mockRejectedValueOnce(new Error('disk full'))
    expect(await remove()).toEqual({
      ok: false,
      error: expect.stringContaining('部分终端可能已结束'),
    })
    expect(await remove()).toEqual({ ok: true, value: true })
  })
  it('blocks duplicate deletion and new terminals while confirmation is pending', async () => {
    let finish!: (result: { response: number }) => void
    mocks.confirm.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const pending = remove()
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(await mocks.handlers.get('terminal:create')!(event, { projectPath: path })).toEqual({
      ok: false,
      error: expect.stringContaining('正在删除'),
    })
    expect(mocks.create).not.toHaveBeenCalled()
    finish({ response: 0 })
    await pending
  })
  it('rejects malformed paths and untrusted senders before showing a dialog', async () => {
    expect(await remove('../relative')).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('project:remove')!({ ...event, sender: {} }, path)).toEqual({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
