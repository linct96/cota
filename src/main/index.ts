import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { ConfigStore } from './config'
import { projectBranch } from './git'
import { WorktreeManager } from './worktree-manager'
import { WorktreeError } from './git-worktrees'
import { openWorkspaceWith } from './open-with'
import { detectAgents } from './agents'
import { inspectAgentHook, installAgentHook, uninstallAgentHook } from './agents/managed-hooks'
import { loginShellEnvironment, shellEnvironment } from './shell'
import { AGENT_PROVIDERS, type AgentProvider } from '../shared/contracts'
import { connectTerminalHost, type HostClient } from './host-client'
import { AgentNotifications } from './agent-notifications'
import {
  absolutePath,
  agentProvider,
  executable,
  preferences,
  projectDirectory,
  terminalId,
  terminalLaunch,
  workspaceRemoval,
} from './validation'
import type {
  AttachTerminal,
  AgentSession,
  ConfirmationRequest,
  CreateTerminal,
  Result,
  Shortcut,
  WorkspaceLayout,
  WorkspaceTarget,
  WorktreeScan,
} from '../shared/contracts'

type RemovalTarget = { projectPath: string; workspaceId?: string; removeProject: boolean }

let window: BrowserWindow | undefined
let manager: HostClient
let config: ConfigStore
let worktrees: WorktreeManager
let warning: string | undefined
let exiting = false
let exitPending = false
let rendererReady = false
let visibleTerminal: string | undefined
let pendingAgentFocus: { terminalId: string; launchId: string } | undefined
const notifications = new AgentNotifications({
  isVisible: (id) => !!window?.isFocused() && !window.isMinimized() && visibleTerminal === id,
  describe: (session) => {
    const workspace = config
      .snapshot()
      .layout?.workspaces.find((entry) => entry.id === session.workspaceId)
    return `${basename(session.projectPath)} · ${workspace?.name || basename(session.cwd)}`
  },
  activate: async (session: AgentSession) => {
    const current = (await manager.request('list', [])).find(
      (entry) => entry.id === session.terminalId && entry.agent?.launchId === session.launchId,
    )
    if (!current || !window || window.webContents.isDestroyed()) return
    pendingAgentFocus = { terminalId: session.terminalId, launchId: session.launchId }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    sendAgentFocus()
  },
})
let pendingConfirmation: { id: string; resolve(confirmed: boolean): void } | undefined
let removingWorkspace: RemovalTarget | undefined
const closingTabs = new Set<string>()
const appName = app.isPackaged ? 'Cota' : 'Cota Dev'
const rendererFile = join(__dirname, '../renderer/index.html')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererURL = new URL(devURL || pathToFileURL(rendererFile).href).href.split('#')[0]

function trusted(event: {
  sender: Electron.WebContents
  senderFrame: Electron.WebFrameMain | null
}): void {
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
        return { ok: true, value: await action(...(args as Args)) }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '操作失败。',
          ...(error instanceof WorktreeError ? { code: error.code, details: error.details } : {}),
        }
      }
    },
  )
}

function sendShortcut(shortcut: Shortcut): void {
  if (window && !window.webContents.isDestroyed()) window.webContents.send('app:shortcut', shortcut)
}

function sendAgentFocus(): void {
  if (!rendererReady || !pendingAgentFocus || !window || window.webContents.isDestroyed()) return
  window.webContents.send('agent:focus', pendingAgentFocus)
  pendingAgentFocus = undefined
}

function settleConfirmation(confirmed: boolean): void {
  const pending = pendingConfirmation
  pendingConfirmation = undefined
  pending?.resolve(confirmed)
}

function requestConfirmation(request: Omit<ConfirmationRequest, 'id'>): Promise<boolean> {
  if (!rendererReady || !window || window.webContents.isDestroyed() || pendingConfirmation)
    return Promise.resolve(false)
  const id = randomUUID()
  return new Promise<boolean>((resolve) => {
    pendingConfirmation = { id, resolve }
    try {
      if (window!.isMinimized()) window!.restore()
      window!.show()
      window!.focus()
      window!.webContents.send('app:confirm', { ...request, id })
    } catch {
      settleConfirmation(false)
    }
  })
}

