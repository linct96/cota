import { Notification, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import type { AgentSession } from '../../../shared/contracts'
import { NOTIFICATION_SOUND_EXTENSIONS } from '../../../shared/notification-sounds'
import type { ConfigStore } from '../../settings/config-store'
import type { HostClient } from '../../host/host-client'
import type { AppRenderer } from '../../app/renderer'
import type { IpcHandler } from '../../app/ipc'
import { absolutePath } from '../../validation'
import { readNotificationSound } from '../../settings/notification-sound'
import { AgentNotifications } from './agent-notifications'

export function createDesktopNotifications(deps: {
  config: ConfigStore
  renderer: AppRenderer
  getWindow: () => BrowserWindow | undefined
  getManager: () => HostClient | undefined
}) {
  const { config, renderer } = deps
  function createDesktopNotification(
    options: Electron.NotificationConstructorOptions,
  ): Notification {
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
            renderer.ready
          )
            renderer.send('notifications:sound', source)
        } catch (error) {
          console.error('无法读取自定义提示音，请在通知设置中重新选择文件。', error)
        }
      })
    }
    return notification
  }
  const notifications = new AgentNotifications({
    createNotification: createDesktopNotification,
    warn: (message) => renderer.warn(message),
    isEnabled: () => config.snapshot().preferences.notificationsEnabled,
    turnCompleteMode: () => config.snapshot().preferences.turnCompleteNotification,
    isVisible: (id) => {
      const window = deps.getWindow()
      return (
        window?.isFocused() === true && !window.isMinimized() && renderer.visibleTerminal === id
      )
    },
    describe: (session) => {
      const workspace = config
        .snapshot()
        .layout?.workspaces.find((entry) => entry.id === session.workspaceId)
      return `${basename(session.projectPath)} · ${workspace?.name || basename(session.cwd)}`
    },
    activate: async (session: AgentSession) => {
      const current = (await deps.getManager()?.request('list', []))?.find(
        (entry) => entry.id === session.terminalId && entry.agent?.launchId === session.launchId,
      )
      const window = deps.getWindow()
      if (!current || !window || window.webContents.isDestroyed()) return
      renderer.pendingAgentFocus = { terminalId: session.terminalId, launchId: session.launchId }
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      renderer.sendAgentFocus()
    },
  })

  function registerIPC(handle: IpcHandler): void {
    handle('notifications:choose-sound', async () => {
      const window = deps.getWindow()
      if (!window || window.isDestroyed()) throw new Error('当前没有可用窗口。')
      const selected = await dialog.showOpenDialog(window, {
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
  }
  return { notifications, registerIPC }
}
