import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { WorktreeError } from '../src/main/git-worktrees'
import type { AgentSession, AgentUpdate } from '../src/shared/contracts'

const mocks = vi.hoisted(() => {
  const frame = { url: 'http://localhost:5173/' }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    appEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
    rendererEvents: new Map<
      string,
      (details?: { isMainFrame: boolean; isSameDocument: boolean }) => void
    >(),
    contents: {
      mainFrame: frame,
      setWindowOpenHandler: vi.fn(),
      on: (
        name: string,
        listener: (details?: { isMainFrame: boolean; isSameDocument: boolean }) => void,
      ) => mocks.rendererEvents.set(name, listener),
      send: vi.fn(),
      isDestroyed: () => false,
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    },
    confirm: vi.fn(),
    detectAgents: vi.fn(),
    inspectHook: vi.fn(),
    installHook: vi.fn(),
    uninstallHook: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    sendAgent: undefined as ((event: AgentUpdate) => void) | undefined,
    windowFocused: false,
    notify: vi.fn(),
    notificationClick: undefined as (() => void) | undefined,
    notificationSupported: true,
    notificationFails: false,
    config: {
      preferences: {
        scrollback: 5000,
        openWith: [{ id: 'zed', name: 'Zed', command: 'zed', arguments: '{path}' }],
      },
      recentProjects: [] as string[],
      worktreeRecords: [],
    },
    openWorkspaceWith: vi.fn(),
    openPath: vi.fn(),
    remember: vi.fn(),
    setScrollback: vi.fn(),
    readAgent: vi.fn(),
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
    inspectRepository: vi.fn(),
    listWorktrees: vi.fn(),
    createWorktree: vi.fn(),
    scanWorktrees: vi.fn(),
    saveWorkspaceClosure: vi.fn(),
    withTerminalTarget: vi.fn(),
  }
})
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  mkdirSync: vi.fn(),
}))
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
    isFocused = () => mocks.windowFocused
  },
  Notification: class {
    static isSupported = () => mocks.notificationSupported
    constructor(options: unknown) {
      mocks.notify(options)
    }
    on(name: string, callback: () => void) {
      if (name === 'click') mocks.notificationClick = callback
      return this
    }
    show() {
      if (mocks.notificationFails) throw new Error('unavailable')
    }
    close = vi.fn()
  },
  dialog: { showMessageBox: mocks.confirm, showErrorBox: vi.fn() },
  ipcMain: {
    handle: (channel: string, action: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mocks.handlers.set(channel, action)
    },
    on: vi.fn(),
  },
  nativeTheme: {},
  shell: { openPath: mocks.openPath },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../src/main/worktree-manager', () => ({
  WorktreeManager: class {
    inspectRepository = mocks.inspectRepository
    listWorktrees = mocks.listWorktrees
    createWorktree = mocks.createWorktree
    scanWorktrees = mocks.scanWorktrees
    withTerminalTarget = mocks.withTerminalTarget
    removing = false
  },
}))
vi.mock('../src/main/open-with', () => ({ openWorkspaceWith: mocks.openWorkspaceWith }))
vi.mock('../src/main/agents', () => ({ detectAgents: mocks.detectAgents }))
vi.mock('../src/main/agents/managed-hooks', () => ({
  inspectAgentHook: mocks.inspectHook,
  installAgentHook: mocks.installHook,
  uninstallAgentHook: mocks.uninstallHook,
}))
vi.mock('../src/main/shell', () => ({
  loginShellEnvironment: vi.fn().mockResolvedValue({ HOME: '/tmp/cota-hook-fixture' }),
  shellEnvironment: () => ({ HOME: '/tmp/cota-hook-fixture' }),
}))
vi.mock('../src/main/config', () => ({
  ConfigStore: class {
    load = async () => ({})
    forget = mocks.forget
    closeWorkspace = mocks.saveWorkspaceClosure
    flush = mocks.flush
    snapshot = () => structuredClone(mocks.config)
    remember = mocks.remember
  },
}))
vi.mock('../src/main/host-client', () => ({
  connectTerminalHost: async (
    _path: string,
    _send: unknown,
    sendAgent: (event: AgentUpdate) => void,
  ) => {
    mocks.sendAgent = sendAgent
    return {
      disconnect: mocks.disconnect,
      detachAll: vi.fn().mockResolvedValue(undefined),
      request: (method: string, args: unknown[]) => {
        if (method === 'closeWorkspace') return mocks.closeWorkspace(...args)
        if (method === 'closeProject') return mocks.closeProject(...args)
        if (method === 'create') return mocks.create(...args)
        if (method === 'list') return mocks.list()
        if (method === 'setScrollback') return mocks.setScrollback(...args)
        if (method === 'readAgent') return mocks.readAgent(...args)
        if (method === 'hasLive') return mocks.hasLive()
        if (method === 'needsCloseConfirmation') return mocks.needsCloseConfirmation(...args)
        if (method === 'close') return mocks.close(...args)
        if (method === 'shutdown') return mocks.shutdown()
        throw new Error(`Unexpected method: ${method}`)
      },
    }
  },
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
  mocks.contents.mainFrame.url = 'http://localhost:5173/'
  vi.clearAllMocks()
  mocks.closeWorkspace.mockResolvedValue(undefined)
  mocks.closeProject.mockResolvedValue(undefined)
  mocks.forget.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue([])
  mocks.scanWorktrees.mockImplementation(async () => ({
    entries: [],
    external: [],
    repository: { status: 'nonGit', projectPath: path, error: 'not Git' },
  }))
  mocks.saveWorkspaceClosure.mockResolvedValue(undefined)
  mocks.withTerminalTarget.mockImplementation(async (target, action) =>
    action({
      projectPath: target.projectPath,
      workspaceId: target.workspaceId,
      cwd: target.projectPath,
      workspaceKind: 'local',
    }),
  )
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
  mocks.openWorkspaceWith.mockResolvedValue(undefined)
  mocks.openPath.mockResolvedValue('')
  mocks.detectAgents.mockResolvedValue([
    { provider: 'codex', version: '0.159.0', executable: '/tmp/codex-fixture' },
  ])
  mocks.inspectHook.mockImplementation(async (provider) => ({
    provider,
    state: 'missing',
    paths: ['/tmp/cota-hook-fixture/hooks.json'],
    detail: 'missing',
  }))
  mocks.uninstallHook.mockImplementation(async (provider) => ({
    provider,
    state: 'missing',
    paths: ['/tmp/cota-hook-fixture/hooks.json'],
    detail: 'missing',
  }))
  mocks.installHook.mockImplementation(async (provider) => ({
    provider,
    state: 'installed',
    paths: ['/tmp/cota-hook-fixture/hooks.json'],
    detail: 'installed',
  }))
})

describe('Git Worktree IPC boundaries', () => {
  it.each([
    'git:inspect-repository',
    'git:list-worktrees',
    'git:create-worktree',
    'git:plan-worktree',
    'git:branches',
    'git:suggest-worktree-name',
    'git:scan-worktrees',
    'git:link-worktree',
    'git:inspect-removal',
    'git:remove-worktree',
    'git:unlink-worktree',
    'workspace:path',
  ])('rejects untrusted frames before invoking %s', async (channel) => {
    const result = await mocks.handlers.get(channel)!({ ...event, senderFrame: {} }, path)
    expect(result).toMatchObject({ ok: false, error: '拒绝未授权的窗口请求。' })
    expect(mocks.inspectRepository).not.toHaveBeenCalled()
    expect(mocks.listWorktrees).not.toHaveBeenCalled()
    expect(mocks.createWorktree).not.toHaveBeenCalled()
  })
  it('discards Renderer cwd and identity fields before forwarding a trusted Main binding to Host', async () => {
    mocks.config.recentProjects = [path]
    const value = {
      id: randomUUID(),
      projectPath: path,
      workspaceId: randomUUID(),
      cols: 80,
      rows: 24,
      cwd: '/forged',
      workspaceKind: 'git-worktree',
      worktreeId: randomUUID(),
      repoCommonDir: '/forged/.git',
    }
    expect(await mocks.handlers.get('terminal:create')!(event, value)).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenCalledWith(
      {
        id: value.id,
        projectPath: path,
        workspaceId: value.workspaceId,
        cols: 80,
        rows: 24,
        cwd: path,
        workspaceKind: 'local',
        kind: 'shell',
      },
      mocks.config.preferences,
    )
    const launch = { kind: 'agent', provider: 'codex', launchId: randomUUID() }
    expect(
      await mocks.handlers.get('terminal:create')!(event, {
        ...value,
        ...launch,
        executable: '/bin/sh',
        args: ['-c', 'touch nope'],
        env: { COTA_HOST_TOKEN: 'forged' },
      }),
    ).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenLastCalledWith(
      {
        id: value.id,
        cols: 80,
        rows: 24,
        projectPath: path,
        workspaceId: value.workspaceId,
        cwd: path,
        workspaceKind: 'local',
        ...launch,
      },
      mocks.config.preferences,
    )
    mocks.create.mockClear()
    for (const provider of ['__proto__', 'sh', 'codex; touch nope'])
      expect(
        await mocks.handlers.get('terminal:create')!(event, { ...value, ...launch, provider }),
      ).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('agent:detect')!({ ...event, senderFrame: {} })).toMatchObject({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('agent:read')!(event, value.id, launch.launchId, 7)).toEqual({
      ok: true,
    })
    expect(mocks.readAgent).toHaveBeenCalledExactlyOnceWith(value.id, launch.launchId, 7)
    for (const revision of [-1, 0.5, '7', Number.MAX_SAFE_INTEGER + 1])
      expect(
        await mocks.handlers.get('agent:read')!(event, value.id, launch.launchId, revision),
      ).toMatchObject({ ok: false })
    expect(
      await mocks.handlers.get('agent:read')!(
        { ...event, senderFrame: {} },
        value.id,
        launch.launchId,
        7,
      ),
    ).toMatchObject({ ok: false })
    expect(mocks.readAgent).toHaveBeenCalledOnce()
    expect(
      await mocks.handlers.get('agent:visible')!({ ...event, senderFrame: {} }, value.id),
    ).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('agent:visible')!(event, 'invalid')).toMatchObject({
      ok: false,
    })
    const state: AgentSession = {
      terminalId: value.id,
      launchId: launch.launchId,
      provider: 'pi',
      projectPath: path,
      workspaceId: value.workspaceId,
      cwd: path,
      runtimeState: 'running',
      activityState: 'working',
      outcome: 'unknown',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      lastTurnId: 'turn-1',
      eventSource: 'pi-extension',
      observability: 'full',
      revision: 1,
      unread: false,
    }
    const publish = (change: Partial<AgentSession>) => {
      Object.assign(state, change, { revision: state.revision + 1 })
      mocks.sendAgent!({ type: 'state', session: { ...state } })
    }
    mocks.sendAgent!({ type: 'disconnected' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-2' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    const click = mocks.notificationClick!
    publish({ unread: false })
    mocks.sendAgent!({ type: 'state', session: { ...state, revision: 1 } })
    expect(mocks.notify).toHaveBeenCalledOnce()
    mocks.contents.send.mockClear()
    mocks.list.mockResolvedValueOnce([])
    click()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled())
    expect(mocks.contents.send).not.toHaveBeenCalledWith('agent:focus', expect.anything())
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.list.mockResolvedValueOnce([{ id: value.id, agent: { ...state } }])
    click()
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith('agent:focus', {
        terminalId: value.id,
        launchId: launch.launchId,
      }),
    )
    await mocks.handlers.get('agent:visible')!(event, value.id)
    mocks.windowFocused = true
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-3' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    mocks.windowFocused = false
    publish({ unread: false })
    expect(mocks.notify).toHaveBeenCalledOnce()
    publish({ activityState: 'working' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    publish({ activityState: 'unknown', observability: 'unavailable' })
    publish({ activityState: 'needs-input', observability: 'full' })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    publish({ activityState: 'failed', outcome: 'failure' })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    publish({ activityState: 'interrupted', outcome: 'cancelled' })
    publish({
      activityState: 'unknown',
      outcome: 'unknown',
      observability: 'unavailable',
      eventSource: 'process',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    mocks.notificationSupported = false
    publish({
      activityState: 'completed',
      outcome: 'unknown',
      lastTurnId: 'turn-4',
      observability: 'partial',
      eventSource: 'codex-hooks',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    mocks.notificationSupported = true
    mocks.notificationFails = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    publish({ activityState: 'working', lastTurnId: 'turn-5' })
    expect(() => publish({ activityState: 'completed' })).not.toThrow()
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
    mocks.notificationFails = false
    mocks.sendAgent!({
      type: 'removed',
      terminalId: value.id,
      launchId: launch.launchId,
      revision: state.revision + 1,
    })
    mocks.sendAgent!({ type: 'disconnected' })
    await mocks.handlers.get('app:bootstrap')!(event)
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('agent:hooks-detect')!(event)).toMatchObject({ ok: true })
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('agent:hooks-install')!({ ...event, senderFrame: {} }, 'codex'),
    ).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('agent:hooks-install')!(event, '__proto__')).toMatchObject({
      ok: false,
    })
    for (const confirmed of [false, true]) {
      mocks.contents.send.mockClear()
      const pending = mocks.handlers.get('agent:hooks-install')!(event, 'codex')
      await vi.waitFor(() =>
        expect(mocks.contents.send).toHaveBeenCalledWith(
          'app:confirm',
          expect.objectContaining({ title: expect.stringContaining('安装') }),
        ),
      )
      expect(mocks.installHook).not.toHaveBeenCalled()
      const request = mocks.contents.send.mock.calls.find(
        ([channel]) => channel === 'app:confirm',
      )![1]
      expect(request.description).toContain('/tmp/cota-hook-fixture/hooks.json')
      expect(request.title).toContain('安装并信任 Codex')
      expect(request.confirmLabel).toBe('安装并信任 Hooks')
      expect(request.description).toContain('不信任其他 Hooks')
      expect(request.description).toContain('不修改 Hooks 功能开关')
      await mocks.handlers.get('app:confirm-response')!(event, request.id, confirmed)
      expect(await pending).toMatchObject(
        confirmed ? { ok: true, value: { state: 'installed' } } : { ok: true, value: null },
      )
    }
    expect(mocks.installHook).toHaveBeenCalledExactlyOnceWith(
      'codex',
      { HOME: '/tmp/cota-hook-fixture' },
      '0.159.0',
      '/tmp/codex-fixture',
    )
    mocks.detectAgents.mockResolvedValueOnce([{ provider: 'codex', error: 'missing' }])
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'codex')).toMatchObject({
      ok: false,
      error: expect.stringContaining('找不到 Codex'),
    })
    expect(mocks.installHook).toHaveBeenCalledOnce()
    mocks.detectAgents.mockClear()
    mocks.contents.send.mockClear()
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: true })
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: false, isSameDocument: false })
    const piInstall = mocks.handlers.get('agent:hooks-install')!(event, 'pi')
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:confirm',
        expect.objectContaining({ title: expect.stringContaining('Pi') }),
      ),
    )
    expect(mocks.detectAgents).not.toHaveBeenCalled()
    expect(mocks.installHook).toHaveBeenCalledOnce()
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: false,
      error: expect.stringContaining('无法显示安装确认'),
    })
    const piRequest = mocks.contents.send.mock.calls.find(
      ([channel]) => channel === 'app:confirm',
    )![1]
    await mocks.handlers.get('app:confirm-response')!(event, piRequest.id, true)
    expect(await piInstall).toMatchObject({
      ok: true,
      value: { provider: 'pi', state: 'installed' },
    })
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    expect(mocks.uninstallHook).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('agent:hooks-uninstall')!({ ...event, senderFrame: {} }, 'pi'),
    ).toMatchObject({ ok: false, error: '拒绝未授权的窗口请求。' })
    expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, '__proto__')).toMatchObject({
      ok: false,
    })
    for (const provider of ['codex', 'pi', 'claude']) {
      for (const confirmed of [false, true]) {
        mocks.contents.send.mockClear()
        mocks.uninstallHook.mockClear()
        const pending = mocks.handlers.get('agent:hooks-uninstall')!(event, provider)
        await vi.waitFor(() =>
          expect(mocks.contents.send).toHaveBeenCalledWith(
            'app:confirm',
            expect.objectContaining({ title: expect.stringContaining('卸载') }),
          ),
        )
        expect(mocks.uninstallHook).not.toHaveBeenCalled()
        expect(mocks.detectAgents).not.toHaveBeenCalled()
        expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, provider)).toMatchObject({
          ok: false,
          error: expect.stringContaining('无法显示卸载确认'),
        })
        const request = mocks.contents.send.mock.calls.find(
          ([channel]) => channel === 'app:confirm',
        )![1]
        expect(request.description).toContain('/tmp/cota-hook-fixture/hooks.json')
        expect(request.description).toContain('共享加载脚本不删除')
        expect(request.description).toContain('卸载不创建备份')
        await mocks.handlers.get('app:confirm-response')!(event, request.id, confirmed)
        expect(await pending).toMatchObject(
          confirmed ? { ok: true, value: { state: 'missing' } } : { ok: true, value: null },
        )
        expect(mocks.uninstallHook).toHaveBeenCalledTimes(confirmed ? 1 : 0)
      }
    }
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false })
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: false,
      error: expect.stringContaining('无法显示安装确认'),
    })
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, 'pi')).toMatchObject({
      ok: false,
      error: expect.stringContaining('无法显示卸载确认'),
    })
    expect(mocks.uninstallHook).toHaveBeenCalledOnce()
    await mocks.handlers.get('app:bootstrap')!(event)
  })
  it('preserves structured partial-success diagnostics without exposing command stderr or cause', async () => {
    const details = {
      operationId: 'test-operation',
      path: '/tmp/managed',
      gitState: 'created' as const,
    }
    mocks.createWorktree.mockRejectedValueOnce(
      Object.assign(new WorktreeError('CONFIG_PERSIST_FAILED', '登记保存失败', details), {
        cause: new Error('private command output'),
      }),
    )
    mocks.contents.mainFrame.url = 'http://localhost:5173/#/settings'
    const input = { projectPath: path, name: 'Feature', branchName: 'feature', baseRef: 'main' }
    expect(await mocks.handlers.get('git:create-worktree')!(event, input)).toEqual({
      ok: false,
      error: '登记保存失败',
      code: 'CONFIG_PERSIST_FAILED',
      details,
    })
    expect(mocks.createWorktree).toHaveBeenCalledExactlyOnceWith(input)
  })
})