async function removeTarget(target: RemovalTarget): Promise<boolean> {
  if (removingWorkspace || worktrees?.removing || exitPending || exiting || closingTabs.size)
    return false
  removingWorkspace = target
  try {
    if (target.workspaceId) {
      await manager.request('closeWorkspace', [
        {
          projectPath: target.projectPath,
          workspaceId: target.workspaceId,
        },
      ])
    } else {
      await manager.request('closeProject', [target.projectPath])
    }
    if (target.workspaceId) await config.closeWorkspace(target.workspaceId)
    if (target.removeProject) await config.forget(target.projectPath)
    return true
  } catch (error) {
    throw new Error(
      `删除未完成，${target.workspaceId ? '工作区' : '项目'}仍保留；部分终端可能已结束，请重试。${String(error)}`,
    )
  } finally {
    removingWorkspace = undefined
  }
}

function installIPC(): void {
  handle('app:bootstrap', async () => {
    rendererReady = true
    const sessions = await manager.request('list', [])
    // A live Host session must not disappear just because its project aged out of recent items.
    for (const { projectPath } of sessions)
      if (!config.snapshot().recentProjects.includes(projectPath))
        await config.remember(projectPath)
    const initial = config.snapshot()
    const worktreeScans: Record<string, WorktreeScan> = Object.fromEntries(
      await Promise.all(
        [
          ...new Set([
            ...initial.recentProjects,
            ...initial.worktreeRecords.map((entry) => entry.projectPath),
          ]),
        ].map(async (path) => [path, await worktrees.scanWorktrees(path, sessions, true)]),
      ),
    )
    for (const session of sessions) {
      if (session.workspaceKind !== 'git-worktree') continue
      const snapshot = config.snapshot()
      const record = snapshot.worktreeRecords.find(
        (entry) =>
          entry.id === session.worktreeId &&
          entry.projectPath === session.projectPath &&
          entry.path === session.cwd &&
          entry.repoCommonDir === session.repoCommonDir,
      )
      if (
        record &&
        worktreeScans[record.projectPath]?.entries.some(
          (entry) => entry.record.id === record.id && entry.status === 'ready',
        ) &&
        !snapshot.layout?.workspaces.some(
          (entry) =>
            entry.id === session.workspaceId ||
            (entry.kind === 'git-worktree' && entry.worktreeId === record.id),
        )
      )
        await config.registerWorktree(record, {
          id: session.workspaceId,
          projectPath: session.projectPath,
          name: record.initialBranch || '恢复的 Worktree',
          kind: 'git-worktree',
          worktreeId: record.id,
        })
    }
    const snapshot = config.snapshot()
    await manager.request('setScrollback', [snapshot.preferences.scrollback])
    const result = {
      config: snapshot,
      sessions: await manager.request('list', []),
      warning,
      worktreeScans,
    }
    sendAgentFocus()
    return result
  })
  handle('app:confirm-response', (id: unknown, confirmed: unknown) => {
    if (typeof id !== 'string' || typeof confirmed !== 'boolean') throw new Error('确认参数无效。')
    if (pendingConfirmation?.id !== id) throw new Error('确认请求已失效。')
    settleConfirmation(confirmed)
  })
  handle('workspace:save-layout', (value: WorkspaceLayout) => config.saveLayout(value))
  handle('project:open', async () => {
    const selected = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const path = await projectDirectory(selected.filePaths[0])
    if (removingWorkspace) throw new Error('正在删除工作区，请稍后再打开目录。')
    await config.remember(path)
    return path
  })
  handle('project:select', async (value: unknown) => {
    const path = await projectDirectory(value)
    if (removingWorkspace) throw new Error('正在删除工作区，请稍后再切换。')
    if (
      !config.snapshot().recentProjects.includes(path) &&
      config.snapshot().worktreeRecords.some((record) => record.projectPath === path)
    )
      await config.remember(path)
  })
  handle('project:branch', projectBranch)
  handle('git:inspect-repository', (path: string) => worktrees.inspectRepository(path))
  handle('git:list-worktrees', (path: string) => worktrees.listWorktrees(path))
  const assertLifecycle = () => {
    if (removingWorkspace || worktrees.removing || closingTabs.size || exitPending || exiting)
      throw new Error('正在关闭或移除工作区，请稍后重试。')
  }
  handle('git:plan-worktree', (input: unknown) => {
    assertLifecycle()
    return worktrees.planWorktree(input)
  })
  handle('git:branches', (path: string) => worktrees.localBranches(path))
  handle('git:suggest-worktree-name', (path: string) => {
    assertLifecycle()
    return worktrees.suggestName(path)
  })
  handle('git:scan-worktrees', async (path: string) =>
    worktrees.scanWorktrees(path, await manager.request('list', []), true),
  )
  handle('git:create-worktree', (input: unknown) => {
    assertLifecycle()
    return worktrees.createWorktree(input)
  })
  handle('git:link-worktree', (path: string, target: string) => {
    assertLifecycle()
    return worktrees.linkWorktree(path, target)
  })
  handle('git:inspect-removal', async (id: string) =>
    worktrees.inspectRemoval(id, await manager.request('list', [])),
  )
  handle('git:remove-worktree', (id: string, deleteBranch: unknown) => {
    assertLifecycle()
    if (typeof deleteBranch !== 'boolean') throw new Error('删除分支参数无效。')
    return worktrees.removeWorktree(id, {
      deleteBranch,
      sessions: () => manager.request('list', []),
      close: (id) => manager.request('close', [id]),
      confirm: (check, force) =>
        requestConfirmation({
          title: force ? '强制删除工作树' : '删除工作树',
          description: force
            ? `将永久删除 ${check.worktreePath} 及关联工作区，丢弃未提交、未跟踪和忽略的文件，并结束关联终端。${deleteBranch && check.currentBranch ? `同时强制删除本地分支 ${check.currentBranch}，未合并提交可能丢失。` : ''}此操作可能无法恢复。`
            : `将删除 ${check.worktreePath} 及关联工作区，并结束关联终端。${check.currentBranch ? (deleteBranch ? `同时删除本地分支 ${check.currentBranch}。` : '本地分支保留。') : ''}`,
          confirmLabel: force ? '强制删除' : '删除',
        }),
    })
  })
  handle('git:unlink-worktree', (id: string) => {
    assertLifecycle()
    return worktrees.unlinkWorktree(id, {
      sessions: () => manager.request('list', []),
      close: (id) => manager.request('close', [id]),
      confirm: () =>
        requestConfirmation({
          title: '移除工作区关联',
          description: '将结束关联终端并移除 Cota 工作区与登记，不删除工作树目录或本地分支。',
          confirmLabel: '删除',
        }),
    })
  })
  handle('workspace:path', (target: WorkspaceTarget) =>
    worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
  )
  handle('workspace:open-with', async (path: unknown, openerId: unknown) => {
    const directory =
      typeof path === 'string'
        ? absolutePath(path)
        : await worktrees.withTerminalTarget(
            path as WorkspaceTarget,
            async (binding) => binding.cwd,
          )
    const snapshot = config.snapshot()
    if (typeof path === 'string' && !snapshot.recentProjects.includes(directory))
      throw new Error('请先打开项目目录。')
    const systemFileManager = openerId === 'system-file-manager'
    const opener = snapshot.preferences.openWith.find((entry) => entry.id === openerId)
    if (!systemFileManager && !opener) throw new Error('打开方式不存在，请检查设置。')
    try {
      if (systemFileManager) {
        const error = await shell.openPath(await projectDirectory(directory))
        if (error) throw new Error(error)
      } else if (opener) {
        await openWorkspaceWith(directory, opener)
      }
    } catch (error) {
      await requestConfirmation({
        title: `无法使用 ${systemFileManager ? '文件管理器' : opener?.name} 打开工作区`,
        description: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })
  handle('workspace:remove', (value: unknown) => removeTarget(workspaceRemoval(value)))
  handle('project:remove', (value: unknown) =>
    removeTarget({ projectPath: absolutePath(value), removeProject: true }),
  )
  handle('preferences:save', async (value: unknown) => {
    const next = preferences(value)
    if (next.shellPath) await executable(next.shellPath)
    await config.savePreferences(next)
    await manager.request('setScrollback', [next.scrollback])
    return next
  })
  handle('agent:detect', () => detectAgents(config.snapshot().preferences))
  handle('agent:hooks-detect', async () => {
    const settings = config.snapshot().preferences
    const [env, agents] = await Promise.all([
      loginShellEnvironment(settings),
      detectAgents(settings),
    ])
    return Promise.all(
      (Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) =>
        inspectAgentHook(
          provider,
          env,
          agents.find((agent) => agent.provider === provider)?.version,
        ),
      ),
    )
  })
  for (const operation of ['install', 'uninstall'] as const) {
    handle(`agent:hooks-${operation}`, async (value: unknown) => {
      const provider = agentProvider(value)
      const env = shellEnvironment()
      const uninstall = operation === 'uninstall'
      const label = uninstall ? '卸载' : '安装'
      const trust = !uninstall && provider === 'codex'
      // Codex supplies the native trust hashes and selects supported Hook events.
      const codex = trust
        ? (await detectAgents(config.snapshot().preferences)).find(
            (agent) => agent.provider === provider,
          )
        : undefined
      if (trust && !codex?.executable) throw new Error('找不到 Codex，无法安装并信任 Hooks。')
      const version = codex?.version
      const status = await inspectAgentHook(provider, env, version)
      if (status.state === 'conflict' || status.state === 'error') throw new Error(status.detail)
      if (!rendererReady || !window || window.webContents.isDestroyed() || pendingConfirmation)
        throw new Error(
          `当前无法显示${label}确认，请关闭其他确认弹窗后重试；仍无响应时请重新打开应用。`,
        )
      if (
        !(await requestConfirmation({
          title: `${trust ? '安装并信任' : label} ${AGENT_PROVIDERS[provider].name} 的 Cota 状态集成？`,
          description: uninstall
            ? `仅在本次确认后移除以下文件中的 Cota 集成：\n${status.paths[0]}\n\n保留其他 Hooks 和配置，卸载不创建备份；共享加载脚本不删除。Dev / 正式版共用此配置，均受影响。不会结束正在运行的 Agent，已加载的集成需重启对应 CLI 后停止生效。`
            : `仅在本次确认后写入以下文件：\n${status.paths.join('\n')}\n\n保留原有 Hooks，修改已有文件前创建备份。${trust ? '同时授权信任本次安装的 Cota Hooks，使用 Codex 原生定义哈希；不信任其他 Hooks，不修改 Hooks 功能开关，不绕过企业策略。' : ''}不改变 CLI 权限。安装后请新建终端。`,
          confirmLabel: `${trust ? '安装并信任' : label} ${provider === 'pi' ? 'Extension' : 'Hooks'}`,
        }))
      )
        return null
      return uninstall
        ? uninstallAgentHook(provider, env)
        : installAgentHook(
            provider,
            trust ? await loginShellEnvironment(config.snapshot().preferences) : env,
            version,
            codex?.executable,
          )
    })
  }
  handle('agent:visible', (id: unknown) => {
    visibleTerminal = id === undefined ? undefined : terminalId(id)
  })
  handle('agent:read', (id: unknown, launchId: unknown, revision: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0)
      throw new Error('Agent 状态版本无效。')
    return manager.request('readAgent', [terminalId(id), terminalId(launchId), Number(revision)])
  })
  handle('terminal:create', (value: CreateTerminal) => {
    if (!value || typeof value !== 'object') throw new Error('终端参数无效。')
    if (
      removingWorkspace?.projectPath === value.projectPath &&
      (removingWorkspace.removeProject || removingWorkspace.workspaceId === value.workspaceId)
    )
      throw new Error('正在删除此工作区，无法新建终端。')
    const launch = terminalLaunch(value)
    const snapshot = config.snapshot()
    if (exiting || exitPending) throw new Error('应用正在退出。')
    return worktrees.withTerminalTarget(value, (binding) => {
      if (
        (removingWorkspace?.projectPath === value.projectPath &&
          (removingWorkspace.removeProject ||
            removingWorkspace.workspaceId === value.workspaceId)) ||
        worktrees.removing ||
        exiting ||
        exitPending
      )
        throw new Error('工作区正在关闭，无法新建终端。')
      return manager.request('create', [
        { id: value.id, cols: value.cols, rows: value.rows, ...binding, ...launch },
        snapshot.preferences,
      ])
    })
  })
  handle('terminal:attach', (value: AttachTerminal) => {
    if (!value || !config.snapshot().recentProjects.includes(value.projectPath))
      throw new Error('请先打开项目目录。')
    return worktrees.withTerminalTarget(value, (binding) =>
      manager.request('attach', [{ id: value.id, attachmentId: value.attachmentId, ...binding }]),
    )
  })
  handle('terminal:detach', (id: string, attachmentId: string) =>
    manager.request('detach', [id, attachmentId]),
  )
  handle('terminal:write', (id: string, data: string) => {
    if (closingTabs.has(id)) throw new Error('终端正在关闭，暂不接受输入。')
    return manager.request('write', [id, data])
  })
  handle('terminal:resize', (id: string, cols: number, rows: number) =>
    manager.request('resize', [id, cols, rows]),
  )
  handle('terminal:close', async (value: unknown) => {
    const id = terminalId(value)
    if (closingTabs.size || exitPending || removingWorkspace || worktrees.removing) return false
    closingTabs.add(id)
    try {
      const needsConfirmation = await manager
        .request('needsCloseConfirmation', [id])
        .catch(() => true)
      if (
        needsConfirmation &&
        !(await requestConfirmation({
          title: '关闭终端？',
          description:
            '将结束此终端及其中正在执行的程序（包括 Agent），终端输出不保留。其他终端不受影响。',
          confirmLabel: '结束并关闭终端',
        }))
      )
        return false
      await manager.request('close', [id])
      return true
    } finally {
      closingTabs.delete(id)
    }
  })
  ipcMain.on('terminal:ack', (event, id: string, attachmentId: string, length: number) => {
    try {
      trusted(event)
      void manager.request('acknowledge', [id, attachmentId, length]).catch(() => {})
    } catch {
      /* Ignore malformed fire-and-forget acknowledgements. */
    }
  })
  ipcMain.on('app:close-window', (event) => {
    try {
      trusted(event)
      window?.close()
    } catch {
      /* No capabilities for other frames. */
    }
  })
}

async function requestExit(): Promise<void> {
  if (exitPending || exiting || closingTabs.size || removingWorkspace || worktrees?.removing) return
  exitPending = true
  try {
    if (await manager.request('hasLive', [])) {
      if (
        !(await requestConfirmation({
          title: '退出 Cota？',
          description: '退出将结束所有终端及运行中的程序，项目设置将会保留。',
          confirmLabel: '结束终端并退出',
        }))
      )
        return
    }
    await config.flush()
    await manager.request('shutdown', [])
    manager.disconnect()
    exiting = true
    app.quit()
  } catch (error) {
    await requestConfirmation({
      title: '终端清理失败，应用暂未退出。',
      description: String(error),
    })
  } finally {
    exitPending = false
  }
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendShortcut('settings') },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: 'Open Folder…', accelerator: 'Cmd+O', click: () => sendShortcut('open-folder') },
          {
            label: 'New Terminal',
            accelerator: 'Cmd+T',
            click: () => sendShortcut('new-terminal'),
          },
          {
            label: 'Close Terminal / Window',
            accelerator: 'Cmd+W',
            click: () => sendShortcut('close-terminal'),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Terminal',
        submenu: Array.from({ length: 9 }, (_, i) => ({
          label: `Select Terminal ${i + 1}`,
          accelerator: `Cmd+${i + 1}`,
          click: () => sendShortcut(`tab-${i + 1}`),
        })),
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]),
  )
}

