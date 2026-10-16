import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, Shortcut, TerminalEvent } from '../shared/contracts'

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  openProject: () => ipcRenderer.invoke('project:open'),
  selectProject: (path) => ipcRenderer.invoke('project:select', path),
  removeProject: (path) => ipcRenderer.invoke('project:remove', path),
  savePreferences: (preferences) => ipcRenderer.invoke('preferences:save', preferences),
  createTerminal: (options) => ipcRenderer.invoke('terminal:create', options),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  acknowledge: (id, length) => ipcRenderer.send('terminal:ack', id, length),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),
  closeWindow: () => ipcRenderer.send('app:close-window'),
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
