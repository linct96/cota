import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AgentSleepPrevention } from '../src/main/agents/agent-sleep-prevention'
import type { NotificationSound } from '../src/shared/notification-sounds'
import { WorktreeError } from '../src/main/git/git-worktrees'
import { hookFiles } from '../src/main/agents/managed-hooks'
import {
  DEFAULT_CONFIG,
  type AgentSession,
  type AgentUpdate,
  type TurnCompleteNotification,
} from '../src/shared/contracts'

const mocks = vi.hoisted(() => {
  const frame = { url: 'http://localhost:5173/' }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    appEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
    ipcEvents: new Map<string, (event: unknown) => void>(),
    exit: vi.fn(),
    loadRenderer: vi.fn(),
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
    chooseFile: vi.fn(),
    readSound: vi.fn(),
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
    notificationFailedEvent: false,
    notificationError: '',
    spawn: vi.fn(),
    startBlocker: vi.fn().mockReturnValue(17),
    stopBlocker: vi.fn(),
    isBlockerStarted: vi.fn().mockReturnValue(true),
    config: {
      preferences: {
        notificationsEnabled: true,
        notificationSound: 'system' as NotificationSound,
        turnCompleteNotification: 'unfocused' as TurnCompleteNotification,
        scrollback: 5000,
        openWith: [{ id: 'zed', name: 'Zed', command: 'zed', arguments: '{path}' }],
      },
      recentProjects: [] as string[],
      worktreeRecords: [],
    },
    resolveShell: vi.fn().mockResolvedValue('/bin/bash'),
    openWorkspaceWith: vi.fn(),
    listWorkspaceOpeners: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn(),
    remember: vi.fn(),
    setScrollback: vi.fn(),
    readAgent: vi.fn(),
    hasLive: vi.fn(),
    needsCloseConfirmation: vi.fn(),
    close: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
    forceStopHost: vi.fn(),
    connectFailure: undefined as Error | undefined,
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
    gitStatus: vi.fn(),
    gitDiff: vi.fn(),
    gitMutate: vi.fn(),
    gitReferences: vi.fn(),
    gitHistory: vi.fn(),
    gitCompare: vi.fn(),
  }
})
vi.mock('../src/main/notification-sound', () => ({ readNotificationSound: mocks.readSound }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  mkdirSync: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mocks.spawn,
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
    exit: mocks.exit,
  },
  BrowserWindow: class {
    webContents = mocks.contents
    on = vi.fn()
    once = vi.fn()
    loadURL = mocks.loadRenderer
    isDestroyed = () => false
    isMinimized = () => false
    show = vi.fn()
    focus = vi.fn()
    isFocused = () => mocks.windowFocused
  },
  Notification: class extends EventEmitter {
    static isSupported = () => mocks.notificationSupported
    constructor(options: unknown) {
      super()
      mocks.notify(options)
    }
    override on(name: string, callback: () => void) {
      if (name === 'click') mocks.notificationClick = callback
      return super.on(name, callback)
    }
    show() {
      if (mocks.notificationFails) throw new Error('unavailable')
      this.emit(mocks.notificationFailedEvent ? 'failed' : 'show', {}, mocks.notificationError)
    }
    close = vi.fn()
  },
  dialog: {
    showMessageBox: mocks.confirm,
    showOpenDialog: mocks.chooseFile,
    showErrorBox: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, action: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mocks.handlers.set(channel, action)
    },
    on: (channel: string, listener: (event: unknown) => void) =>
      mocks.ipcEvents.set(channel, listener),
  },
  nativeTheme: { on: vi.fn() },
  powerMonitor: { on: vi.fn() },
  powerSaveBlocker: {
    start: mocks.startBlocker,
    stop: mocks.stopBlocker,
    isStarted: mocks.isBlockerStarted,
  },
  shell: { openPath: mocks.openPath, openExternal: mocks.openExternal },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../src/main/git/worktree-manager', () => ({
  WorktreeManager: class {
    inspectRepository = mocks.inspectRepository
    listWorktrees = mocks.listWorktrees
    createWorktree = mocks.createWorktree
    scanWorktrees = mocks.scanWorktrees
    withTerminalTarget = mocks.withTerminalTarget
    initializing = new Set<string>()
    removing = false
  },
}))
vi.mock('../src/main/git/source-control', () => ({
  SourceControlService: class {
    status = mocks.gitStatus
    diff = mocks.gitDiff
    mutate = mocks.gitMutate
    references = mocks.gitReferences
    history = mocks.gitHistory
    compare = mocks.gitCompare
  },
}))
vi.mock('../src/main/system/open-with', () => ({
  openWorkspaceWith: mocks.openWorkspaceWith,
  listWorkspaceOpeners: mocks.listWorkspaceOpeners,
}))
vi.mock('../src/main/agents/registry', () => ({ detectAgents: mocks.detectAgents }))
vi.mock('../src/main/agents/managed-hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/agents/managed-hooks')>()),
  inspectAgentHook: mocks.inspectHook,
  installAgentHook: mocks.installHook,
  uninstallAgentHook: mocks.uninstallHook,
}))
vi.mock('../src/main/system/shell', () => ({
  resolveShell: mocks.resolveShell,
  loginShellEnvironment: vi.fn().mockResolvedValue({ HOME: '/tmp/cota-hook-fixture' }),
  shellEnvironment: () => ({ HOME: '/tmp/cota-hook-fixture' }),
}))
vi.mock('../src/main/accounts/service', () => ({
  AccountService: class {
    close = vi.fn().mockResolvedValue(undefined)
  },
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
vi.mock('../src/main/host/host-client', () => ({
  forceStopTerminalHost: mocks.forceStopHost,
  connectTerminalHost: async (
    _path: string,
    _send: unknown,
    sendAgent: (event: AgentUpdate) => void,
  ) => {
    if (mocks.connectFailure) throw mocks.connectFailure
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
  mocks.config.preferences = { ...DEFAULT_CONFIG.preferences, ...mocks.config.preferences }
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
  mocks.readSound.mockImplementation(async (sound: NotificationSound) =>
    typeof sound === 'string' ? undefined : 'data:audio/mpeg;base64,SUQz',
  )
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
  mocks.forceStopHost.mockReset().mockResolvedValue(undefined)
  mocks.connectFailure = undefined
  mocks.openWorkspaceWith.mockResolvedValue(undefined)
  mocks.openPath.mockResolvedValue('')
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
  mocks.detectAgents.mockResolvedValue([
    { provider: 'codex', version: '0.159.0', executable: '/tmp/codex-fixture' },
  ])
  mocks.inspectHook.mockImplementation(async (provider, env) => {
    const { config, loader } = hookFiles(provider, env)
    return {
      provider,
      state: 'missing',
      paths: provider === 'codex' ? [loader, config] : [config],
      detail: 'missing',
    }
  })
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
  it('prevents sleep only for observed working agents and releases all platform resources', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let sleep = new AgentSleepPrevention()
    let revision = 0
    const state: AgentSession = {
      terminalId: randomUUID(),
      launchId: randomUUID(),
      provider: 'claude',
      projectPath: path,
      workspaceId: randomUUID(),
      cwd: path,
      runtimeState: 'running',
      activityState: 'working',
      outcome: 'unknown',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventSource: 'claude-hooks',
      observability: 'partial',
      revision: 0,
      unread: false,
    }
    const publish = (change: Partial<AgentSession> = {}) => {
      sleep.receive({ type: 'state', session: { ...state, ...change, revision: ++revision } })
    }
    try {
      for (const value of ['win32', 'linux']) {
        Object.defineProperty(process, 'platform', { value })
        mocks.startBlocker.mockClear()
        mocks.stopBlocker.mockClear()
        sleep = new AgentSleepPrevention()
        publish()
        expect(mocks.startBlocker).not.toHaveBeenCalled()
        sleep.setEnabled(true)
        expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
        publish({ terminalId: 'second' })
        publish({ activityState: 'completed' })
        expect(mocks.stopBlocker).not.toHaveBeenCalled()
        sleep.receive({
          type: 'removed',
          terminalId: 'second',
          launchId: state.launchId,
          revision: ++revision,
        })
        expect(mocks.stopBlocker).toHaveBeenLastCalledWith(17)
        const starts = mocks.startBlocker.mock.calls.length
        for (const activityState of [
          'needs-input',
          'completed',
          'failed',
          'interrupted',
          'unknown',
        ] as const)
          publish({ activityState })
        publish({ runtimeState: 'exited' })
        publish({ observability: 'unavailable' })
        publish({ eventSource: 'process' })
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts)
        publish({ activityState: 'needs-input', workingChildren: 1 })
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 1)
        publish({ activityState: 'needs-input', workingChildren: 0 })
        publish()
        sleep.setEnabled(false)
        expect(mocks.stopBlocker).toHaveBeenCalledTimes(3)
        sleep.setEnabled(true)
        sleep.receive({
          type: 'state',
          session: { ...state, activityState: 'completed', revision: 0 },
        })
        expect(mocks.stopBlocker).toHaveBeenCalledTimes(3)
        mocks.isBlockerStarted.mockReturnValueOnce(false)
        sleep.refresh()
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 4)
        sleep.receive({ type: 'disconnected' })
        publish()
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 4)
        sleep.dispose()
      }
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const child = () =>
        Object.assign(new EventEmitter(), {
          pid: 12345,
          exitCode: null as number | null,
          signalCode: null,
          kill: vi.fn().mockReturnValue(true),
        })
      const first = child()
      mocks.spawn.mockReturnValueOnce(first)
      mocks.startBlocker.mockClear()
      sleep = new AgentSleepPrevention()
      sleep.setEnabled(true)
      publish()
      first.emit('spawn')
      expect(mocks.spawn).toHaveBeenLastCalledWith(
        '/usr/bin/caffeinate',
        ['-i', '-s', '-w', String(process.pid)],
        {
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        },
      )
      publish()
      expect(mocks.startBlocker).not.toHaveBeenCalled()
      first.exitCode = 1
      first.emit('exit', 1)
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
      sleep.dispose()
      const failed = child()
      Object.assign(failed, { pid: undefined })
      mocks.spawn.mockReturnValueOnce(failed)
      sleep = new AgentSleepPrevention()
      sleep.setEnabled(true)
      publish()
      failed.emit('error', new Error('ENOENT'))
      expect(mocks.startBlocker).toHaveBeenCalledTimes(2)
      sleep.setEnabled(false)
      const next = child()
      mocks.spawn.mockReturnValueOnce(next)
      sleep.setEnabled(true)
      expect(mocks.spawn).toHaveBeenCalledTimes(3)
      sleep.dispose()
      expect(next.kill).toHaveBeenCalledOnce()
      next.emit('exit', 0)
      expect(mocks.startBlocker).toHaveBeenCalledTimes(2)
    } finally {
      sleep.dispose()
      Object.defineProperty(process, 'platform', platform)
      warning.mockRestore()
    }
  })
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
    const defaultShell = mocks.handlers.get('shell:default')!
    expect(await defaultShell({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.resolveShell).not.toHaveBeenCalled()
    expect(await defaultShell(event, { shellPath: '/forged' })).toEqual({
      ok: true,
      value: '/bin/bash',
    })
    expect(mocks.resolveShell).toHaveBeenCalledExactlyOnceWith({ shellPath: null })
    mocks.resolveShell.mockRejectedValueOnce(new Error('Shell 不存在或不可执行：/bin/zsh'))
    expect(await defaultShell(event)).toEqual({
      ok: false,
      error: 'Shell 不存在或不可执行：/bin/zsh',
    })
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
    for (const channel of [
      'git:status',
      'git:diff',
      'git:mutate',
      'git:references',
      'git:history',
      'git:compare',
    ]) {
      expect(
        await mocks.handlers.get(channel)!({ ...event, senderFrame: {} }, value),
      ).toMatchObject({ ok: false })
    }
    expect(mocks.gitStatus).not.toHaveBeenCalled()
    expect(mocks.gitDiff).not.toHaveBeenCalled()
    expect(mocks.gitMutate).not.toHaveBeenCalled()
    expect(mocks.gitReferences).not.toHaveBeenCalled()
    expect(mocks.gitHistory).not.toHaveBeenCalled()
    expect(mocks.gitCompare).not.toHaveBeenCalled()
    await mocks.handlers.get('git:status')!(event, value)
    expect(mocks.gitStatus).toHaveBeenCalledExactlyOnceWith(path, true)
    const file = { path: 'file.txt', area: 'unstaged' }
    await mocks.handlers.get('git:diff')!(event, value, file)
    expect(mocks.gitDiff).toHaveBeenCalledExactlyOnceWith(path, file)
    const mutation = { ...value, action: 'stage', files: [file] }
    await mocks.handlers.get('git:mutate')!(event, mutation)
    expect(mocks.gitMutate).toHaveBeenCalledExactlyOnceWith(path, mutation, expect.any(Function))
    await mocks.handlers.get('git:references')!(event, value)
    expect(mocks.gitReferences).toHaveBeenCalledExactlyOnceWith(path)
    const historyRequest = { head: 'a'.repeat(40), offset: 50 }
    await mocks.handlers.get('git:history')!(event, value, historyRequest)
    expect(mocks.gitHistory).toHaveBeenCalledExactlyOnceWith(path, historyRequest)
    const compareRequest = { kind: 'branch', ref: 'refs/heads/main' }
    await mocks.handlers.get('git:compare')!(event, value, compareRequest)
    expect(mocks.gitCompare).toHaveBeenCalledExactlyOnceWith(path, compareRequest)
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
    expect(mocks.contents.send).toHaveBeenCalledWith(
      'app:warning',
      'Agent 系统通知不可用；终端状态与未读提醒不受影响。',
    )
    mocks.notificationFails = false
    mocks.notificationFailedEvent = true
    publish({ activityState: 'working', lastTurnId: 'turn-permission-denied' })
    publish({ activityState: 'completed' })
    expect(mocks.contents.send).toHaveBeenCalledWith(
      'app:warning',
      '系统未能显示 Agent 通知；请检查通知权限。',
    )
    warning.mockRestore()
    mocks.notificationFailedEvent = false
    mocks.notify.mockClear()
    mocks.config.preferences.notificationsEnabled = false
    publish({ activityState: 'working', lastTurnId: 'turn-6' })
    publish({ activityState: 'completed', outcome: 'success' })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.config.preferences.notificationsEnabled = true
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working', lastTurnId: 'turn-7' })
    publish({ activityState: 'completed', outcome: 'success' })
    expect(mocks.notify).toHaveBeenCalledOnce()
    mocks.notify.mockClear()
    for (const mode of ['never', 'unfocused', 'always'] as const) {
      mocks.config.preferences.turnCompleteNotification = mode
      for (const focused of [false, true]) {
        mocks.windowFocused = focused
        publish({ activityState: 'working', lastTurnId: `${mode}-${focused}` })
        publish({ activityState: 'completed', outcome: 'success' })
        const expected = mode === 'always' || (mode === 'unfocused' && !focused)
        expect(mocks.notify).toHaveBeenCalledTimes(expected ? 1 : 0)
        mocks.notify.mockClear()
        // Preference/focus changes must not replay a consumed completion.
        mocks.config.preferences.turnCompleteNotification = 'always'
        mocks.windowFocused = false
        publish({ unread: false })
        expect(mocks.notify).not.toHaveBeenCalled()
        mocks.config.preferences.turnCompleteNotification = mode
      }
    }
    mocks.config.preferences.turnCompleteNotification = 'always'
    const customSound = { path: '/tmp/提示音 sound.mp3' }
    const source = 'data:audio/mpeg;base64,SUQz'
    mocks.config.preferences.notificationSound = customSound
    mocks.contents.send.mockClear()
    publish({ activityState: 'working', lastTurnId: 'custom-sound' })
    publish({ activityState: 'completed' })
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ silent: true }))
    await vi.waitFor(() =>
      expect(
        mocks.contents.send.mock.calls.filter(([channel]) => channel === 'notifications:sound'),
      ).toEqual([['notifications:sound', source]]),
    )
    mocks.notify.mockClear()
    mocks.contents.send.mockClear()
    mocks.config.preferences.notificationsEnabled = false
    publish({ activityState: 'working', lastTurnId: 'always-disabled' })
    publish({ activityState: 'completed' })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
    const testNotification = mocks.handlers.get('notifications:test')!
    expect(await testNotification(event)).toMatchObject({ ok: false, error: '请先启用通知。' })
    mocks.config.preferences.notificationsEnabled = true
    expect(await testNotification({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.notificationSupported = false
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '当前系统不支持通知。',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.notificationSupported = true
    mocks.config.preferences.turnCompleteNotification = 'never'
    expect(await testNotification(event)).toMatchObject({ ok: true })
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cota · 测试通知' }))
    const openSettings = mocks.handlers.get('notifications:open-settings')!
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const show = vi.spyOn((await import('electron')).Notification.prototype, 'show')
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      expect(await openSettings({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(await openSettings(event)).toMatchObject({ ok: true })
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
        'x-apple.systempreferences:com.apple.preference.notifications',
      )
      mocks.openExternal.mockRejectedValueOnce(new Error('无法打开系统设置'))
      expect(await openSettings(event)).toMatchObject({ ok: false, error: '无法打开系统设置' })
      Object.defineProperty(process, 'platform', { value: 'win32' })
      expect(await openSettings(event)).toMatchObject({ ok: false })
      expect(mocks.openExternal).toHaveBeenCalledTimes(2)
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.useFakeTimers()
      show.mockImplementation(function (this: EventEmitter) {
        setTimeout(() => this.emit('show'), 6000)
      })
      let settled = false
      const delayed = testNotification(event).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(5000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await delayed).toMatchObject({ ok: true })
      show.mockImplementation(() => {})
      const timedOut = testNotification(event)
      await vi.advanceTimersByTimeAsync(30000)
      expect(await timedOut).toMatchObject({
        ok: false,
        error: expect.stringContaining('若系统正在询问通知权限，请完成授权后重试'),
      })
    } finally {
      show.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
      Object.defineProperty(process, 'platform', platform)
    }
    const chooseSound = mocks.handlers.get('notifications:choose-sound')!
    mocks.chooseFile.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await chooseSound(event)).toEqual({ ok: true, value: null })
    expect(await chooseSound({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.chooseFile).toHaveBeenCalledOnce()
    mocks.chooseFile.mockResolvedValue({ canceled: false, filePaths: [customSound.path] })
    expect(await chooseSound(event)).toEqual({ ok: true, value: customSound })
    mocks.readSound.mockRejectedValueOnce(new Error('无法读取提示音文件，请重新选择。'))
    expect(await chooseSound(event)).toMatchObject({
      ok: false,
      error: '无法读取提示音文件，请重新选择。',
    })
    mocks.notify.mockClear()
    mocks.readSound.mockRejectedValueOnce(new Error('无法读取提示音文件，请重新选择。'))
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '无法读取提示音文件，请重新选择。',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
    for (const sound of ['system', 'none', customSound] satisfies NotificationSound[]) {
      mocks.config.preferences.notificationSound = sound
      mocks.notify.mockClear()
      mocks.contents.send.mockClear()
      expect(await testNotification(event)).toMatchObject({ ok: true })
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ silent: sound !== 'system' }),
      )
      const custom = typeof sound !== 'string'
      await vi.waitFor(() =>
        expect(
          mocks.contents.send.mock.calls.filter(([channel]) => channel === 'notifications:sound'),
        ).toEqual(custom ? [['notifications:sound', source]] : []),
      )
    }
    mocks.contents.send.mockClear()
    mocks.notificationFails = true
    expect(await testNotification(event)).toMatchObject({ ok: false, error: 'unavailable' })
    mocks.notificationFails = false
    mocks.notificationFailedEvent = true
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '通知发送失败，请检查系统通知设置。',
    })
    mocks.notificationError = 'Notifications are not allowed for this application'
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '通知发送失败：Notifications are not allowed for this application',
    })
    mocks.notificationError = ''
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
    mocks.notificationFailedEvent = false
    mocks.config.preferences.notificationSound = 'system'
    mocks.config.preferences.turnCompleteNotification = 'unfocused'
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
      expect(request.description).toContain('/tmp/cota-hook-fixture/.codex/hooks.json')
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
    for (const provider of ['codex', 'pi', 'claude'] as const) {
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
        const files = hookFiles(provider, {
          HOME: '/tmp/cota-hook-fixture',
        })
        expect(request.description).toContain(files.config)
        expect(request.description).not.toContain(files.loader)
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
  it('uses only settings programs for known workspaces without touching terminal sessions', async () => {
    mocks.config.recentProjects = [path]
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'zed')).toEqual({
      ok: true,
    })
    expect(mocks.openWorkspaceWith).toHaveBeenCalledExactlyOnceWith(
      path,
      mocks.config.preferences.openWith[0],
    )
    const target = { projectPath: path, workspaceId: randomUUID() }
    mocks.withTerminalTarget.mockImplementationOnce(async (_target, action) =>
      action({ cwd: '/tmp/managed-worktree' }),
    )
    expect(await mocks.handlers.get('workspace:open-with')!(event, target, 'zed')).toEqual({
      ok: true,
    })
    expect(mocks.withTerminalTarget).toHaveBeenCalledWith(target, expect.any(Function))
    expect(mocks.openWorkspaceWith).toHaveBeenLastCalledWith(
      '/tmp/managed-worktree',
      mocks.config.preferences.openWith[0],
    )
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'vscode')).toMatchObject({
      ok: false,
      error: '打开方式不存在，请检查设置。',
    })
    expect(mocks.openWorkspaceWith).toHaveBeenCalledTimes(2)
    mocks.listWorkspaceOpeners.mockReturnValueOnce(mocks.config.preferences.openWith)
    expect(await mocks.handlers.get('workspace:openers')!(event)).toEqual({
      ok: true,
      value: mocks.config.preferences.openWith,
    })
    expect(mocks.listWorkspaceOpeners).toHaveBeenCalledExactlyOnceWith(mocks.config.preferences)
    expect(
      await mocks.handlers.get('workspace:openers')!({ ...event, senderFrame: {} }),
    ).toMatchObject({ ok: false })
    expect(mocks.listWorkspaceOpeners).toHaveBeenCalledOnce()
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

  it('uses renderer quit confirmation, guards duplicate exits and cancels safely if the renderer disappears', async () => {
    quit()
    const request = await prompt()
    expect(request).toMatchObject({ title: '退出 Cota？', confirmLabel: '结束终端并退出' })
    quit()
    expect(mocks.contents.send).toHaveBeenCalledOnce()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('terminal:create')!(event, target)).toMatchObject({ ok: false })
    expect(await remove()).toEqual({ ok: true, value: false })
    await reply(request.id, false)
    await new Promise(setImmediate)
    expect(mocks.flush).not.toHaveBeenCalled()
    mocks.contents.send.mockClear()
    quit()
    const retry = await prompt()
    expect(retry.id).not.toBe(request.id)
    mocks.rendererEvents.get('render-process-gone')!()
    await new Promise(setImmediate)
    expect(await reply(retry.id, true)).toMatchObject({ ok: false })
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'])(
    'uses native quit confirmation after %s, prevents duplicate exits and permits retry after cancellation',
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
      quit()
      await vi.waitFor(() =>
        expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            type: 'warning',
            buttons: ['取消', '结束终端并退出'],
            defaultId: 0,
            cancelId: 0,
          }),
        ),
      )
      quit()
      expect(mocks.confirm).toHaveBeenCalledOnce()
      expect(mocks.contents.send).not.toHaveBeenCalledWith('app:confirm', expect.anything())
      expect(mocks.shutdown).not.toHaveBeenCalled()
      expect(await mocks.handlers.get('terminal:create')!(event, target)).toMatchObject({
        ok: false,
      })
      expect(await remove()).toEqual({ ok: true, value: false })
      cancel({ response: 0 })
      await new Promise(setImmediate)
      expect(mocks.flush).not.toHaveBeenCalled()
      expect(mocks.quit).not.toHaveBeenCalled()
      mocks.confirm.mockResolvedValueOnce({ response: 0 })
      quit()
      await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2))
      await new Promise(setImmediate)
      expect(mocks.shutdown).not.toHaveBeenCalled()
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
    const request = await prompt()
    mocks.contents.send.mockClear()
    await reply(request.id, true)
    const failure = await prompt()
    expect(failure).toMatchObject({
      title: '退出失败',
      description: '终端清理失败，应用暂未退出。\nError: cleanup failed',
    })
    expect(failure.confirmLabel).toBeUndefined()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await reply(failure.id, false)
    await new Promise(setImmediate)
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

