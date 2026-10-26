export const COTA_SHORTCUTS = [
  ['settings', '打开设置', 'CommandOrControl+,'],
  ['toggle-right-panel', '展开 / 收起右侧面板', 'CommandOrControl+L'],
  ['open-folder', '打开项目', 'CommandOrControl+O'],
  ['new-terminal', '新建终端', 'CommandOrControl+T'],
  ['split-terminal', '向右拆分终端', 'Super+D'],
  ['split-terminal-down', '向下拆分终端', 'Super+Shift+D'],
  ['reopen-tab', '重新打开关闭的标签', 'CommandOrControl+Shift+T'],
  ['close-terminal', '关闭终端', 'CommandOrControl+W'],
  ...Array.from({ length: 9 }, (_, index) => [
    `tab-${index + 1}`,
    `切换到终端 ${index + 1}`,
    `CommandOrControl+${index + 1}`,
  ]),
] as readonly (readonly string[])[]

export const TERMINAL_SHORTCUTS = [
  ['copy', '复制选中文本', 'CommandOrControl+Shift+C'],
  ['paste', '粘贴', 'CommandOrControl+Shift+V'],
  ['select-all', '全选终端内容', 'CommandOrControl+Shift+A'],
  ['clear', '清空终端显示', 'CommandOrControl+K'],
  ['new-line', '插入换行', 'Shift+Enter'],
  ['scroll-up', '向上滚动一页', 'Shift+PageUp'],
  ['scroll-down', '向下滚动一页', 'Shift+PageDown'],
  ['scroll-top', '滚动到顶部', 'CommandOrControl+Home'],
  ['scroll-bottom', '滚动到底部', 'CommandOrControl+End'],
] as const

export type TerminalShortcut = (typeof TERMINAL_SHORTCUTS)[number][0]
export type ShortcutBindings = Record<string, string>
export const SHORTCUT_DEFINITIONS = [...COTA_SHORTCUTS, ...TERMINAL_SHORTCUTS]
const modifiers = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Super']
const keyPattern =
  /^(?:[A-Z0-9,.;/'[\]\\`=-]|F(?:[1-9]|1\d|2[0-4])|Enter|Escape|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/

export function shortcutBinding(bindings: ShortcutBindings, id: string, platform: string): string {
  if (Object.hasOwn(bindings, id)) return bindings[id]!
  if (platform !== 'darwin' && ['split-terminal', 'split-terminal-down'].includes(id)) return ''
  if (platform === 'darwin' && ['copy', 'paste', 'select-all'].includes(id))
    return `CommandOrControl+${{ copy: 'C', paste: 'V', 'select-all': 'A' }[id]}`
  return SHORTCUT_DEFINITIONS.find(([key]) => key === id)?.[2] || ''
}

export function shortcutIdentity(value: string, platform: string): string {
  return value
    .replace('CommandOrControl', platform === 'darwin' ? 'Super' : 'Control')
    .split('+')
    .sort()
    .join('+')
}

export function shortcutConflicts(bindings: ShortcutBindings, platform: string): string[][] {
  const groups = new Map<string, string[]>()
  for (const [id] of SHORTCUT_DEFINITIONS) {
    const binding = shortcutBinding(bindings, id!, platform)
    if (!binding) continue
    const identity = shortcutIdentity(binding, platform)
    const group = groups.get(identity) || []
    group.push(id!)
    groups.set(identity, group)
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

export function validateShortcutBinding(binding: string, platform: string): void {
  const parts = binding.split('+')
  const key = parts.pop()!
  if (
    binding &&
    (!keyPattern.test(key) ||
      !parts.length ||
      parts.some((part) => !modifiers.includes(part)) ||
      new Set(parts).size !== parts.length)
  )
    throw new Error('快捷键需包含修饰键和一个有效按键。')
  const resolvedModifiers = parts.map((part) =>
    part === 'CommandOrControl' ? (platform === 'darwin' ? 'Super' : 'Control') : part,
  )
  if (new Set(resolvedModifiers).size !== resolvedModifiers.length)
    throw new Error('快捷键包含重复的修饰键。')
  const reserved =
    platform === 'darwin'
      ? ['Super+Q', 'Super+H', 'Super+M', 'Super+Alt+H', 'Super+X', 'Super+Z', 'Super+Shift+Z']
      : ['Alt+F4', 'Control+Alt+Delete', 'Control+Shift+Escape', 'Alt+Space']
  if (
    binding &&
    reserved.some(
      (value) => shortcutIdentity(value, platform) === shortcutIdentity(binding, platform),
    )
  )
    throw new Error('该组合键已被系统使用。')
}

export function validateShortcutBindings(value: unknown, platform: string): ShortcutBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('快捷键配置无效。')
  const result: ShortcutBindings = {}
  for (const [id, binding] of Object.entries(value)) {
    if (!SHORTCUT_DEFINITIONS.some(([key]) => key === id) || typeof binding !== 'string')
      throw new Error('快捷键配置无效。')
    validateShortcutBinding(binding, platform)
    result[id] = binding
  }
  const [conflict] = shortcutConflicts(result, platform)
  if (conflict) {
    const [first, second] = conflict.map(
      (id) => SHORTCUT_DEFINITIONS.find(([key]) => key === id)![1],
    )
    throw new Error(`“${second}”与“${first}”的快捷键冲突。`)
  }
  return result
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>
const keyAliases: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
}
const codeKeys: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Equal: '=',
  Minus: '-',
}

export function captureShortcut(event: ShortcutEvent, platform: string): string | undefined {
  if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process', 'Unidentified'].includes(event.key))
    return
  const parts: string[] = []
  if (platform === 'darwin' ? event.metaKey : event.ctrlKey) parts.push('CommandOrControl')
  if (platform === 'darwin' && event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (platform !== 'darwin' && event.metaKey) parts.push('Super')
  const key =
    codeKeys[event.code] ||
    (event.code.startsWith('Key')
      ? event.code.slice(3)
      : event.code.startsWith('Digit')
        ? event.code.slice(5)
        : keyAliases[event.key] || event.key)
  if (!parts.length || !keyPattern.test(key)) return
  return [...parts, key].join('+')
}

export function matchesShortcut(event: ShortcutEvent, binding: string, platform: string): boolean {
  const captured = captureShortcut(event, platform)
  return (
    !!binding &&
    !!captured &&
    shortcutIdentity(captured, platform) === shortcutIdentity(binding, platform)
  )
}

export function isTerminalMenuShortcut(
  event: ShortcutEvent,
  bindings: ShortcutBindings,
  platform: string,
): boolean {
  // Native clipboard accelerators must not act on xterm's hidden textarea, even after remapping.
  return (
    ['C', 'V', 'A'].some((key) => matchesShortcut(event, `CommandOrControl+${key}`, platform)) ||
    TERMINAL_SHORTCUTS.some(([id]) =>
      matchesShortcut(event, shortcutBinding(bindings, id, platform), platform),
    )
  )
}

export function formatShortcut(binding: string, platform: string): string {
  return (
    binding
      .replaceAll('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl')
      .replaceAll('Control', 'Ctrl')
      .replaceAll('Super', platform === 'darwin' ? '⌘' : 'Win') || '未设置'
  )
}
