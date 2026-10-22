// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installTerminalInput } from '../src/renderer/src/lib/terminal-input'
import { installTerminalScroll } from '../src/renderer/src/lib/terminal-scroll'
import { installTerminalWheel, isTerminalWheelReplay } from '../src/renderer/src/lib/terminal-wheel'

const cleanup: (() => void)[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  document.body.replaceChildren()
  vi.useRealTimers()
})

function terminalFixture() {
  const terminal = new Terminal({ cols: 20, rows: 5, scrollback: 1000 })
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  const scrollbar = document.createElement('div')
  scrollbar.className = 'xterm-scrollbar'
  element.append(textarea, scrollbar)
  document.body.append(element)
  // 使用真实浏览器版解析器和缓冲区，不启动画布或可见 Electron 窗口。
  Object.defineProperties(terminal, { element: { value: element }, textarea: { value: textarea } })
  cleanup.push(() => terminal.dispose())
  return { terminal, element, scrollbar }
}

async function write(terminal: Terminal, data: string) {
  const parsed = new Promise<void>((resolve) => terminal.write(data, resolve))
  await vi.advanceTimersByTimeAsync(1)
  await parsed
}

const transcript = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `${String(index).padStart(2, '0')}:abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop`,
  ).join('\r\n')

it('replays TUI wheel distance once, batches reports, and preserves bypass/disposal boundaries', async () => {
  const { terminal, element } = terminalFixture()
  await write(terminal, '\x1b[?1003h\x1b[?1006h')
  element.classList.add('enable-mouse-events')
  let handler = (_event: WheelEvent): boolean => true
  vi.spyOn(terminal, 'attachCustomWheelEventHandler').mockImplementation((next) => {
    handler = next
  })
  const reports: WheelEvent[] = []
  element.addEventListener('wheel', (event) => {
    if (handler(event) && isTerminalWheelReplay(event)) {
      reports.push(event)
      terminal.input(`\x1b[<${event.deltaY < 0 ? 64 : 65};1;1M`, true)
    }
  })
  const send = vi.fn()
  const input = installTerminalInput(terminal, {
    platform: 'darwin',
    canSend: () => true,
    write: send,
  })
  const wheel = installTerminalWheel(terminal)
  cleanup.push(input.dispose, wheel.dispose)
  const dispatch = (deltaY: number, options: WheelEventInit = {}) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...options })
    element.dispatchEvent(event)
    return event
  }
  const drain = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  expect(dispatch(8).defaultPrevented).toBe(true)
  await drain()
  expect(send).not.toHaveBeenCalled()
  dispatch(8)
  await drain()
  expect(send).toHaveBeenLastCalledWith('\x1b[<65;1;1M')
  send.mockClear()
  dispatch(48)
  await drain()
  expect(send).toHaveBeenCalledExactlyOnceWith('\x1b[<65;1;1M'.repeat(3))
  expect(reports.every((event) => event.deltaMode === 1)).toBe(true)

  send.mockClear()
  dispatch(48)
  dispatch(-16)
  await drain()
  expect(send).toHaveBeenCalledExactlyOnceWith('\x1b[<64;1;1M')
  send.mockClear()
  dispatch(3, { deltaMode: 1 })
  await drain()
  expect(send).toHaveBeenCalledExactlyOnceWith('\x1b[<65;1;1M'.repeat(3))
  send.mockClear()
  dispatch(3, { deltaMode: 1 })
  await drain()
  expect(send).toHaveBeenCalledExactlyOnceWith('\x1b[<65;1;1M'.repeat(4))
  expect(dispatch(48, { shiftKey: true }).defaultPrevented).toBe(false)
  await write(terminal, '\x1b[?1003l')
  expect(dispatch(48).defaultPrevented).toBe(false)

  await write(terminal, '\x1b[?1003h')
  send.mockClear()
  dispatch(48)
  wheel.dispose()
  await drain()
  expect(send).not.toHaveBeenCalled()
})

it('keeps a reading anchor across output, mouse reports, reflow and a chunked scrollback clear', async () => {
  const { terminal, element, scrollbar } = terminalFixture()
  await write(terminal, transcript(30))
  const scrolling = installTerminalScroll(terminal)
  cleanup.push(scrolling.dispose)
  scrollbar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  terminal.scrollToLine(13)
  window.dispatchEvent(new MouseEvent('pointerup'))
  await vi.advanceTimersByTimeAsync(81)
  const top = () =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY)!.translateToString(true)
  const text = top()
  const position = terminal.buffer.active.viewportY

  terminal.input('\x1b[<32;1;1M', true)
  expect(terminal.buffer.active.viewportY).toBe(position)
  await write(terminal, '\x1b[6n\r\nmore output')
  expect(top()).toBe(text)
  scrolling.preserve(() => terminal.resize(10, 5))
  expect(top()).toBe(text.slice(0, 10))

  const offset = scrolling.offset!
  await write(terminal, '\x1b[3')
  await write(terminal, 'J\x1b[H\x1b[2J')
  await write(terminal, transcript(40))
  await vi.advanceTimersByTimeAsync(121)
  expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY - offset)
  const restored = terminal.buffer.active.viewportY
  await write(terminal, '\r\nmore output\r\nmore output')
  expect(terminal.buffer.active.viewportY).toBe(restored)

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }))
  terminal.scrollToBottom()
  await vi.advanceTimersByTimeAsync(81)
  scrolling.preserve(() => terminal.resize(20, 8))
  expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY)
})

it('lets newer input win over a pending redraw and restores a saved snapshot offset', async () => {
  const { terminal, element } = terminalFixture()
  await write(terminal, transcript(20))
  terminal.scrollToLine(5)
  const scrolling = installTerminalScroll(terminal)
  cleanup.push(scrolling.dispose)
  const offset = scrolling.offset
  terminal.scrollToBottom()
  scrolling.restore(offset)
  expect(terminal.buffer.active.viewportY).toBe(5)

  await write(terminal, '\x1b[3J\x1b[H\x1b[2J')
  terminal.input('a', true)
  await write(terminal, transcript(25))
  await vi.advanceTimersByTimeAsync(1001)
  expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY)

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
  terminal.scrollToLine(3)
  await vi.advanceTimersByTimeAsync(81)
  await write(terminal, '\x1b[3J\x1b[?1049h')
  await vi.advanceTimersByTimeAsync(1001)
  expect(terminal.buffer.active.type).toBe('alternate')
  expect(terminal.buffer.active.viewportY).toBe(0)
})