describe('error recovery force exit', () => {
  it.each(['failure', 'pending'])(
    'requires trusted native confirmation and waits for verified cleanup: %s',
    async (outcome) => {
      vi.resetModules()
      mocks.handlers.clear()
      vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
      try {
        await import('../src/main/index')
        await vi.waitFor(() => expect(mocks.handlers.has('workspace:remove')).toBe(true))
      } finally {
        vi.unstubAllEnvs()
      }
      const forceExit = (sender = event) => mocks.handlers.get('app:force-exit')!(sender)
      expect(await forceExit({ ...event, sender: {} } as typeof event)).toMatchObject({ ok: false })
      expect(mocks.confirm).not.toHaveBeenCalled()
      let cancel!: (result: { response: number }) => void
      mocks.confirm.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            cancel = resolve
          }),
      )
      const cancelled = forceExit()
      await forceExit()
      expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          buttons: ['取消', '强制关闭'],
          defaultId: 0,
          cancelId: 0,
        }),
      )
      cancel({ response: 0 })
      expect(await cancelled).toEqual({ ok: true, value: undefined })
      expect(mocks.flush).not.toHaveBeenCalled()
      expect(mocks.forceStopHost).not.toHaveBeenCalled()
      expect(mocks.exit).not.toHaveBeenCalled()

      mocks.confirm.mockResolvedValue({ response: 1 })
      if (outcome === 'failure') {
        mocks.flush.mockRejectedValueOnce(new Error('save failed'))
        expect(await forceExit()).toMatchObject({ ok: false, error: 'save failed' })
        expect(mocks.forceStopHost).not.toHaveBeenCalled()
        mocks.forceStopHost.mockRejectedValueOnce(new Error('cleanup failed'))
        expect(await forceExit()).toMatchObject({ ok: false, error: 'cleanup failed' })
        expect(mocks.exit).not.toHaveBeenCalled()
        expect(mocks.disconnect).not.toHaveBeenCalled()
        await forceExit()
      } else {
        vi.useFakeTimers()
        try {
          let finish!: () => void
          mocks.forceStopHost.mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve
              }),
          )
          const closing = forceExit()
          await vi.advanceTimersByTimeAsync(5001)
          expect(mocks.exit).not.toHaveBeenCalled()
          expect(mocks.disconnect).not.toHaveBeenCalled()
          await forceExit()
          expect(mocks.forceStopHost).toHaveBeenCalledOnce()
          finish()
          expect(await closing).toEqual({ ok: true, value: undefined })
        } finally {
          vi.useRealTimers()
        }
      }
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
    },
  )

  it('cleans an incompatible Host before closing after startup failure', async () => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.connectFailure = new Error('Terminal Host 协议版本不兼容，请先结束旧会话。')
    mocks.confirm.mockResolvedValue({ response: 0 })
    vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await import('../src/main/index')
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
      const forceExit = (sender = event) => mocks.handlers.get('app:force-exit')!(sender)
      expect(await forceExit({ ...event, sender: {} } as typeof event)).toMatchObject({ ok: false })
      expect(mocks.confirm).not.toHaveBeenCalled()

      const preventDefault = vi.fn()
      mocks.appEvents.get('before-quit')!({ preventDefault })
      await new Promise(setImmediate)
      expect(preventDefault).toHaveBeenCalledOnce()
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

      let finish!: () => void
      mocks.forceStopHost.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      )
      const closing = forceExit()
      await new Promise(setImmediate)
      expect(mocks.forceStopHost).toHaveBeenCalledTimes(2)
      mocks.appEvents.get('before-quit')!({ preventDefault })
      await forceExit()
      expect(mocks.confirm).toHaveBeenCalledTimes(3)
      expect(mocks.exit).not.toHaveBeenCalled()
      finish()
      expect(await closing).toEqual({ ok: true, value: undefined })
      expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0)
      expect(mocks.forceStopHost).toHaveBeenLastCalledWith('/tmp/cota-removal-test')
      expect(mocks.shutdown).not.toHaveBeenCalled()
      expect(mocks.disconnect).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      mocks.connectFailure = undefined
      vi.unstubAllEnvs()
    }
  })
})
