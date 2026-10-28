import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  powerMonitor,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { ConfigStore } from './config'
import { readNotificationSound } from './notification-sound'
import { NOTIFICATION_SOUND_EXTENSIONS } from '../shared/notification-sounds'
import {
  COTA_SHORTCUTS,
  isTerminalMenuShortcut,
  shortcutBinding,
  type ShortcutBindings,
} from '../shared/shortcuts'
import { AccountService } from './accounts/service'
import { projectBranch } from './git/project-branch'
import { SourceControlService } from './git/source-control'
import { SourceControlWatches } from './git/source-control-watch'
import { FileExplorerService } from './files/file-explorer'
import { FileExplorerWatches } from './files/file-explorer-watch'
import type { FileAction } from '../shared/file-explorer'
import type {
  GitDiffSelection,
  GitMutation,
  GitHistoryRequest,
  GitCompareRequest,
} from '../shared/source-control'
import { WorktreeManager } from './git/worktree-manager'
import { WorktreeSetupService } from './git/worktree-setup'
import { WorktreeError } from './git/git-worktrees'
import { listWorkspaceOpeners, openWorkspaceWith } from './system/open-with'
import { detectAgents } from './agents/registry'
import { AgentCliManagement } from './agents/cli-management'
import { CommitMessageService } from './agents/commit-message-service'
import type { CommitMessageRequest } from '../shared/commit-message'
import {
  hookFiles,
  inspectAgentHook,
  installAgentHook,
  uninstallAgentHook,
} from './agents/managed-hooks'
import { loginShellEnvironment, resolveShell, shellEnvironment } from './system/shell'
import { AGENT_PROVIDERS, type AgentProvider } from '../shared/contracts'
import { connectTerminalHost, forceStopTerminalHost, type HostClient } from './host/host-client'
import { AgentNotifications } from './agents/agent-notifications'
import { AgentSleepPrevention } from './agents/agent-sleep-prevention'
import {
  absolutePath,
  agentProvider,
  executable,
  preferences,
  projectDirectory,
  terminalId,
  terminalLaunch,
  startupCommand,
  workspaceRemoval,
  workspaceTarget,
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
let windowBlurEnabled = false

function windowBackground(): string {
  if (windowBlurEnabled) return '#00000000'
  return nativeTheme.shouldUseDarkColors ? '#171717' : '#f0f0f0'
}

function updateWindowBackground(): void {
  if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground())
}
let manager: HostClient
let config: ConfigStore
let accounts: AccountService
let worktrees: WorktreeManager
let worktreeSetups: WorktreeSetupService
const sourceControl = new SourceControlService()
const commitMessages = new CommitMessageService()
const agentClis = new AgentCliManagement()
const agentSleep = new AgentSleepPrevention()
const sourceControlWatches = new SourceControlWatches()
const files = new FileExplorerService(() => config.snapshot().preferences.fileExplorer)
const fileWatches = new FileExplorerWatches(
  undefined,
  () => config.snapshot().preferences.fileExplorer,
)
let warning: string | undefined
let startupError: Error | undefined
let exiting = false
let exitPending = false
let rendererReady = false
let visibleTerminal: string | undefined
let terminalInputFocused = false
let shortcutRecording = false
let menuShortcuts: ShortcutBindings = {}
let pendingAgentFocus: { terminalId: string; launchId: string } | undefined
const notifications = new AgentNotifications({
  createNotification: createDesktopNotification,
  warn: reportWarning,
  isEnabled: () => config.snapshot().preferences.notificationsEnabled,
  turnCompleteMode: () => config.snapshot().preferences.turnCompleteNotification,
  isVisible: (id) =>
    window?.isFocused() === true && !window.isMinimized() && visibleTerminal === id,
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
const rendererURL = URL.parse(devURL || pathToFileURL(rendererFile).href)?.href.split('#')[0]

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
        if (startupError && channel !== 'app:force-exit' && channel !== 'window:is-maximized')
          throw startupError
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

function createDesktopNotification(options: Electron.NotificationConstructorOptions): Notification {
  const sound = config.snapshot().preferences.notificationSound
  const notification = new Notification({ ...options, silent: sound !== 'system' })
  if (typeof sound !== 'string') {
    notification.once('show', async () => {
      try {
        const source = await readNotificationSound(sound)
        const current = config.snapshot().preferences
        if (
          current.notificationsEnabled &&
          typeof current.notificationSound !== 'string' &&
          current.notificationSound.path === sound.path &&
          rendererReady &&
          window &&
          !window.webContents.isDestroyed()
        )
          window.webContents.send('notifications:sound', source)
      } catch (error) {
        console.error('无法读取自定义提示音，请在通知设置中重新选择文件。', error)
      }
    })
  }
  return notification
}

function reportWarning(message: string): void {
  console.warn(message)
  if (rendererReady && window && !window.webContents.isDestroyed())
    window.webContents.send('app:warning', message)
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
  const currentWindow = window
  if (
    !rendererReady ||
    !currentWindow ||
    currentWindow.webContents.isDestroyed() ||
    pendingConfirmation
  )
    return Promise.resolve(false)
  const id = randomUUID()
  return new Promise<boolean>((resolve) => {
    pendingConfirmation = { id, resolve }
    try {
      if (currentWindow.isMinimized()) currentWindow.restore()
      currentWindow.show()
      currentWindow.focus()
      currentWindow.webContents.send('app:confirm', { ...request, id })
    } catch {
      settleConfirmation(false)
    }
  })
}

async function removeTarget(target: RemovalTarget): Promise<boolean> {
  if (removingWorkspace || worktrees?.removing || exitPending || exiting || closingTabs.size)
    return false
  if (
    config
      .snapshot()
      .worktreeRecords.some(
        (record) =>
          record.projectPath === target.projectPath &&
          (!target.workspaceId ||
            config
              .snapshot()
              .layout?.workspaces.some(
                (workspace) =>
                  workspace.id === target.workspaceId && workspace.worktreeId === record.id,
              )) &&
          worktrees.initializing.has(record.id),
      )
  )
    throw new Error('请先停止项目中的工作树初始化，再删除工作区或项目。')
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
  handle('accounts:list', (product: unknown) => accounts.list(product))
  handle('accounts:add', (input: unknown) => accounts.add(input))
  handle('accounts:import-current', (product: unknown) => accounts.importCurrent(product))
  handle('accounts:import-cortana', () => accounts.importCortana())
  handle('accounts:switch', (input: unknown) => accounts.switch(input))
  handle('accounts:rename', (input: unknown) => accounts.rename(input))
  handle('accounts:remove', (id: unknown) => accounts.remove(id))
  handle('accounts:refresh', (id: unknown) => accounts.refresh(id))
  handle('accounts:reorder', (product: unknown, ids: unknown) => accounts.reorder(product, ids))
  handle('accounts:oauth-start', (product: unknown, alias: unknown) =>
    accounts.startOAuth(product, alias),
  )
  handle('accounts:oauth-cancel', () => accounts.cancelOAuth())
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
  handle('window:is-maximized', () => window?.isMaximized() ?? false)
  handle('workspace:save-layout', (value: WorkspaceLayout) => config.saveLayout(value))
  handle('project:open', async () => {
    const currentWindow = window
    if (!currentWindow || currentWindow.isDestroyed()) throw new Error('当前没有可用窗口。')
    const selected = await dialog.showOpenDialog(currentWindow, {
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
  handle('files:list', (target: WorkspaceTarget, path: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => files.list(binding.cwd, path))
  })
  handle('files:read', (target: WorkspaceTarget, path: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => files.read(binding.cwd, path))
  })
  handle('files:action', (target: WorkspaceTarget, path: unknown, action: FileAction) => {
    assertLifecycle()
    if (!['copy-relative', 'copy-absolute', 'reveal'].includes(action))
      throw new Error('文件操作无效。')
    return worktrees.withTerminalTarget(target, async (binding) => {
      const location = await files.location(binding.cwd, path)
      if (action === 'reveal') shell.showItemInFolder(location)
      else clipboard.writeText(action === 'copy-relative' ? String(path) || '.' : location)
    })
  })
  handle('files:watch', (target: WorkspaceTarget, paths: unknown, id: unknown) => {
    assertLifecycle()
    return fileWatches.start(
      id,
      paths,
      () => worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
      (event) => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('files:changed', { id, event })
      },
    )
  })
  handle('files:unwatch', (id: unknown) => fileWatches.stop(id))
  handle('git:status', (target: WorkspaceTarget) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.status(binding.cwd, true),
    )
  })
  handle('git:generate-commit-message', (input: CommitMessageRequest) => {
    assertLifecycle()
    const target = workspaceTarget(input)
    const requestId = terminalId(input.requestId)
    if (typeof input.indexVersion !== 'string' || !/^[\da-f]{64}$/.test(input.indexVersion))
      throw new Error('暂存区版本无效，请刷新后重试。')
    return commitMessages.generate(
      `${target.projectPath}\0${target.workspaceId}`,
      requestId,
      config.snapshot().preferences,
      (signal) =>
        worktrees.withTerminalTarget(target, (binding) => {
          signal.throwIfAborted()
          assertLifecycle()
          return sourceControl.commitMessageContext(binding.cwd, input.indexVersion)
        }),
      (context, signal) =>
        worktrees.withTerminalTarget(target, (binding) => {
          signal.throwIfAborted()
          assertLifecycle()
          return sourceControl.validateCommitMessageContext(binding.cwd, context)
        }),
    )
  })
  handle('git:cancel-commit-message', (input: WorkspaceTarget & { requestId: string }) => {
    const target = workspaceTarget(input)
    return commitMessages.cancel(
      `${target.projectPath}\0${target.workspaceId}`,
      terminalId(input.requestId),
    )
  })
  handle('git:watch', (target: WorkspaceTarget, id: unknown) => {
    assertLifecycle()
    return sourceControlWatches.start(
      id,
      () => worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
      (event) => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('git:changed', { id, event })
      },
    )
  })
  handle('git:unwatch', (id: unknown) => sourceControlWatches.stop(id))
  handle('git:references', (target: WorkspaceTarget) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => sourceControl.references(binding.cwd))
  })
  handle('git:history', (target: WorkspaceTarget, request?: GitHistoryRequest) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.history(binding.cwd, request),
    )
  })
  handle('git:compare', (target: WorkspaceTarget, request: GitCompareRequest) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.compare(binding.cwd, request),
    )
  })
  handle('git:diff', (target: WorkspaceTarget, file: GitDiffSelection) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => sourceControl.diff(binding.cwd, file))
  })
  handle('git:mutate', (input: GitMutation) => {
    assertLifecycle()
    if (!input || typeof input !== 'object') throw new Error('Git 操作参数无效。')
    return worktrees.withTerminalTarget(input, (binding) => {
      assertLifecycle()
      return sourceControl.mutate(binding.cwd, input, (description) =>
        requestConfirmation({
          title: '丢弃工作区改动',
          description,
          confirmLabel: '丢弃改动',
        }),
      )
    })
  })
  handle('worktree-setup:config', (path: string) => worktreeSetups.definition(path))
  handle('worktree-setup:save-config', (path: string, value: unknown) => {
    assertLifecycle()
    worktreeSetups.definition(path)
    return config.saveWorktreeSetup(path, value)
  })
  handle('worktree-setup:inspect', (target: WorkspaceTarget) => worktreeSetups.inspect(target))
  handle('worktree-setup:start', (target: WorkspaceTarget, definition: unknown) => {
    assertLifecycle()
    if (removingWorkspace) throw new Error('工作区正在关闭。')
    return worktreeSetups.start(
      target,
      definition,
      (description) =>
        requestConfirmation({
          title: '初始化工作树？',
          description,
          confirmLabel: '执行初始化',
        }),
      assertLifecycle,
    )
  })
  handle('worktree-setup:stop', (target: WorkspaceTarget) => worktreeSetups.stop(target))
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
      confirm: (check, force) => {
        let branchDescription = ''
        if (check.currentBranch)
          branchDescription = deleteBranch
            ? `同时删除本地分支 ${check.currentBranch}。`
            : '本地分支保留。'
        const forceBranchDescription =
          deleteBranch && check.currentBranch
            ? `同时强制删除本地分支 ${check.currentBranch}，未合并提交可能丢失。`
            : ''
        return requestConfirmation({
          title: force ? '强制删除工作树' : '删除工作树',
          description: force
            ? `将永久删除 ${check.worktreePath} 及关联工作区，丢弃未提交、未跟踪和忽略的文件，并结束关联终端。${forceBranchDescription}此操作可能无法恢复。`
            : `将删除 ${check.worktreePath} 及关联工作区，并结束关联终端。${branchDescription}`,
          confirmLabel: force ? '强制删除' : '删除',
        })
      },
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
  handle('workspace:openers', () => listWorkspaceOpeners(config.snapshot().preferences))
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
  handle('shell:default', () => resolveShell({ shellPath: null }))
  handle('preferences:save', async (value: unknown) => {
    const previous = config.snapshot().preferences
    const next = preferences(value)
    if (next.shellPath) await executable(next.shellPath)
    await config.savePreferences(next)
    agentSleep.setEnabled(next.preventSleep)
    nativeTheme.themeSource = next.theme
    updateWindowBackground()
    installMenu()
    if (JSON.stringify(previous.fileExplorer) !== JSON.stringify(next.fileExplorer))
      fileWatches.close()
    if (next.scrollback !== previous.scrollback)
      await manager.request('setScrollback', [next.scrollback])
    return next
  })
  handle('notifications:choose-sound', async () => {
    const currentWindow = window
    if (!currentWindow || currentWindow.isDestroyed()) throw new Error('当前没有可用窗口。')
    const selected = await dialog.showOpenDialog(currentWindow, {
      title: '选择通知提示音',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: [...NOTIFICATION_SOUND_EXTENSIONS] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const sound = { path: absolutePath(selected.filePaths[0]) }
    await readNotificationSound(sound)
    return sound
  })
  handle('notifications:open-settings', async () => {
    if (process.platform !== 'darwin') throw new Error('当前系统不支持打开 macOS 通知设置。')
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications')
  })
  handle('notifications:test', async () => {
    if (!config.snapshot().preferences.notificationsEnabled) throw new Error('请先启用通知。')
    if (!Notification.isSupported()) throw new Error('当前系统不支持通知。')
    await readNotificationSound(config.snapshot().preferences.notificationSound)
    const notification = createDesktopNotification({
      title: 'Cota · 测试通知',
      body: '这是一条测试通知，用于确认 Cota 的系统通知是否正常显示。',
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          notification.close()
          reject(
            new Error(
              '未能确认通知已显示。若系统正在询问通知权限，请完成授权后重试；否则请检查系统通知设置或勿扰模式。',
            ),
          )
        },
        process.platform === 'darwin' ? 30000 : 5000,
      )
      notification.on('show', () => {
        clearTimeout(timer)
        resolve()
      })
      notification.on('failed', (_event, error) => {
        clearTimeout(timer)
        reject(new Error(error ? `通知发送失败：${error}` : '通知发送失败，请检查系统通知设置。'))
      })
      try {
        notification.show()
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  })
  handle('clipboard:read', () => clipboard.readText())
  handle('clipboard:write', (text: unknown) => {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024)
      throw new Error('剪贴板文本无效。')
    clipboard.writeText(text)
  })
  ipcMain.on('shortcuts:recording', (event, recording: unknown) => {
    trusted(event)
    if (typeof recording !== 'boolean') return
    shortcutRecording = recording
    event.sender.setIgnoreMenuShortcuts(recording)
  })
  ipcMain.on('shortcuts:terminal-focus', (event, focused: unknown) => {
    trusted(event)
    if (typeof focused === 'boolean') terminalInputFocused = focused
  })
  handle('agent:detect', () => detectAgents(config.snapshot().preferences))
  handle('agent:cli-inspect', (checkUpdates: unknown = false, value?: unknown) => {
    if (typeof checkUpdates !== 'boolean') throw new Error('版本检查选项无效。')
    const provider = value === undefined ? undefined : agentProvider(value)
    return agentClis.inspect(config.snapshot().preferences, checkUpdates, provider)
  })
  handle('agent:cli-install', async (value: unknown) => {
    assertLifecycle()
    const provider = agentProvider(value)
    if (
      (await manager.request('list', [])).some(
        (session) => session.provider === provider && !session.exited,
      )
    )
      throw new Error('请先关闭 Cota 中正在运行的该智能体终端，再安装或更新。')
    return agentClis.install(provider, config.snapshot().preferences)
  })
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
      const actionLabel = trust ? '安装并信任' : label
      const integrationLabel = provider === 'pi' ? 'Extension' : 'Hooks'
      const trustDescription = trust
        ? '同时授权信任本次安装的 Cota Hooks，使用 Codex 原生定义哈希；不信任其他 Hooks，不修改 Hooks 功能开关，不绕过企业策略。'
        : ''
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
          title: `${actionLabel} ${AGENT_PROVIDERS[provider].name} 的 Cota 状态集成？`,
          description: uninstall
            ? `仅在本次确认后移除以下文件中的 Cota 集成：\n${hookFiles(provider, env).config}\n\n保留其他 Hooks 和配置，卸载不创建备份；共享加载脚本不删除。Dev / 正式版共用此配置，均受影响。不会结束正在运行的 Agent，已加载的集成需重启对应 CLI 后停止生效。`
            : `仅在本次确认后写入以下文件：\n${status.paths.join('\n')}\n\n保留原有 Hooks，修改已有文件前创建备份。${trustDescription}不改变 CLI 权限。安装后请新建终端。`,
          confirmLabel: `${actionLabel} ${integrationLabel}`,
        }))
      )
        return null
      if (uninstall) return uninstallAgentHook(provider, env)
      return installAgentHook(
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
    const command = startupCommand(value.startupCommand)
    if (command !== undefined && launch.kind === 'agent')
      throw new Error('快捷命令只能在新建 Shell 中执行。')
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
        {
          id: value.id,
          cols: value.cols,
          rows: value.rows,
          ...binding,
          ...launch,
          ...(command === undefined ? {} : { startupCommand: command }),
          ...(value.service === undefined ? {} : { service: value.service }),
        },
        snapshot.preferences,
      ])
    })
  })
  handle('service:stop', (id: string) => {
    assertLifecycle()
    return manager.request('stopService', [terminalId(id)])
  })
  handle('service:open', async (id: string) => {
    assertLifecycle()
    const session = (await manager.request('list', [])).find((entry) => entry.id === terminalId(id))
    if (!session?.service?.port || session.exited) throw new Error('服务未运行或未配置端口。')
    await shell.openExternal(`http://127.0.0.1:${session.service.port}`)
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
  handle('terminal:write', (id: string, data: string, encoding: 'utf8' | 'binary' = 'utf8') => {
    if (closingTabs.has(id)) throw new Error('终端正在关闭，暂不接受输入。')
    return manager.request('write', [id, data, encoding])
  })
  handle('terminal:resize', (id: string, cols: number, rows: number) =>
    manager.request('resize', [id, cols, rows]),
  )
  handle('terminal:close', async (value: unknown) => {
    const id = terminalId(value)
    if (closingTabs.has(id) || exitPending || removingWorkspace || worktrees.removing) return false
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
  handle('app:force-exit', () => requestForceExit())
  ipcMain.on('terminal:ack', (event, id: string, attachmentId: string, length: number) => {
    try {
      trusted(event)
      void manager.request('acknowledge', [id, attachmentId, length]).catch(() => {})
    } catch {
      /* Ignore malformed fire-and-forget acknowledgements. */
    }
  })
  for (const [channel, action] of [
    ['window:minimize', () => window?.minimize()],
    [
      'window:toggle-maximize',
      () => {
        if (window?.isMaximized()) window.unmaximize()
        else window?.maximize()
      },
    ],
    // Enter the existing exit guard directly; Windows IPC-triggered close events can be unreliable.
    ['app:close-window', () => void requestExit()],
  ] as const) {
    ipcMain.on(channel, (event) => {
      try {
        trusted(event)
        if (window && !window.isDestroyed()) action()
      } catch {
        /* No capabilities for other frames. */
      }
    })
  }
}

async function requestForceExit(): Promise<void> {
  if (exitPending || exiting) return
  exitPending = true
  let response: number
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '强制关闭 Cota？',
      message: '强制关闭 Cota？',
      detail:
        '将结束当前应用的所有终端、后台任务及 Terminal Host，清理完成后关闭应用。未保存的内容可能丢失。',
      buttons: ['取消', '强制关闭'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    response = result.response
  } finally {
    exitPending = false
  }
  if (response === 1) await forceExit()
}

async function forceExit(): Promise<void> {
  if (exitPending || exiting) return
  exitPending = true
  try {
    settleConfirmation(false)
    await worktreeSetups?.close()
    await config?.flush()
    sourceControlWatches.close()
    fileWatches.close()
    await commitMessages.close()
    await forceStopTerminalHost(app.getPath('userData'))
    manager?.disconnect()
    await accounts?.close()
    agentSleep.dispose()
    exiting = true
    app.exit(0)
  } finally {
    exitPending = false
  }
}

async function requestExit(): Promise<void> {
  if (exitPending || exiting || closingTabs.size || removingWorkspace || worktrees?.removing) return
  try {
    if (startupError) {
      await requestForceExit()
      return
    }
    exitPending = true
    if (worktreeSetups.running || (await manager.request('hasLive', []))) {
      const title = '退出 Cota？'
      const description = '退出将结束所有终端及运行中的程序，项目设置将会保留。'
      const confirmLabel = '结束终端并退出'
      if (rendererReady && window && !window.webContents.isDestroyed()) {
        if (!(await requestConfirmation({ title, description, confirmLabel }))) return
      } else {
        // Keep exit available when the renderer cannot display the shadcn dialog.
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          title,
          message: title,
          detail: description,
          buttons: ['取消', confirmLabel],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (response !== 1) return
      }
    }
    await worktreeSetups.close()
    await config.flush()
    await manager.request('shutdown', [])
    await commitMessages.close()
    manager.disconnect()
    sourceControlWatches.close()
    fileWatches.close()
    await accounts.close()
    agentSleep.dispose()
    exiting = true
    app.quit()
  } catch (error) {
    if (rendererReady && window && !window.webContents.isDestroyed()) {
      await requestConfirmation({
        title: '退出失败',
        description: `终端清理失败，应用暂未退出。\n${String(error)}`,
      })
    } else {
      await dialog.showMessageBox({
        type: 'error',
        title: '退出失败',
        message: '终端清理失败，应用暂未退出。',
        detail: String(error),
        buttons: ['知道了'],
        noLink: true,
      })
    }
  } finally {
    exitPending = false
  }
}

function installMenu(): void {
  menuShortcuts = config.snapshot().preferences.shortcuts
  const accelerator = (id: string) =>
    shortcutBinding(menuShortcuts, id, process.platform) || undefined
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: appName,
          submenu: [
            { role: 'about' },
            {
              label: 'Settings',
              accelerator: accelerator('settings'),
              click: () => sendShortcut('settings'),
            },
            { role: 'quit' },
            // Hidden menu items keep application and native editing shortcuts registered.
            ...COTA_SHORTCUTS.flatMap(([id, label]) => {
              if (id === 'settings') return []
              return [
                {
                  label,
                  visible: false,
                  accelerator: accelerator(id),
                  click: () => sendShortcut(id as Shortcut),
                },
              ]
            }),
            ...(
              [
                'undo',
                'redo',
                'cut',
                'copy',
                'paste',
                'selectAll',
                'hide',
                'hideOthers',
                'unhide',
                'minimize',
                'zoom',
              ] as const
            ).map((role) => ({ role, visible: false })),
          ],
        },
      ]),
    )
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: accelerator('settings'),
            click: () => sendShortcut('settings'),
          },
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
          {
            label: 'Open Folder',
            accelerator: accelerator('open-folder'),
            click: () => sendShortcut('open-folder'),
          },
          {
            label: 'New Terminal',
            accelerator: accelerator('new-terminal'),
            click: () => sendShortcut('new-terminal'),
          },
          {
            label: 'Split Terminal Right',
            accelerator: accelerator('split-terminal'),
            click: () => sendShortcut('split-terminal'),
          },
          {
            label: 'Split Terminal Down',
            accelerator: accelerator('split-terminal-down'),
            click: () => sendShortcut('split-terminal-down'),
          },
          {
            label: 'Reopen Closed Tab',
            accelerator: accelerator('reopen-tab'),
            click: () => sendShortcut('reopen-tab'),
          },
          {
            label: 'Close Terminal / Window',
            accelerator: accelerator('close-terminal'),
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
        label: 'View',
        submenu: [
          {
            label: 'Toggle Right Panel',
            accelerator: accelerator('toggle-right-panel'),
            click: () => sendShortcut('toggle-right-panel'),
          },
        ],
      },
      {
        label: 'Terminal',
        submenu: Array.from({ length: 9 }, (_, i) => ({
          label: `Select Terminal ${i + 1}`,
          accelerator: accelerator(`tab-${i + 1}`),
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
    if (!exiting && (manager || startupError || exitPending)) {
      event.preventDefault()
      void requestExit()
    }
  })
  app.on('will-quit', () => agentSleep.dispose())
  void (async () => {
    try {
      await app.whenReady()
      app.setName(appName)
      config = new ConfigStore(join(app.getPath('userData'), 'config.json'))
      accounts = new AccountService(
        join(app.getPath('userData'), 'cortana.sqlite3'),
        (progress) => {
          if (window && !window.webContents.isDestroyed())
            window.webContents.send('accounts:oauth-progress', progress)
        },
      )
      warning = (await config.load()).warning
      agentSleep.setEnabled(config.snapshot().preferences.preventSleep)
      powerMonitor.on('resume', () => agentSleep.refresh())
      nativeTheme.themeSource = config.snapshot().preferences.theme
      windowBlurEnabled =
        config.snapshot().preferences.terminalAppearance.windowBlur &&
        ['darwin', 'win32'].includes(process.platform)
      nativeTheme.on('updated', updateWindowBackground)
      worktrees = new WorktreeManager(
        config,
        join(homedir(), app.isPackaged ? '.cota' : '.cota-dev', 'worktrees'),
      )
      worktreeSetups = new WorktreeSetupService(
        config,
        worktrees,
        join(app.getPath('userData'), 'worktree-setups'),
      )
      try {
        manager = await connectTerminalHost(
          app.getPath('userData'),
          (event) => {
            if (window && !window.webContents.isDestroyed())
              window.webContents.send('terminal:event', event)
          },
          (event) => {
            agentSleep.receive(event)
            notifications.receive(event)
            if (window && !window.webContents.isDestroyed())
              window.webContents.send('agent:event', event)
          },
        )
        for (const session of await manager.request('list', [])) {
          if (!session.agent) continue
          agentSleep.receive({ type: 'state', session: session.agent })
          notifications.receive({ type: 'state', session: session.agent })
        }
      } catch (error) {
        // Keep the recovery window available without reusing or stopping an incompatible Host.
        startupError = error instanceof Error ? error : new Error(String(error))
        agentSleep.dispose()
        console.error(`${appName} Terminal Host 启动失败：`, error)
      }
      window = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 760,
        minHeight: 480,
        backgroundColor: windowBackground(),
        ...(windowBlurEnabled && process.platform === 'darwin'
          ? {
              vibrancy: 'under-window' as const,
              visualEffectState: 'active' as const,
              transparent: true,
            }
          : {}),
        ...(windowBlurEnabled && process.platform === 'win32'
          ? { backgroundMaterial: 'acrylic' as const }
          : {}),
        show: false,
        acceptFirstMouse: true,
        title: appName,
        titleBarStyle:
          process.platform === 'darwin' || process.platform === 'win32' ? 'hidden' : 'default',
        ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
        autoHideMenuBar: process.platform === 'win32',
        webPreferences: {
          additionalArguments: [
            `--cota-theme=${config.snapshot().preferences.theme}`,
            `--cota-interface-colors=${JSON.stringify(config.snapshot().preferences.interfaceColors)}`,
            ...(windowBlurEnabled ? ['--cota-window-blur'] : []),
          ],
          preload: join(__dirname, '../preload/index.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required',
        },
      })
      const contents = window.webContents
      contents.on('before-input-event', (_event, input) => {
        contents.setIgnoreMenuShortcuts(
          shortcutRecording ||
            (terminalInputFocused &&
              isTerminalMenuShortcut(
                {
                  key: input.key,
                  code: input.code,
                  ctrlKey: input.control,
                  altKey: input.alt,
                  shiftKey: input.shift,
                  metaKey: input.meta,
                },
                menuShortcuts,
                process.platform,
              )),
        )
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      window.webContents.session.setPermissionCheckHandler(() => false)
      const sendMaximized = () => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('window:maximized-changed', window.isMaximized())
      }
      window.on('maximize', sendMaximized)
      window.on('unmaximize', sendMaximized)
      window.on('close', (event) => {
        if (!exiting) {
          event.preventDefault()
          void requestExit()
        }
      })
      const rendererUnavailable = () => {
        void commitMessages.close()
        sourceControlWatches.close()
        fileWatches.close()
        rendererReady = false
        visibleTerminal = undefined
        terminalInputFocused = false
        shortcutRecording = false
        settleConfirmation(false)
        void manager?.detachAll().catch(() => {})
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
    } catch (error) {
      agentSleep.dispose()
      console.error(`${appName} 启动失败：`, error)
      let detail = String(error)
      while (!exiting) {
        await dialog.showMessageBox({
          type: 'error',
          title: `${appName} 启动失败`,
          message: '应用无法启动',
          detail: `${detail}\n\n强制关闭将结束当前应用的终端、后台任务及 Terminal Host，未保存的内容可能丢失。`,
          buttons: ['强制关闭'],
          noLink: true,
        })
        try {
          await forceExit()
        } catch (cleanupError) {
          detail = `${String(error)}\n\n后台清理失败，应用暂未关闭，请重试。\n${String(cleanupError)}`
        }
      }
    }
  })()
}
