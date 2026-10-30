import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { Preferences } from '../../shared/contracts'
import { isTerminalMenuShortcut, type ShortcutBindings } from '../../shared/shortcuts'
import type { IpcHandler, TrustedIPC } from './ipc'
import type { AppLifecycle } from './lifecycle'

export function createAppWindow(options: {
  appName: string
  preferences: Preferences
  lifecycle: AppLifecycle
  rendererUnavailable(): void
}) {
  const { appName, preferences, lifecycle } = options
  const windowBlurEnabled =
    preferences.terminalAppearance.windowBlur && ['darwin', 'win32'].includes(process.platform)
  const background = () =>
    windowBlurEnabled ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#171717' : '#f0f0f0'
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: background(),
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
        `--cota-home-directory=${encodeURIComponent(app.getPath('home'))}`,
        `--cota-theme=${preferences.theme}`,
        `--cota-interface-colors=${JSON.stringify(preferences.interfaceColors)}`,
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
  let terminalInputFocused = false
  let shortcutRecording = false
  let menuShortcuts: ShortcutBindings = preferences.shortcuts
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
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  contents.session.setPermissionCheckHandler(() => false)
  const sendMaximized = () => {
    if (!contents.isDestroyed()) contents.send('window:maximized-changed', window.isMaximized())
  }
  window.on('maximize', sendMaximized)
  window.on('unmaximize', sendMaximized)
  window.on('close', (event) => {
    if (!lifecycle.exiting) {
      event.preventDefault()
      void lifecycle.requestExit()
    }
  })
  const rendererUnavailable = () => {
    terminalInputFocused = false
    shortcutRecording = false
    options.rendererUnavailable()
  }
  contents.on('did-start-navigation', (details) => {
    // Hash routes keep the same renderer and its confirmation listener alive.
    if (details.isMainFrame && !details.isSameDocument) rendererUnavailable()
  })
  contents.on('render-process-gone', rendererUnavailable)
  contents.on('destroyed', rendererUnavailable)
  window.once('ready-to-show', () => window.show())
  const updateBackground = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(background())
  }
  nativeTheme.on('updated', updateBackground)

  return {
    window,
    updateBackground,
    setShortcuts(bindings: ShortcutBindings) {
      menuShortcuts = bindings
    },
    registerIPC(handle: IpcHandler, trusted: TrustedIPC) {
      handle('window:is-maximized', () => window.isMaximized())
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
      for (const [channel, action] of [
        ['window:minimize', () => window.minimize()],
        [
          'window:toggle-maximize',
          () => {
            if (window.isMaximized()) window.unmaximize()
            else window.maximize()
          },
        ],
        // Enter the existing exit guard directly; Windows IPC-triggered close events can be unreliable.
        ['app:close-window', () => void lifecycle.requestExit()],
      ] as const) {
        ipcMain.on(channel, (event) => {
          try {
            trusted(event)
            if (!window.isDestroyed()) action()
          } catch {
            /* No capabilities for other frames. */
          }
        })
      }
    },
  }
}