if (!app.isPackaged) {
  const userData = join(app.getPath('appData'), appName)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  app.setName(appName)
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app.on('before-quit', (event) => {
    if (!exiting && manager) {
      event.preventDefault()
      void requestExit()
    }
  })
  app
    .whenReady()
    .then(async () => {
      app.setName(appName)
      nativeTheme.themeSource = 'light'
      config = new ConfigStore(join(app.getPath('userData'), 'config.json'))
      warning = (await config.load()).warning
      worktrees = new WorktreeManager(
        config,
        join(homedir(), app.isPackaged ? '.cota' : '.cota-dev', 'worktrees'),
      )
      manager = await connectTerminalHost(
        app.getPath('userData'),
        (event) => {
          if (window && !window.webContents.isDestroyed())
            window.webContents.send('terminal:event', event)
        },
        (event) => {
          notifications.receive(event)
          if (window && !window.webContents.isDestroyed())
            window.webContents.send('agent:event', event)
        },
      )
      for (const session of await manager.request('list', []))
        if (session.agent) notifications.receive({ type: 'state', session: session.agent })
      window = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 760,
        minHeight: 480,
        backgroundColor: '#ffffff',
        show: false,
        title: appName,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 16, y: 14 },
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      window.webContents.session.setPermissionCheckHandler(() => false)
      window.on('close', (event) => {
        if (!exiting) {
          event.preventDefault()
          void requestExit()
        }
      })
      const rendererUnavailable = () => {
        rendererReady = false
        visibleTerminal = undefined
        settleConfirmation(false)
        void manager.detachAll().catch(() => {})
      }
      window.webContents.on('did-start-navigation', (details) => {
        // Hash routes keep the same renderer and its confirmation listener alive.
        if (details.isMainFrame && !details.isSameDocument) rendererUnavailable()
      })
      window.webContents.on('render-process-gone', rendererUnavailable)
      window.webContents.on('destroyed', rendererUnavailable)
      window.once('ready-to-show', () => window?.show())
      installIPC()
      installMenu()
      if (devURL) await window.loadURL(devURL)
      else await window.loadFile(rendererFile)
    })
    .catch((error) => {
      dialog.showErrorBox(`${appName} 启动失败`, String(error))
      app.exit(1)
    })
}
