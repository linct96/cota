import type { ITheme, ITerminalOptions } from '@xterm/xterm'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import type { Terminal } from '@xterm/xterm'
import type { TerminalAppearance } from '../../../shared/terminal-appearance'
import { TERMINAL_THEME_CATALOG } from '../../../shared/terminal-themes'

let colorContext: CanvasRenderingContext2D | null | undefined
export function opacityColor(value: string, opacity: number): string {
  colorContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!colorContext) return value
  colorContext.clearRect(0, 0, 1, 1)
  colorContext.fillStyle = value
  colorContext.fillRect(0, 0, 1, 1)
  const [r, g, b] = colorContext.getImageData(0, 0, 1, 1).data
  return (
    '#' +
    [r!, g!, b!, Math.round(opacity * 255)]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  )
}

export function resolveTerminalTheme(
  settings: TerminalAppearance,
  dark = document.documentElement.classList.contains('dark'),
): ITheme {
  const tokens = getComputedStyle(document.documentElement)
  const token = (name: string) => tokens.getPropertyValue(name).trim()
  const name = dark || !settings.separateLightTheme ? settings.themeDark : settings.themeLight
  const base =
    name === 'auto'
      ? {
          background: token('--surface-canvas'),
          foreground: token('--foreground'),
          cursor: token('--foreground'),
          cursorAccent: token('--surface-canvas'),
          selectionBackground: token('--terminal-selection'),
          selectionInactiveBackground: token('--terminal-selection-inactive'),
          black: token('--terminal-black'),
          red: token('--terminal-red'),
          green: token('--terminal-green'),
          yellow: token('--terminal-yellow'),
          blue: token('--terminal-blue'),
          magenta: token('--terminal-magenta'),
          cyan: token('--terminal-cyan'),
          white: token('--terminal-white'),
          brightBlack: token('--terminal-bright-black'),
          brightRed: token('--terminal-bright-red'),
          brightGreen: token('--terminal-bright-green'),
          brightYellow: token('--terminal-bright-yellow'),
          brightBlue: token('--terminal-bright-blue'),
          brightMagenta: token('--terminal-bright-magenta'),
          brightCyan: token('--terminal-bright-cyan'),
          brightWhite: token('--terminal-bright-white'),
        }
      : TERMINAL_THEME_CATALOG[name]
  const theme: ITheme = {
    ...base,
    ...settings.colors,
    overviewRulerBorder: 'transparent',
    scrollbarSliderBackground: token('--scrollbar-thumb'),
    scrollbarSliderHoverBackground: token('--scrollbar-thumb-hover'),
    scrollbarSliderActiveBackground: token('--scrollbar-thumb-active'),
  }
  theme.cursor = opacityColor(theme.cursor || theme.foreground!, settings.cursorOpacity)
  theme.background = opacityColor(theme.background!, settings.backgroundOpacity)
  return theme
}

function automaticContrastRatio(background: string | undefined, dark: boolean): number {
  // resolveTerminalTheme normalizes backgrounds to RGBA hex; blend alpha like Orca before judging lightness.
  if (!background || !/^#[\da-f]{8}$/i.test(background)) return dark ? 3 : 4.5
  const alpha = parseInt(background.slice(7, 9), 16) / 255
  const surface = dark ? 10 : 255
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(background.slice(offset, offset + 2), 16)
    const value = Math.round(channel * alpha + surface * (1 - alpha)) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? 4.5 : 3
}

export function terminalAppearanceOptions(
  settings: TerminalAppearance,
  dark = document.documentElement.classList.contains('dark'),
): ITerminalOptions {
  const theme = resolveTerminalTheme(settings, dark)
  return {
    allowTransparency: settings.backgroundOpacity < 1,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    fontWeight: settings.fontWeight,
    fontWeightBold: settings.fontWeightBold,
    lineHeight: settings.lineHeight,
    letterSpacing: settings.letterSpacing,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    minimumContrastRatio:
      settings.contrastMode === 'off'
        ? 1
        : settings.contrastMode === 'custom'
          ? settings.minimumContrastRatio
          : automaticContrastRatio(theme.background, dark),
    theme,
  }
}

export function installTerminalAppearance(terminal: Terminal, container: HTMLElement) {
  let ligatures: LigaturesAddon | undefined
  let enabled = false
  return {
    update(settings: TerminalAppearance, dark?: boolean) {
      Object.assign(terminal.options, terminalAppearanceOptions(settings, dark))
      container.style.padding = `${settings.paddingY}px ${settings.paddingX}px`
      container.style.setProperty('--surface-canvas', terminal.options.theme?.background || '')
      if (!settings.mouseHideWhileTyping) container.classList.remove('terminal-mouse-hidden')
      const next =
        settings.ligatures === 'on' ||
        (settings.ligatures === 'auto' &&
          /fira code|jetbrains mono|cascadia code|iosevka|hasklig|monaspace/i.test(
            settings.fontFamily,
          ))
      if (enabled !== next) {
        ligatures?.dispose()
        ligatures = next ? new LigaturesAddon() : undefined
        if (ligatures) terminal.loadAddon(ligatures)
        enabled = next
        return true
      }
      return false
    },
    dispose() {
      ligatures?.dispose()
    },
  }
}
