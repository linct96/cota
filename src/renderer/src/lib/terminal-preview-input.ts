import type { Terminal } from '@xterm/xterm'

export function installTerminalPreviewInput(
  terminal: Pick<Terminal, 'buffer' | 'cols' | 'rows' | 'write' | 'onData'>,
  prompt: string,
) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const split = (text: string) => Array.from(segmenter.segment(text), ({ segment }) => segment)
  let characters = split('echo "光标预览 Cursor"')
  let cursor = characters.length
  let disposed = false
  const write = (text: string) => new Promise<void>((resolve) => terminal.write(text, resolve))
  const lineStart = () => {
    const buffer = terminal.buffer.active
    let row = buffer.baseY + buffer.cursorY
    while (row > buffer.baseY && buffer.getLine(row)?.isWrapped) row--
    return row
  }
  const render = async () => {
    const buffer = terminal.buffer.active
    const row = lineStart() - buffer.baseY
    const up = buffer.cursorY - row
    // Keep the editable window inside the viewport, even after changing font size or padding.
    const visiblePrompt = terminal.cols >= 16 ? prompt : terminal.cols >= 4 ? '> ' : ''
    const promptLength = visiblePrompt.replace(/\x1b\[[\d;]*m/g, '').length
    let budget = Math.max(0, terminal.cols * Math.max(1, terminal.rows - 1) - promptLength - 1)
    let start = cursor
    let end = cursor
    while (start > 0 && characters[start - 1]!.length * 2 <= budget) {
      budget -= characters[--start]!.length * 2
    }
    while (end < characters.length && characters[end]!.length * 2 <= budget) {
      budget -= characters[end++]!.length * 2
    }
    const prefix = characters.slice(start, cursor).join('')
    await write(
      `\r${up ? `\x1b[${up}A` : ''}\x1b[J${visiblePrompt}${characters.slice(start, end).join('')}`,
    )
    if (disposed || cursor === end) return
    let remaining = promptLength + prefix.length
    const active = terminal.buffer.active
    for (let y = lineStart(); y <= active.baseY + active.cursorY; y++) {
      const line = active.getLine(y)!
      for (let x = 0; x < terminal.cols; x++) {
        const cell = line.getCell(x)!
        if (!cell.getChars()) continue
        if (remaining === 0) {
          await write(`\x1b[${y - active.baseY + 1};${x + 1}H`)
          return
        }
        remaining -= cell.getChars().length
      }
    }
  }
  let queue = write('').then(() => {
    if (!disposed) return render()
  })
  const input = terminal.onData((data) => {
    queue = queue.then(async () => {
      if (disposed) return
      switch (data) {
        case '\x1b[D':
          cursor = Math.max(0, cursor - 1)
          break
        case '\x1b[C':
          cursor = Math.min(characters.length, cursor + 1)
          break
        case '\x1b[H':
        case '\x1b[1~':
        case '\x01':
          cursor = 0
          break
        case '\x1b[F':
        case '\x1b[4~':
        case '\x05':
          cursor = characters.length
          break
        case '\x7f':
        case '\b':
          if (cursor > 0) characters.splice(--cursor, 1)
          break
        case '\x1b[3~':
          characters.splice(cursor, 1)
          break
        case '\r':
          characters = []
          cursor = 0
          break
        default: {
          // Treat pasted content as plain text, never as terminal control sequences.
          const text = data
            .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g, '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
          if (!text) return
          const prefix = characters.slice(0, cursor).join('') + text
          const next = prefix + characters.slice(cursor).join('')
          // shortcut: preview input is capped at 256 code units; use a real shell for longer editing.
          if (next.length > 256) return
          characters = split(next)
          cursor = split(prefix).length
        }
      }
      await render()
    })
  })
  return {
    dispose() {
      disposed = true
      input.dispose()
    },
  }
}
