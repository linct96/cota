import { extname } from 'node:path'
import type { Preferences } from '../../shared/contracts'
import { NOTIFICATION_SOUND_EXTENSIONS } from '../../shared/notification-sounds'
import type { NotificationSound } from '../../shared/notification-sounds'
import {
  DEFAULT_TERMINAL_APPEARANCE,
  terminalAppearanceSchema,
} from '../../shared/terminal-appearance'
import { validateShortcutBindings } from '../../shared/shortcuts'
import { DEFAULT_INTERFACE_COLORS, interfaceColorsSchema } from '../../shared/interface-colors'
import { absolutePath } from './paths'
import { savedQuickCommands, workspaceOpeners } from './commands'

function notificationSoundPreference(value: unknown): NotificationSound {
  if (value === 'system' || value === 'none') return value
  // Removed bundled sounds fall back without invalidating the rest of an existing config.
  if (
    typeof value === 'string' &&
    ['two-tone', 'bong', 'thump', 'blip', 'sonar', 'blop', 'ding', 'clack', 'beep'].includes(value)
  )
    return 'system'
  if (value && typeof value === 'object' && 'path' in value) {
    const path = absolutePath(value.path)
    if (
      NOTIFICATION_SOUND_EXTENSIONS.some(
        (extension) => `.${extension}` === extname(path).toLowerCase(),
      )
    )
      return { path }
  }
  throw new Error('通知提示音选项无效。')
}

export function preferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('设置格式无效。')
  const {
    theme = 'system',
    notificationsEnabled = true,
    notificationSound = 'system',
    turnCompleteNotification = 'unfocused',
    interfaceColors = DEFAULT_INTERFACE_COLORS,
    terminalAppearance = DEFAULT_TERMINAL_APPEARANCE,
    fileExplorer = { showIgnored: true, followSymlinks: true },
    fileIconTheme = 'default',
    shortcuts = {},
    shellName,
    shellPath,
    scrollback,
    openWith,
    quickCommands = [],
    preferredOpenerId,
    terminalGpuAcceleration = 'auto',
    preventSleep = true,
    reusePreviewTabs = true,
    confirmCloseRunningTerminal = true,
    commitMessagePrompt = '',
  } = value as Record<keyof Preferences, unknown>
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') throw new Error('主题选项无效。')
  if (fileIconTheme !== 'default' && fileIconTheme !== 'material')
    throw new Error('文件图标主题选项无效。')
  if (typeof preventSleep !== 'boolean') throw new Error('防休眠选项无效。')
  if (typeof reusePreviewTabs !== 'boolean') throw new Error('预览标签复用选项无效。')
  if (typeof confirmCloseRunningTerminal !== 'boolean') throw new Error('终端关闭确认选项无效。')
  if (typeof notificationsEnabled !== 'boolean') throw new Error('通知开关选项无效。')
  const sound = notificationSoundPreference(notificationSound)
  if (
    turnCompleteNotification !== 'never' &&
    turnCompleteNotification !== 'unfocused' &&
    turnCompleteNotification !== 'always'
  )
    throw new Error('轮次完成通知选项无效。')
  if (
    !fileExplorer ||
    typeof fileExplorer !== 'object' ||
    !('showIgnored' in fileExplorer) ||
    !('followSymlinks' in fileExplorer) ||
    typeof fileExplorer.showIgnored !== 'boolean' ||
    typeof fileExplorer.followSymlinks !== 'boolean'
  )
    throw new Error('文件浏览器选项无效。')
  if (
    typeof commitMessagePrompt !== 'string' ||
    commitMessagePrompt.length > 4000 ||
    commitMessagePrompt.includes('\0')
  )
    throw new Error('提交信息提示词最多 4,000 字符，不能包含空字符。')
  if (
    terminalGpuAcceleration !== 'auto' &&
    terminalGpuAcceleration !== 'on' &&
    terminalGpuAcceleration !== 'off'
  ) {
    throw new Error('GPU 加速选项无效。')
  }
  if (
    shellName != null &&
    (typeof shellName !== 'string' || shellName.length > 80 || /[\0\r\n]/.test(shellName))
  ) {
    throw new Error('Shell 名称不能包含换行且最多 80 字符。')
  }
  const validatedShellPath = shellPath === null ? null : absolutePath(shellPath)
  if (
    typeof scrollback !== 'number' ||
    !Number.isInteger(scrollback) ||
    scrollback < 1000 ||
    scrollback > 20000
  ) {
    throw new Error('Scrollback 必须是 1,000–20,000 之间的整数。')
  }
  if (
    preferredOpenerId !== undefined &&
    (typeof preferredOpenerId !== 'string' || !/^[\w-]{1,64}$/.test(preferredOpenerId))
  )
    throw new Error('默认打开方式标识无效。')
  return {
    theme,
    notificationsEnabled,
    notificationSound: sound,
    turnCompleteNotification,
    interfaceColors: interfaceColorsSchema.parse(interfaceColors),
    terminalAppearance: terminalAppearanceSchema.parse(terminalAppearance),
    fileExplorer: {
      showIgnored: fileExplorer.showIgnored,
      followSymlinks: fileExplorer.followSymlinks,
    },
    fileIconTheme,
    shortcuts: validateShortcutBindings(shortcuts, process.platform),
    ...(preferredOpenerId === undefined ? {} : { preferredOpenerId }),
    terminalGpuAcceleration,
    preventSleep,
    reusePreviewTabs,
    confirmCloseRunningTerminal,
    commitMessagePrompt: commitMessagePrompt.trim(),
    shellName: shellPath === null ? null : shellName?.trim() || null,
    shellPath: validatedShellPath,
    scrollback,
    openWith: workspaceOpeners(openWith),
    quickCommands: savedQuickCommands(quickCommands),
  }
}
