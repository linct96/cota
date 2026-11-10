import { beforeAll, beforeEach, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { NotificationSound } from '../../../src/shared/notification-sounds'
import { hookFiles } from '../../../src/main/agents/hooks/managed'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import type { AgentUpdate, Preferences, WorktreeRecord } from '../../../src/shared/contracts'
import type * as FsModule from 'node:fs'
import type * as ChildProcessModule from 'node:child_process'
import type { AgentCliCache } from '../../../src/shared/agent-cli'
import type * as ManagedModule from '../../../src/main/agents/hooks/managed'
import type * as ShellModule from '../../../src/main/system/shell'

const mocks = vi.hoisted(() => {
  const frame = { url: 'http://localhost:5173/' }
  const config: {
    agentCliCache: AgentCliCache
    preferences: Pick<
      Preferences,
      | 'notificationsEnabled'
      | 'confirmCloseRunningTerminal'
      | 'notificationSound'
      | 'turnCompleteNotification'
      | 'scrollback'
      | 'openWith'
    >
    recentProjects: string[]
    worktreeRecords: WorktreeRecord[]
  } = {
    agentCliCache: {
      checkedAt: 1,
      pathEnv: '/tmp',
      entries: [
        { provider: 'pi', executable: '/tmp/pi-fixture', version: '1.3.0' },
        { provider: 'codex', executable: '/tmp/codex-fixture', version: '0.159.0' },
        { provider: 'claude', executable: '/tmp/claude-fixture', version: '2.1.196' },
      ],
    },
    preferences: {
      notificationsEnabled: true,
      confirmCloseRunningTerminal: true,
      notificationSound: 'system',
      turnCompleteNotification: 'unfocused',
      scrollback: 5000,
      openWith: [{ id: 'zed', name: 'Zed', command: 'zed', arguments: '{path}' }],
    },
    recentProjects: [],
    worktreeRecords: [],
  }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    appEvents: new Map<string, (event: { preventDefault: () => void }) => void>(),
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
    trustHook: vi.fn(),
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
    config,
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
    closeCliInstalls: vi.fn(),
    flush: vi.fn(),
    saveLayout: vi.fn(),
    shutdown: vi.fn(),
    forceStopHost: vi.fn(),
    connectFailure: undefined as Error | undefined,
    disconnect: vi.fn(),
    detachAll: vi.fn(),
    buildMenu: vi.fn(
      (template: { submenu?: { label?: string; click?: () => void }[] }[]) => template,
    ),
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
    hostingCapture: vi.fn(),
    hostingResolve: vi.fn(),
    hostingInspect: vi.fn(),
  }
})
vi.mock('../../../src/main/settings/notification-sound', () => ({
  readNotificationSound: mocks.readSound,
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  mkdirSync: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: mocks.spawn,
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    on: (name: string, listener: (event: { preventDefault: () => void }) => void) =>
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
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: mocks.buildMenu },
}))
vi.mock('../../../src/main/git/worktrees/manager', () => ({
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
vi.mock('../../../src/main/code-hosting/service', () => ({
  CodeHostingService: class {
    capture = mocks.hostingCapture
    resolveContext = mocks.hostingResolve
    inspect = mocks.hostingInspect
    prune = vi.fn()
    close = vi.fn()
    invalidateRemoteBranches = vi.fn()
  },
}))
vi.mock('../../../src/main/git/branches/service', () => ({
  isBranchMutation: (input: { action: string }) =>
    [
      'fetch',
      'pull',
      'push',
      'publish',
      'sync',
      'create-branch',
      'create-and-switch-branch',
      'switch-branch',
      'delete-branch',
    ].includes(input.action),
  BranchService: class {
    subscribe = vi.fn()
    release = vi.fn()
    prune = vi.fn()
    invalidate = vi.fn()
    invalidateRepository = vi.fn()
    invalidateProjects = vi.fn()
    mutate = mocks.gitMutate
    close = vi.fn()
    async query(path: string) {
      const references = await mocks.gitReferences(path)
      return {
        snapshot: { branches: references?.branches || [], remoteHeads: [] },
        remotes: references?.remotes || [],
      }
    }
  },
}))
vi.mock('../../../src/main/git/source-control/service', () => ({
  SourceControlService: class {
    status = mocks.gitStatus
    diff = mocks.gitDiff
    mutate = mocks.gitMutate
    references = mocks.gitReferences
    history = mocks.gitHistory
    compare = mocks.gitCompare
  },
}))
vi.mock('../../../src/main/system/open-with', () => ({
  openWorkspaceWith: mocks.openWorkspaceWith,
  listWorkspaceOpeners: mocks.listWorkspaceOpeners,
}))
vi.mock('../../../src/main/agents/cli/registry', () => ({
  detectAgents: mocks.detectAgents,
  resolveAgent: (provider: string, _settings: unknown, cache: AgentCliCache) => {
    try {
      return Promise.resolve({
        executable: cache.entries.find((entry) => entry.provider === provider)?.executable,
        cliExecutable: cache.entries.find((entry) => entry.provider === provider)?.executable,
        args: [],
        env: {},
      })
    } catch (cause) {
      return Promise.reject(cause)
    }
  },
}))
vi.mock('../../../src/main/agents/hooks/managed', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedModule>()),
  inspectAgentHook: mocks.inspectHook,
  installAgentHook: mocks.installHook,
  trustAgentHook: mocks.trustHook,
  uninstallAgentHook: mocks.uninstallHook,
}))
vi.mock('../../../src/main/system/shell', async (original) => ({
  ...(await original<typeof ShellModule>()),
  resolveShell: mocks.resolveShell,
  loginShellEnvironment: vi.fn().mockResolvedValue({ HOME: '/tmp/cota-hook-fixture' }),
  shellEnvironment: () => ({ HOME: '/tmp/cota-hook-fixture' }),
}))
vi.mock('../../../src/main/agents/cli/install-terminal', () => ({
  AgentCliInstallTerminals: class {
    close = mocks.closeCliInstalls
    detachAll = vi.fn()
  },
}))
vi.mock('../../../src/main/accounts/service', () => ({
  AccountService: class {
    close = vi.fn().mockResolvedValue(undefined)
  },
}))
vi.mock('../../../src/main/settings/config-store', () => ({
  ConfigStore: class {
    load = () => Promise.resolve({})
    forget = mocks.forget
    closeWorkspace = mocks.saveWorkspaceClosure
    saveLayout = mocks.saveLayout
    flush = mocks.flush
    snapshot = () => structuredClone(mocks.config)
    saveAgentClis = (cache: AgentCliCache) => {
      try {
        mocks.config.agentCliCache = structuredClone(cache)

        return Promise.resolve()
      } catch (cause) {
        return Promise.reject(cause)
      }
    }
    remember = mocks.remember
  },
}))
vi.mock('../../../src/main/host/host-client', () => ({
  forceStopTerminalHost: mocks.forceStopHost,
  connectTerminalHost: (_path: string, _send: unknown, sendAgent: (event: AgentUpdate) => void) => {
    try {
      if (mocks.connectFailure) throw mocks.connectFailure
      mocks.sendAgent = sendAgent
      return Promise.resolve({
        disconnect: mocks.disconnect,
        detachAll: mocks.detachAll,
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
      })
    } catch (cause) {
      return Promise.reject(cause)
    }
  },
}))

