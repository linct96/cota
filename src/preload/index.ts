import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentUpdate,
  AgentSession,
  ConfirmationRequest,
  DesktopAPI,
  Shortcut,
  TerminalEvent,
} from '../shared/contracts'

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveLayout: (layout) => ipcRenderer.invoke('workspace:save-layout', layout),
  openProject: () => ipcRenderer.invoke('project:open'),
  selectProject: (path) => ipcRenderer.invoke('project:select', path),
  projectBranch: (path) => ipcRenderer.invoke('project:branch', path),
  inspectRepository: (path) => ipcRenderer.invoke('git:inspect-repository', path),
  listWorktrees: (path) => ipcRenderer.invoke('git:list-worktrees', path),
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
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  acknowledge: (id, attachmentId, length) =>
    ipcRenderer.send('terminal:ack', id, attachmentId, length),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),
  closeWindow: () => ipcRenderer.send('app:close-window'),
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
