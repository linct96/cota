import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type IpcMainInvokeEvent,
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ConfigStore } from './config'
import { TerminalManager } from './terminals'
import { absolutePath, executable, preferences, projectDirectory, terminalId } from './validation'
import type { CreateTerminal, Result, Shortcut } from '../shared/contracts'

let window: BrowserWindow | undefined
let manager: TerminalManager
let config: ConfigStore
let warning: string | undefined
let exiting = false
let exitPending = false
let removingProject: string | undefined
const closingTabs = new Set<string>()
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

function installIPC(): void {
  handle('app:bootstrap', () => ({ config: config.snapshot(), warning }))
  handle('project:open', async () => {
    const selected = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const path = await projectDirectory(selected.filePaths[0])
    if (removingProject) throw new Error('正在删除项目，请稍后再打开目录。')
    await config.remember(path)
    return path
  })
  handle('project:select', async (value: unknown) => {
    await projectDirectory(value)
    if (removingProject) throw new Error('正在删除项目，请稍后再切换。')
  })
  handle('project:remove', async (value: unknown) => {
    const path = absolutePath(value)
    if (removingProject || exitPending || exiting || closingTabs.size) return false
    removingProject = path
    try {
      const { response } = await dialog.showMessageBox(window!, {
        type: 'warning',
        title: '删除项目？',
        message: '从 Cota 删除此项目？',
        detail: `${path}\n\n将结束该项目的所有终端及其中正在执行的程序，终端输出不会保留。只移除 Cota 中的记录，不会删除本地文件；之后可重新添加。`,
        buttons: ['取消', '删除项目并结束终端'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (response !== 1) return false
      await manager.closeProject(path)
      await config.forget(path)
      return true
    } catch (error) {
      throw new Error(`删除未完成，项目记录仍保留；部分终端可能已结束，请重试。${String(error)}`)
    } finally {
      removingProject = undefined
    }
  })
  handle('preferences:save', async (value: unknown) => {
    const next = preferences(value)
    if (next.shellPath) await executable(next.shellPath)
    await config.savePreferences(next)
    return next
  })
  handle('terminal:create', (value: CreateTerminal) => {
    if (!value || typeof value !== 'object') throw new Error('终端参数无效。')
    if (removingProject && removingProject === value.projectPath)
      throw new Error('正在删除此项目，无法新建终端。')
    const snapshot = config.snapshot()
    return manager.create(value, snapshot.preferences, snapshot.recentProjects)
  })
  handle('terminal:write', (id: string, data: string) => manager.write(id, data))
  handle('terminal:resize', (id: string, cols: number, rows: number) =>
    manager.resize(id, cols, rows),
  )
  handle('terminal:close', async (value: unknown) => {
    const id = terminalId(value)
    if (closingTabs.has(id) || exitPending || removingProject) return false
    closingTabs.add(id)
    try {
      await manager.close(id)
      return true
    } finally {
      closingTabs.delete(id)
    }
  })
  ipcMain.on('terminal:ack', (event, id: string, length: number) => {
    try {
      trusted(event)
      manager.acknowledge(id, length)
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
  if (exitPending || exiting || closingTabs.size || removingProject) return
  exitPending = true
  try {
    if (manager.hasLive()) {
      const { response } = await dialog.showMessageBox(window!, {
        type: 'warning',
        title: '退出 Cota？',
        message: '退出将结束所有终端 Shell 及其中正在执行的程序。',
        detail: '最近项目和设置会保留，终端会话与输出不会在重启后恢复。',
        buttons: ['取消', '结束终端并退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (response !== 1) return
    }
    await manager.shutdown()
    exiting = true
    app.quit()
  } catch (error) {
    await dialog.showMessageBox(window!, {
      type: 'error',
      message: '终端清理失败，应用暂未退出。',
      detail: String(error),
    })
  } finally {
    exitPending = false
  }
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Cota',
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
      app.setName('Cota')
      nativeTheme.themeSource = 'light'
      config = new ConfigStore(join(app.getPath('userData'), 'config.json'))
      warning = (await config.load()).warning
      manager = new TerminalManager((event) => {
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
        title: 'Cota',
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 16, y: 16 },
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
      window.webContents.on('render-process-gone', () => {
        void requestExit()
      })
      window.once('ready-to-show', () => window?.show())
      installIPC()
      installMenu()
      if (devURL) await window.loadURL(devURL)
      else await window.loadFile(rendererFile)
    })
    .catch((error) => {
      dialog.showErrorBox('Cota 启动失败', String(error))
      app.exit(1)
    })
}
