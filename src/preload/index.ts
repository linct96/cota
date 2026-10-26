import { contextBridge, ipcRenderer } from 'electron'
import type { FileWatchEvent } from '../shared/file-explorer'
import type {
  AgentUpdate,
  AgentSession,
  ConfirmationRequest,
  DesktopAPI,
  GitWatchEvent,
  Result,
  Shortcut,
  TerminalEvent,
} from '../shared/contracts'

function initialTheme(): DesktopAPI['initialAppearance']['theme'] {
  if (process.argv.includes('--cota-theme=dark')) return 'dark'
  if (process.argv.includes('--cota-theme=light')) return 'light'
  return 'system'
}

function initialInterfaceColors(): DesktopAPI['initialAppearance']['interfaceColors'] {
  const argument = process.argv.find((value) => value.startsWith('--cota-interface-colors='))
  if (!argument) return undefined
  try {
    return JSON.parse(argument.slice('--cota-interface-colors='.length))
  } catch {
    return undefined
  }
}

const api: DesktopAPI = {
  initialAppearance: {
    theme: initialTheme(),
    windowBlur: process.argv.includes('--cota-window-blur'),
    interfaceColors: initialInterfaceColors(),
  },
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  setShortcutRecording: (recording) => ipcRenderer.send('shortcuts:recording', recording),
  setTerminalInputFocused: (focused) => ipcRenderer.send('shortcuts:terminal-focus', focused),
  inspectAgentClis: (checkUpdates = false, provider) =>
    ipcRenderer.invoke('agent:cli-inspect', checkUpdates, provider),
  installAgentCli: (provider) => ipcRenderer.invoke('agent:cli-install', provider),
  accounts: {
    list: (product) => ipcRenderer.invoke('accounts:list', product),
    add: (input) => ipcRenderer.invoke('accounts:add', input),
    importCurrent: (product) => ipcRenderer.invoke('accounts:import-current', product),
    importCortana: () => ipcRenderer.invoke('accounts:import-cortana'),
    switch: (input) => ipcRenderer.invoke('accounts:switch', input),
    rename: (input) => ipcRenderer.invoke('accounts:rename', input),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    refresh: (id) => ipcRenderer.invoke('accounts:refresh', id),
    reorder: (product, ids) => ipcRenderer.invoke('accounts:reorder', product, ids),
    startOAuth: (product, alias) => ipcRenderer.invoke('accounts:oauth-start', product, alias),
    cancelOAuth: () => ipcRenderer.invoke('accounts:oauth-cancel'),
    onOAuth: (listener) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        progress: import('../shared/accounts').AccountOAuthProgress,
      ) => listener(progress)
      ipcRenderer.on('accounts:oauth-progress', wrapped)
      return () => ipcRenderer.removeListener('accounts:oauth-progress', wrapped)
    },
  },
  platform: process.platform,
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveLayout: (layout) => ipcRenderer.invoke('workspace:save-layout', layout),
  openProject: () => ipcRenderer.invoke('project:open'),
  selectProject: (path) => ipcRenderer.invoke('project:select', path),
  projectBranch: (path) => ipcRenderer.invoke('project:branch', path),
  inspectRepository: (path) => ipcRenderer.invoke('git:inspect-repository', path),
  listWorktrees: (path) => ipcRenderer.invoke('git:list-worktrees', path),
  listFiles: (target, path) => ipcRenderer.invoke('files:list', target, path),
  readFile: (target, path) => ipcRenderer.invoke('files:read', target, path),
  fileAction: (target, path, action) => ipcRenderer.invoke('files:action', target, path, action),
  watchFiles: (target, paths, listener) => {
    const id = crypto.randomUUID()
    let disposed = false
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      update: { id: string; event: FileWatchEvent },
    ) => {
      if (!disposed && update.id === id) listener(update.event)
    }
    ipcRenderer.on('files:changed', wrapped)
    void ipcRenderer
      .invoke('files:watch', target, paths, id)
      .then((result: Result<boolean>) => {
        if (disposed) return
        if (result.ok && result.value) listener({ kind: 'ready' })
        else
          listener({
            kind: 'unavailable',
            error: result.ok ? '文件监听不可用，请手动刷新。' : result.error,
          })
      })
      .catch(() => {
        if (!disposed) listener({ kind: 'unavailable', error: '文件监听不可用，请手动刷新。' })
      })
    return () => {
      disposed = true
      ipcRenderer.removeListener('files:changed', wrapped)
      void ipcRenderer.invoke('files:unwatch', id).catch(() => {})
    }
  },
  gitStatus: (target) => ipcRenderer.invoke('git:status', target),
  watchGit: (target, listener) => {
    const id = crypto.randomUUID()
    let disposed = false
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      update: { id: string; event: GitWatchEvent },
    ) => {
      if (!disposed && update.id === id) listener(update.event)
    }
    ipcRenderer.on('git:changed', wrapped)
    void ipcRenderer
      .invoke('git:watch', target, id)
      .then((result: Result<boolean>) => {
        if (!disposed) listener(result.ok && result.value ? 'ready' : 'unavailable')
      })
      .catch(() => {
        if (!disposed) listener('unavailable')
      })
    return () => {
      disposed = true
      ipcRenderer.removeListener('git:changed', wrapped)
      void ipcRenderer.invoke('git:unwatch', id).catch(() => {})
    }
  },
  gitDiff: (target, file) => ipcRenderer.invoke('git:diff', target, file),
  gitMutate: (input) => ipcRenderer.invoke('git:mutate', input),
  generateCommitMessage: (input) => ipcRenderer.invoke('git:generate-commit-message', input),
  cancelCommitMessage: (input) => ipcRenderer.invoke('git:cancel-commit-message', input),
  gitReferences: (target) => ipcRenderer.invoke('git:references', target),
  gitHistory: (target, request) => ipcRenderer.invoke('git:history', target, request),
  gitCompare: (target, request) => ipcRenderer.invoke('git:compare', target, request),
  createGitWorktree: (input) => ipcRenderer.invoke('git:create-worktree', input),
  planGitWorktree: (input) => ipcRenderer.invoke('git:plan-worktree', input),
  worktreeBranches: (path) => ipcRenderer.invoke('git:branches', path),
  suggestWorktreeName: (path) => ipcRenderer.invoke('git:suggest-worktree-name', path),
  scanWorktrees: (path) => ipcRenderer.invoke('git:scan-worktrees', path),
  linkGitWorktree: (path, target) => ipcRenderer.invoke('git:link-worktree', path, target),
  inspectWorktreeRemoval: (id) => ipcRenderer.invoke('git:inspect-removal', id),
  removeGitWorktree: (id, deleteBranch) =>
    ipcRenderer.invoke('git:remove-worktree', id, deleteBranch),
  unlinkGitWorktree: (id) => ipcRenderer.invoke('git:unlink-worktree', id),
  worktreeSetupConfig: (path) => ipcRenderer.invoke('worktree-setup:config', path),
  saveWorktreeSetupConfig: (path, value) =>
    ipcRenderer.invoke('worktree-setup:save-config', path, value),
  inspectWorktreeSetup: (target) => ipcRenderer.invoke('worktree-setup:inspect', target),
  startWorktreeSetup: (target, definition) =>
    ipcRenderer.invoke('worktree-setup:start', target, definition),
  stopWorktreeSetup: (target) => ipcRenderer.invoke('worktree-setup:stop', target),
  workspacePath: (target) => ipcRenderer.invoke('workspace:path', target),
  listWorkspaceOpeners: () => ipcRenderer.invoke('workspace:openers'),
  openWorkspaceWith: (path, openerId) => ipcRenderer.invoke('workspace:open-with', path, openerId),
  removeWorkspace: (target) => ipcRenderer.invoke('workspace:remove', target),
  removeProject: (path) => ipcRenderer.invoke('project:remove', path),
  getDefaultShell: () => ipcRenderer.invoke('shell:default'),
  savePreferences: (preferences) => ipcRenderer.invoke('preferences:save', preferences),
  sendTestNotification: () => ipcRenderer.invoke('notifications:test'),
  openNotificationSettings: () => ipcRenderer.invoke('notifications:open-settings'),
  chooseNotificationSound: () => ipcRenderer.invoke('notifications:choose-sound'),
  onNotificationSound: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, source: string) => listener(source)
    ipcRenderer.on('notifications:sound', wrapped)
    return () => ipcRenderer.removeListener('notifications:sound', wrapped)
  },
  detectAgents: () => ipcRenderer.invoke('agent:detect'),
  detectAgentHooks: () => ipcRenderer.invoke('agent:hooks-detect'),
  installAgentHook: (provider) => ipcRenderer.invoke('agent:hooks-install', provider),
  uninstallAgentHook: (provider) => ipcRenderer.invoke('agent:hooks-uninstall', provider),
  readAgent: (id, launchId, revision) => ipcRenderer.invoke('agent:read', id, launchId, revision),
  setVisibleTerminal: (id) => ipcRenderer.invoke('agent:visible', id),
  onAgentFocus: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      target: Pick<AgentSession, 'terminalId' | 'launchId'>,
    ) => listener(target)
    ipcRenderer.on('agent:focus', wrapped)
    return () => ipcRenderer.removeListener('agent:focus', wrapped)
  },
  onAgent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: AgentUpdate) => listener(event)
    ipcRenderer.on('agent:event', wrapped)
    return () => ipcRenderer.removeListener('agent:event', wrapped)
  },
  createTerminal: (options) => ipcRenderer.invoke('terminal:create', options),
  attachTerminal: (options) => ipcRenderer.invoke('terminal:attach', options),
  detachTerminal: (id, attachmentId) => ipcRenderer.invoke('terminal:detach', id, attachmentId),
  writeTerminal: (id, data, encoding = 'utf8') =>
    ipcRenderer.invoke('terminal:write', id, data, encoding),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  acknowledge: (id, attachmentId, length) =>
    ipcRenderer.send('terminal:ack', id, attachmentId, length),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),
  stopService: (id) => ipcRenderer.invoke('service:stop', id),
  openService: (id) => ipcRenderer.invoke('service:open', id),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized-changed', wrapped)
    return () => ipcRenderer.removeListener('window:maximized-changed', wrapped)
  },
  closeWindow: () => ipcRenderer.send('app:close-window'),
  forceExitApp: () => ipcRenderer.invoke('app:force-exit'),
  respondToConfirmation: (id, confirmed) =>
    ipcRenderer.invoke('app:confirm-response', id, confirmed),
  onConfirmation: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, request: ConfirmationRequest) =>
      listener(request)
    ipcRenderer.on('app:confirm', wrapped)
    return () => ipcRenderer.removeListener('app:confirm', wrapped)
  },
  onTerminal: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: TerminalEvent) => listener(event)
    ipcRenderer.on('terminal:event', wrapped)
    return () => {
      ipcRenderer.removeListener('terminal:event', wrapped)
    }
  },
  onShortcut: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, shortcut: Shortcut) => listener(shortcut)
    ipcRenderer.on('app:shortcut', wrapped)
    return () => {
      ipcRenderer.removeListener('app:shortcut', wrapped)
    }
  },
}
contextBridge.exposeInMainWorld('desktop', api)