describe('open-with IPC', () => {
  it('opens a known project in the system file manager without a saved program', async () => {
    const directory = await realpath(process.cwd())
    mocks.config.recentProjects = [directory]
    expect(
      await mocks.handlers.get('workspace:open-with')!(event, directory, 'system-file-manager'),
    ).toEqual({ ok: true })
    expect(mocks.openPath).toHaveBeenCalledExactlyOnceWith(directory)
    expect(mocks.openWorkspaceWith).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('reports system file manager errors and allows retry', async () => {
    const directory = await realpath(process.cwd())
    mocks.config.recentProjects = [directory]
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.openPath.mockResolvedValueOnce('Unable to open directory')
    const pending = mocks.handlers.get('workspace:open-with')!(
      event,
      directory,
      'system-file-manager',
    )
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:confirm',
        expect.objectContaining({ description: 'Unable to open directory' }),
      ),
    )
    const request = mocks.contents.send.mock.calls.find(([name]) => name === 'app:confirm')![1]
    await mocks.handlers.get('app:confirm-response')!(event, request.id, false)
    expect(await pending).toEqual({ ok: false, error: 'Unable to open directory' })
    expect(
      await mocks.handlers.get('workspace:open-with')!(event, directory, 'system-file-manager'),
    ).toEqual({ ok: true })
  })
  it('uses only a saved program for a known project without touching terminal sessions', async () => {
    mocks.config.recentProjects = [path]
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'zed')).toEqual({
      ok: true,
    })
    expect(mocks.openWorkspaceWith).toHaveBeenCalledExactlyOnceWith(
      path,
      mocks.config.preferences.openWith[0],
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it('rejects untrusted frames, unknown projects, and arbitrary program definitions', async () => {
    const open = mocks.handlers.get('workspace:open-with')!
    expect(await open(event, path, 'zed')).toMatchObject({ ok: false })
    expect(await open(event, path, 'system-file-manager')).toMatchObject({ ok: false })
    mocks.config.recentProjects = [path]
    expect(await open({ ...event, senderFrame: {} }, path, 'system-file-manager')).toMatchObject({
      ok: false,
    })
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(await open({ ...event, senderFrame: {} }, path, 'zed')).toMatchObject({ ok: false })
    expect(await open(event, path, { command: '/bin/sh' })).toMatchObject({ ok: false })
    expect(await open(event, path, 'removed')).toMatchObject({ ok: false })
    expect(mocks.openWorkspaceWith).not.toHaveBeenCalled()
  })
  it('shows a launch failure through the existing confirmation channel and permits retry', async () => {
    mocks.config.recentProjects = [path]
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.openWorkspaceWith.mockRejectedValueOnce(new Error('command not found'))
    const pending = mocks.handlers.get('workspace:open-with')!(event, path, 'zed')
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:confirm',
        expect.objectContaining({ description: 'command not found' }),
      ),
    )
    const request = mocks.contents.send.mock.calls.find(([name]) => name === 'app:confirm')![1]
    await mocks.handlers.get('app:confirm-response')!(event, request.id, false)
    expect(await pending).toEqual({ ok: false, error: 'command not found' })
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'zed')).toEqual({
      ok: true,
    })
  })
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
    const latest = { ...session, exited: true, exitCode: 7 }
    mocks.list
      .mockResolvedValueOnce([session, { ...session, id: extra.workspaceId }])
      .mockResolvedValueOnce([latest, { ...session, id: extra.workspaceId }])
    const result = await mocks.handlers.get('app:bootstrap')!(event)
    expect(result).toEqual({
      ok: true,
      value: {
        config: { ...mocks.config, recentProjects: [path] },
        sessions: [latest, { ...session, id: extra.workspaceId }],
        warning: undefined,
        worktreeScans: { [path]: await mocks.scanWorktrees() },
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
  it.each(['../relative', null])(
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
    { projectPath: '../relative', workspaceId: path },
    { projectPath: path },
    { projectPath: path, workspaceId: '../other' },
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

describe('renderer route IPC trust', () => {
  it.each(['#/', '#/settings'])('accepts hash routes of the trusted document: %s', async (hash) => {
    mocks.contents.mainFrame.url = `http://localhost:5173/${hash}`
    expect(await mocks.handlers.get('app:bootstrap')!(event)).toMatchObject({ ok: true })
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it.each([
    'http://localhost:5173/other#/settings',
    'http://localhost:5173/?other=true#/settings',
    'http://localhost:5174/#/settings',
    'https://localhost:5173/#/settings',
    'http://untrusted.example/#/settings',
    'file:///tmp/index.html#/settings',
  ])('rejects other documents even with a settings hash: %s', async (url) => {
    mocks.contents.mainFrame.url = url
    expect(await mocks.handlers.get('app:bootstrap')!(event)).toEqual({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    expect(mocks.list).not.toHaveBeenCalled()
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

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'])(
    'cancels pending quit on %s and permits retry',
    async (name) => {
      quit()
      const request = await prompt()
      mocks.rendererEvents.get(name)!(
        name === 'did-start-navigation' ? { isMainFrame: true, isSameDocument: false } : undefined,
      )
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
