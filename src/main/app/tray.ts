import { Menu, Tray } from 'electron'
import { join } from 'node:path'

export function createAppTray(options: {
  appName: string
  showWindow: () => void
  openSettings: () => void
  stopAllAndQuit: () => void
}): { dispose: () => void } {
  const iconFile =
    process.platform === 'darwin'
      ? 'trayTemplate.png'
      : process.platform === 'win32'
        ? 'tray.ico'
        : 'tray.png'
  const iconPath = join(__dirname, '../../resources', iconFile)
  let tray: Tray | undefined
  try {
    tray = new Tray(iconPath)
  } catch {
    return { dispose: () => {} }
  }
  tray.setToolTip(options.appName)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `显示 ${options.appName}`,
        click: options.showWindow,
      },
      {
        label: '设置',
        click: () => {
          options.showWindow()
          options.openSettings()
        },
      },
      { type: 'separator' },
      { role: 'quit', label: '退出 Cota（保留终端会话）' },
      { label: '结束全部任务并退出', click: options.stopAllAndQuit },
    ]),
  )
  if (process.platform !== 'darwin') {
    tray.on('click', options.showWindow)
  }
  return {
    dispose() {
      tray?.destroy()
      tray = undefined
    },
  }
}