const initialPreferences = structuredClone(mocks.config.preferences)
const initialAgentCliCache = structuredClone(mocks.config.agentCliCache)
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
const stopAllAndQuit = () => {
  const template = mocks.buildMenu.mock.calls.at(-1)![0]
  template
    .flatMap((menu) => menu.submenu || [])
    .find((item) => item.label === '结束全部任务并退出')!.click!()
}

async function blockHookInspectionUntilInstallStops() {
  let finishInspection!: () => void
  mocks.detectAgents.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishInspection = () => resolve(initialAgentCliCache.entries)
      }),
  )
  // Model Codex inspection waiting for the CLI installation to leave its shared queue.
  void mocks.handlers.get('agent:hooks-install')!(event, 'codex')
  await vi.waitFor(() => expect(mocks.detectAgents).toHaveBeenCalledOnce())
  mocks.closeCliInstalls.mockImplementationOnce(() => {
    try {
      return Promise.resolve(finishInspection())
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
}

beforeAll(async () => {
  mocks.config.preferences = { ...DEFAULT_CONFIG.preferences, ...mocks.config.preferences }
  vi.stubEnv('ELECTRON_RENDERER_URL', mocks.contents.mainFrame.url)
  try {
    await import('../../../src/main/index')
    await vi.waitFor(() => expect(mocks.handlers.has('workspace:remove')).toBe(true))
  } finally {
    vi.unstubAllEnvs()
  }
})
beforeEach(() => {
  mocks.contents.mainFrame.url = 'http://localhost:5173/'
  vi.clearAllMocks()
  mocks.config.preferences = {
    ...DEFAULT_CONFIG.preferences,
    ...structuredClone(initialPreferences),
  }
  mocks.windowFocused = false
  mocks.notificationSupported = true
  mocks.notificationFails = false
  mocks.notificationFailedEvent = false
  mocks.notificationError = ''
  mocks.contents.send.mockImplementation((channel: string, value: unknown) => {
    if (channel === 'app:exit-layout-request')
      void mocks.handlers.get('app:exit-layout')!(event, value, undefined)
  })
  mocks.saveLayout.mockReset().mockResolvedValue(undefined)
  mocks.readSound.mockImplementation((sound: NotificationSound) =>
    Promise.resolve(typeof sound === 'string' ? undefined : 'data:audio/mpeg;base64,SUQz'),
  )
  mocks.closeWorkspace.mockResolvedValue(undefined)
  mocks.closeProject.mockResolvedValue(undefined)
  mocks.forget.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue([])
  mocks.scanWorktrees.mockImplementation(() =>
    Promise.resolve({
      entries: [],
      external: [],
      repository: { status: 'nonGit', projectPath: path, error: 'not Git' },
    }),
  )
  mocks.saveWorkspaceClosure.mockResolvedValue(undefined)
  mocks.withTerminalTarget.mockImplementation((workspaceTarget, action) => {
    try {
      return Promise.resolve(
        action({
          projectPath: workspaceTarget.projectPath,
          workspaceId: workspaceTarget.workspaceId,
          cwd: workspaceTarget.projectPath,
          workspaceKind: 'local',
        }),
      )
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  mocks.config.agentCliCache = structuredClone(initialAgentCliCache)
  mocks.config.recentProjects = []
  mocks.config.preferences.confirmCloseRunningTerminal = true
  mocks.remember.mockImplementation((filePath: string) => {
    try {
      mocks.config.recentProjects.push(filePath)

      return Promise.resolve()
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  mocks.setScrollback.mockResolvedValue(undefined)
  mocks.hasLive.mockResolvedValue(true)
  mocks.needsCloseConfirmation.mockResolvedValue(true)
  mocks.close.mockResolvedValue(undefined)
  mocks.closeCliInstalls.mockReset().mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.shutdown.mockResolvedValue(undefined)
  mocks.detachAll.mockReset().mockResolvedValue(undefined)
  mocks.forceStopHost.mockReset().mockResolvedValue(undefined)
  mocks.connectFailure = undefined
  mocks.openWorkspaceWith.mockResolvedValue(undefined)
  mocks.openPath.mockResolvedValue('')
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
  mocks.detectAgents.mockResolvedValue([
    { provider: 'codex', version: '0.159.0', executable: '/tmp/codex-fixture' },
  ])
  mocks.inspectHook.mockImplementation((provider, env) => {
    try {
      const { config, loader } = hookFiles(provider, env)
      return Promise.resolve({
        provider,
        state: 'missing',
        paths: provider === 'codex' ? [loader, config] : [config],
        detail: 'missing',
      })
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  mocks.uninstallHook.mockImplementation((provider) =>
    Promise.resolve({
      provider,
      state: 'missing',
      paths: ['/tmp/cota-hook-fixture/hooks.json'],
      detail: 'missing',
    }),
  )
  mocks.trustHook.mockImplementation((provider) =>
    Promise.resolve({
      provider,
      state: 'installed',
      paths: ['/tmp/cota-hook-fixture/hooks.json'],
      detail: 'trusted',
    }),
  )
  mocks.installHook.mockImplementation((provider) =>
    Promise.resolve({
      provider,
      state: 'installed',
      paths: ['/tmp/cota-hook-fixture/hooks.json'],
      detail: 'installed',
    }),
  )
})

export {
  mocks,
  event,
  path,
  target,
  extra,
  remove,
  stopAllAndQuit,
  blockHookInspectionUntilInstallStops,
  initialAgentCliCache,
}
