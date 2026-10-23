import type { ThemePreference } from '../../../shared/contracts'
import {
  DEFAULT_INTERFACE_COLORS,
  interfaceColorsSchema,
  type InterfaceColorRole,
  type InterfaceColors,
} from '../../../shared/interface-colors'

let colorContext: CanvasRenderingContext2D | null | undefined

export function resolveDocumentColor(role: InterfaceColorRole): string {
  colorContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!colorContext) return ''
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${role}`).trim()
  colorContext.clearRect(0, 0, 1, 1)
  colorContext.fillStyle = value
  colorContext.fillRect(0, 0, 1, 1)
  const channels = colorContext.getImageData(0, 0, 1, 1).data
  return (
    '#' +
    Array.from(channels.slice(0, 3), (channel) => channel.toString(16).padStart(2, '0')).join('')
  )
}

function primaryForeground(color: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

export function applyDocumentTheme(
  theme: ThemePreference,
  colors: InterfaceColors = DEFAULT_INTERFACE_COLORS,
): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.toggle('light', !dark)
  const parsed = interfaceColorsSchema.safeParse(colors)
  const overrides = (parsed.success ? parsed.data : DEFAULT_INTERFACE_COLORS)[
    dark ? 'dark' : 'light'
  ]
  const style = document.documentElement.style
  for (const role of ['primary', 'background', 'foreground'] as const) {
    if (overrides[role]) style.setProperty(`--${role}`, overrides[role])
    else style.removeProperty(`--${role}`)
  }
  if (overrides.primary)
    style.setProperty('--primary-foreground', primaryForeground(overrides.primary))
  else style.removeProperty('--primary-foreground')
}

export function observeDocumentTheme(listener: () => void): () => void {
  let previous = document.documentElement.classList.contains('dark')
  const observer = new MutationObserver(() => {
    const dark = document.documentElement.classList.contains('dark')
    if (dark === previous) return
    previous = dark
    listener()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
