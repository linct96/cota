import { Terminal } from '@xterm/headless'
import { expect, it, vi } from 'vitest'
import { installTerminalPreviewInput } from '../src/renderer/src/lib/terminal-preview-input'

it('edits preview text locally across Unicode, wrapping and resizing without parsing pasted controls', async () => {
  vi.useFakeTimers()
  const terminal = new Terminal({ cols: 40, rows: 6, scrollback: 1000, allowProposedApi: true })
  terminal.write('sample output\r\n')
  const input = installTerminalPreviewInput(terminal, '\x1b[34m~/cota\x1b[0m main ❯ ')
  const drain = () => vi.runAllTimersAsync()
  const send = async (...values: string[]) => {
    for (const value of values) terminal.input(value, true)
    await drain()
  }
  const text = () => {
    const buffer = terminal.buffer.active
    return Array.from({ length: buffer.length }, (_, row) =>
      buffer.getLine(row)!.translateToString(true),
    ).join('\n')
  }
  const cursorText = () => {
    const buffer = terminal.buffer.active
    return buffer
      .getLine(buffer.baseY + buffer.cursorY)!
      .getCell(buffer.cursorX)
      ?.getChars()
  }
  try {
    await drain()
    expect(text()).toContain('sample output\n~/cota main ❯ echo "光标预览 Cursor"')
    await send('\x1b[H')
    expect(cursorText()).toBe('e')
    await send('\x1b[C', '中')
    expect(text()).toContain('e中cho "光标预览 Cursor"')
    expect(cursorText()).toBe('c')

    await send('\r', 'A中e\u0301🙂Z', '\x1b[D', '\x7f')
    expect(text()).toContain('A中e\u0301Z')
    expect(cursorText()).toBe('Z')
    await send('\x1b[D', '\x1b[3~')
    expect(text()).toContain('A中Z')
    await send('\x1b[D', '\x7f', '\x1b[H')
    expect(cursorText()).toBe('中')
    await send('\x1b[C')
    expect(cursorText()).toBe('Z')

    await send('\r', 'abcdefghijk中文Z')
    terminal.resize(10, 6)
    await send('\x1b[H')
    expect(cursorText()).toBe('a')
    await send('\x1b[C', '🙂')
    expect(text().replace(/\n/g, '')).toContain('a🙂bcdefghijk中文Z')
    await send('\x1b[F', '\x7f')
    expect(text().replace(/\n/g, '')).toContain('a🙂bcdefghijk中文')
    terminal.resize(40, 6)

    await send('\r', '\x1b[2J\x1b]52;c;payload\x07echo one\r\nsecond\tline')
    expect(text()).toContain('sample output')
    expect(text()).toContain('echo one second line')
    expect(text()).not.toContain('payload')
    const before = text()
    await send('x'.repeat(300), '\x1b[A', '\x03')
    expect(text()).toBe(before)

    input.dispose()
    await send('ignored')
    expect(text()).toBe(before)
  } finally {
    input.dispose()
    terminal.dispose()
    vi.useRealTimers()
  }
})
