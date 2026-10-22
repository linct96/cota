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

const api: DesktopAPI = {
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
        if (!disposed)
          listener(
            result.ok && result.value
              ? { kind: 'ready' }
              : {
                  kind: 'unavailable',
                  error: result.ok ? '文件监听不可用，请手动刷新。' : result.error,
                },
          )
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
  workspacePath: (target) => ipcRenderer.invoke('workspace:path', target),
  openWorkspaceWith: (path, openerId) => ipcRenderer.invoke('workspace:open-with', path, openerId),
  removeWorkspace: (target) => ipcRenderer.invoke('workspace:remove', target),
  removeProject: (path) => ipcRenderer.invoke('project:remove', path),
  getDefaultShell: () => ipcRenderer.invoke('shell:default'),
  savePreferences: (preferences) => ipcRenderer.invoke('preferences:save', preferences),
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
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized-changed', wrapped)
    return () => ipcRenderer.removeListener('window:maximized-changed', wrapped)
  },
  closeWindow: () => ipcRenderer.send('app:close-window'),
  restartApp: () => ipcRenderer.send('app:restart'),
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
