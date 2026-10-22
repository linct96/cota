import { z } from 'zod'
import { TERMINAL_THEME_CATALOG } from './terminal-themes'

export const TERMINAL_COLOR_KEYS = [
  'foreground',
  'background',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

const themeName = z
  .string()
  .refine(
    (value) => value === 'auto' || Object.hasOwn(TERMINAL_THEME_CATALOG, value),
    '请选择有效的终端配色主题。',
  )
const color = z.string().regex(/^#[\da-f]{6}$/i, '请输入六位十六进制颜色，例如 #ffffff。')

export const terminalAppearanceSchema = z.object({
  fontFamily: z
    .string()
    .trim()
    .min(1, '请输入字体名称。')
    .max(200)
    .regex(/^[^\0\r\n;{}<>]*$/),
  fontSize: z.number().min(8).max(48),
  fontWeight: z.number().int().min(100).max(900),
  fontWeightBold: z.number().int().min(100).max(900),
  lineHeight: z.number().min(1).max(3),
  letterSpacing: z.number().min(-2).max(10),
  ligatures: z.enum(['auto', 'on', 'off']),
  themeDark: themeName,
  themeLight: themeName,
  separateLightTheme: z.boolean(),
  cursorStyle: z.enum(['bar', 'block', 'underline']),
  cursorBlink: z.boolean(),
  cursorOpacity: z.number().min(0).max(1),
  backgroundOpacity: z.number().min(0).max(1),
  windowBlur: z.boolean(),
  paddingX: z.number().int().min(0).max(128),
  paddingY: z.number().int().min(0).max(128),
  mouseHideWhileTyping: z.boolean(),
  contrastMode: z.enum(['auto', 'off', 'custom']),
  minimumContrastRatio: z.number().min(1).max(21),
  colors: z.partialRecord(z.enum(TERMINAL_COLOR_KEYS), color),
})

export type TerminalAppearance = z.infer<typeof terminalAppearanceSchema>
export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 14,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.25,
  letterSpacing: 0,
  ligatures: 'auto',
  themeDark: 'auto',
  themeLight: 'auto',
  separateLightTheme: true,
  cursorStyle: 'bar',
  cursorBlink: true,
  cursorOpacity: 1,
  backgroundOpacity: 1,
  windowBlur: false,
  paddingX: 6,
  paddingY: 6,
  mouseHideWhileTyping: false,
  contrastMode: 'auto',
  minimumContrastRatio: 4.5,
  colors: {},
}
