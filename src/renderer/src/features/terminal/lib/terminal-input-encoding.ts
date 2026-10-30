type TextKey = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'
>

const punctuation: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: ' ',
}

function primaryCode(key: TextKey): number | undefined {
  if (/^Numpad[0-9]$/.test(key.code)) return 57399 + Number(key.code.at(-1))
  const numpad = ['Decimal', 'Divide', 'Multiply', 'Subtract', 'Add', 'Enter', 'Equal']
  const index = numpad.indexOf(key.code.slice(6))
  if (key.code.startsWith('Numpad') && index >= 0) return 57409 + index
  // shortcut: Process uses US physical keys; add layout lookup for non-US Kitty identities.
  if (key.shiftKey || key.key === 'Process' || key.key === 'Unidentified') {
    if (/^Key[A-Z]$/.test(key.code)) return key.code.toLowerCase().codePointAt(3)
    if (/^Digit[0-9]$/.test(key.code)) return key.code.codePointAt(5)
    if (punctuation[key.code]) return punctuation[key.code].codePointAt(0)
  }
  if (Array.from(key.key).length !== 1) return undefined
  const code = key.key.codePointAt(0)!
  return code >= 65 && code <= 90 ? code + 32 : code
}

function report(key: TextKey, primary: number, flags: number, type: number, text?: string): string {
  let code = String(primary)
  if (
    flags & 4 &&
    key.shiftKey &&
    Array.from(key.key).length === 1 &&
    !key.code.startsWith('Numpad')
  )
    code += `:${key.key.codePointAt(0)}`
  const modifiers =
    1 +
    Number(key.shiftKey) +
    Number(key.altKey) * 2 +
    Number(key.ctrlKey) * 4 +
    Number(key.metaKey) * 8
  const eventType = flags & 2 && type !== 1 ? `:${type}` : ''
  const associated =
    flags & 16 && type !== 3 && !key.code.startsWith('Numpad') && text
      ? Array.from(text, (character) => character.codePointAt(0)).join(':')
      : ''
  const parameters = modifiers > 1 || eventType ? String(modifiers) + eventType : ''
  return `\x1b[${code}${parameters || associated ? `;${parameters}` : ''}${associated ? `;${associated}` : ''}u`
}

/** Only text keys are encoded here; xterm remains the encoder for control keys and shortcuts. */
export function encodeTerminalText(text: string, key: TextKey, flags: number) {
  const primary = primaryCode(key)
  const encodePress = flags & 8 || (key.code.startsWith('Numpad') && flags & 3)
  return {
    data:
      encodePress && primary !== undefined
        ? report(key, primary, flags, key.repeat ? 2 : 1, text)
        : text,
    release: (event: TextKey, currentFlags: number) =>
      primary !== undefined && flags & 2 && currentFlags & 2
        ? report(event, primary, flags, 3)
        : '',
  }
}
