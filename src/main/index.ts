import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ConfigStore } from './config'
import { projectBranch } from './git'
import { connectTerminalHost, type HostClient } from './host-client'
import {
  absolutePath,
  executable,
  preferences,
  projectDirectory,
  terminalId,
  workspaceRemoval,
} from './validation'
import type {
  AttachTerminal,
  ConfirmationRequest,
  CreateTerminal,
  Result,
  Shortcut,
  WorkspaceLayout,
} from '../shared/contracts'

type RemovalTarget = { projectPath: string; workspaceId?: string; removeProject: boolean }

let window: BrowserWindow | undefined
let manager: HostClient
let config: ConfigStore
let warning: string | undefined
let exiting = false
let exitPending = false
let rendererReady = false
let pendingConfirmation: { id: string; resolve(confirmed: boolean): void } | undefined
let removingWorkspace: RemovalTarget | undefined
const closingTabs = new Set<string>()
const appName = app.isPackaged ? 'Cota' : 'Cota Dev'
const rendererFile = join(__dirname, '../renderer/index.html')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererURL = new URL(devURL || pathToFileURL(rendererFile).href).href

function trusted(event: {
  sender: Electron.WebContents
  senderFrame: Electron.WebFrameMain | null
}): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== rendererURL
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
        return { ok: false, error: error instanceof Error ? error.message : '操作失败。' }
      }
    },
  )
}

function sendShortcut(shortcut: Shortcut): void {
  if (window && !window.webContents.isDestroyed()) window.webContents.send('app:shortcut', shortcut)
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
  if (removingWorkspace || exitPending || exiting || closingTabs.size) return false
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
    const snapshot = config.snapshot()
    await manager.request('setScrollback', [snapshot.preferences.scrollback])
    return { config: snapshot, sessions, warning }
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
    await projectDirectory(value)
    if (removingWorkspace) throw new Error('正在删除工作区，请稍后再切换。')
  })
  handle('project:branch', projectBranch)
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
  handle('terminal:create', (value: CreateTerminal) => {
    if (!value || typeof value !== 'object') throw new Error('终端参数无效。')
    if (
      removingWorkspace?.projectPath === value.projectPath &&
      (removingWorkspace.removeProject || removingWorkspace.workspaceId === value.workspaceId)
    )
      throw new Error('正在删除此工作区，无法新建终端。')
    const snapshot = config.snapshot()
    if (exiting || exitPending) throw new Error('应用正在退出。')
    return manager.request('create', [value, snapshot.preferences, snapshot.recentProjects])
  })
  handle('terminal:attach', (value: AttachTerminal) => {
    if (!value || !config.snapshot().recentProjects.includes(value.projectPath))
      throw new Error('请先打开项目目录。')
    return manager.request('attach', [value])
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
    if (closingTabs.size || exitPending || removingWorkspace) return false
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
            '将结束此终端的 Shell 及其中正在执行的程序，终端输出不保留。其他终端不受影响。',
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
  if (exitPending || exiting || closingTabs.size || removingWorkspace) return
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
      manager = await connectTerminalHost(app.getPath('userData'), (event) => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('terminal:event', event)
      })
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
        settleConfirmation(false)
        void manager.detachAll().catch(() => {})
      }
      window.webContents.on('did-start-loading', rendererUnavailable)
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
