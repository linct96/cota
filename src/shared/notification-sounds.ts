export const NOTIFICATION_SOUND_OPTIONS = [
  { value: 'system', label: '系统默认' },
  { value: 'none', label: '静音' },
  { value: 'custom', label: '自定义文件' },
] as const

export const NOTIFICATION_SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a'] as const

export type NotificationSound = 'system' | 'none' | { path: string }
