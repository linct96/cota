import type { IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { isTerminalMouseReport, isTerminalWheelReplay } from './terminal-wheel'

type ReadingAnchor = { marker: IMarker; cellOffset: number }

function rowWidth(terminal: Terminal, row: number) {
  const buffer = terminal.buffer.active
  const last = buffer.getLine(row)?.getCell(terminal.cols - 1)
  return last?.getCode() === 0 &&
    last.getWidth() === 1 &&
    buffer
      .getLine(row + 1)
      ?.getCell(0)
      ?.getWidth() === 2
    ? terminal.cols - 1
    : terminal.cols
}

function captureAnchor(terminal: Terminal): ReadingAnchor {
  const buffer = terminal.buffer.active
  let row = buffer.viewportY
  let cellOffset = 0
  while (row > 0 && buffer.getLine(row)?.isWrapped) {
    row--
    cellOffset += rowWidth(terminal, row)
  }
  return {
    marker: terminal.registerMarker(row - (buffer.baseY + buffer.cursorY)),
    cellOffset,
  }
}

function anchorRow(terminal: Terminal, anchor: ReadingAnchor) {
  if (anchor.marker.isDisposed) return 0
  let row = anchor.marker.line
  let remaining = anchor.cellOffset
  while (row < terminal.buffer.active.baseY && terminal.buffer.active.getLine(row + 1)?.isWrapped) {
    const width = rowWidth(terminal, row)
    if (remaining < width) break
    remaining -= width
    row++
  }
  return row
}

export function installTerminalScroll(terminal: Terminal) {
  const element = terminal.element!
  const view = element.ownerDocument.defaultView!
  let disposed = false
  let restoring = false
  let dragging = false
  let userInput = false
  let revision = 0
  let anchor: ReadingAnchor | undefined
  let frame: number | undefined
  let sampleTimer: ReturnType<typeof setTimeout> | undefined
  let redrawTimer: ReturnType<typeof setTimeout> | undefined
  let redraw: { offset: number; deadline: number } | undefined
  const normal = () => terminal.buffer.active.type === 'normal'
  const releaseAnchor = () => {
    anchor?.marker.dispose()
    anchor = undefined
  }
  const cancelRedraw = () => {
    clearTimeout(redrawTimer)
    redrawTimer = undefined
    redraw = undefined
  }
  const interact = () => {
    revision++
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    clearTimeout(sampleTimer)
    cancelRedraw()
  }
  const sample = (keepBottom = false) => {
    if (disposed || restoring || redraw) return
    releaseAnchor()
    const buffer = terminal.buffer.active
    if (normal() && buffer.baseY > 0 && (keepBottom || buffer.viewportY < buffer.baseY))
      anchor = captureAnchor(terminal)
  }
  const scroll = (row: number) => {
    restoring = true
    try {
      terminal.scrollToLine(Math.max(0, row))
    } finally {
      restoring = false
    }
  }
  const sampleSoon = () => {
    const current = revision
    const run = () => {
      if (!disposed && current === revision) sample()
    }
    queueMicrotask(run)
    frame = view.requestAnimationFrame(run)
    sampleTimer = setTimeout(run, 80)
  }
  const scheduleRedraw = () => {
    if (!redraw) return
    clearTimeout(redrawTimer)
    redrawTimer = setTimeout(
      () => {
        const pending = redraw
        if (!pending || disposed || !normal()) return
        const buffer = terminal.buffer.active
        if (buffer.baseY < pending.offset && performance.now() < pending.deadline) {
          scheduleRedraw()
          return
        }
        cancelRedraw()
        scroll(buffer.baseY - pending.offset)
        sample()
      },
      Math.max(0, Math.min(120, redraw.deadline - performance.now())),
    )
  }
  const observeErase = (params: (number | number[])[]) => {
    const buffer = terminal.buffer.active
    if (params[0] === 3 && normal() && !redraw && buffer.viewportY < buffer.baseY) {
      redraw = { offset: buffer.baseY - buffer.viewportY, deadline: performance.now() + 1000 }
      scheduleRedraw()
    }
    // 只观察清屏；仍由 xterm 执行原始指令。
    return false
  }

  const onWheel = (event: WheelEvent) => {
    if (
      isTerminalWheelReplay(event) ||
      event.deltaY === 0 ||
      (terminal.modes.mouseTrackingMode !== 'none' && !event.shiftKey)
    )
      return
    interact()
    sample(event.deltaY < 0)
    sampleSoon()
  }
  const onPointerDown = (event: PointerEvent) => {
    dragging =
      event.target instanceof view.Element &&
      !!event.target.closest('.xterm-scrollbar, .xterm-viewport')
    if (dragging) interact()
  }
  const onPointerDone = () => {
    if (!dragging) return
    dragging = false
    sample()
    sampleSoon()
  }
  const onScroll = () => {
    if (dragging) sample()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
    interact()
    sample(event.key === 'PageUp' || event.key === 'Home')
    sampleSoon()
  }

  // 固定版本 xterm 只有内部 onUserInput 能区分真实输入与解析器自动回复。
  const core = (
    terminal as Terminal & {
      _core: { coreService: { onUserInput: (listener: () => void) => IDisposable } }
    }
  )._core.coreService
  const subscriptions = [
    core.onUserInput(() => {
      userInput = true
    }),
    terminal.onData((data) => {
      const actualInput = userInput
      userInput = false
      if (!actualInput) return
      if (isTerminalMouseReport(data)) {
        if (anchor && normal() && !redraw) scroll(anchorRow(terminal, anchor))
      } else {
        interact()
        sample()
      }
    }),
    terminal.onScroll(onScroll),
    terminal.onWriteParsed(scheduleRedraw),
    terminal.buffer.onBufferChange(() => {
      interact()
      releaseAnchor()
      userInput = false
    }),
    terminal.parser.registerCsiHandler({ final: 'J' }, observeErase),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'J' }, observeErase),
  ]
  element.addEventListener('wheel', onWheel, { capture: true, passive: true })
  element.addEventListener('pointerdown', onPointerDown, true)
  element.addEventListener('keydown', onKeyDown, true)
  view.addEventListener('pointerup', onPointerDone, true)
  view.addEventListener('pointercancel', onPointerDone, true)
  sample()

  return {
    get offset() {
      if (redraw) return redraw.offset
      const buffer = terminal.buffer.active
      return normal() && buffer.viewportY < buffer.baseY
        ? buffer.baseY - buffer.viewportY
        : undefined
    },
    restore(offset: number | undefined) {
      if (offset !== undefined && normal()) {
        scroll(terminal.buffer.active.baseY - offset)
        sample()
      }
    },
    preserve(action: () => void) {
      if (!normal() || redraw) return action()
      const buffer = terminal.buffer.active
      const pinned = buffer.viewportY < buffer.baseY
      const before = pinned ? captureAnchor(terminal) : undefined
      const current = revision
      restoring = true
      try {
        action()
      } finally {
        restoring = false
        try {
          if (!disposed && current === revision && normal()) {
            if (before) scroll(anchorRow(terminal, before))
            else terminal.scrollToBottom()
            sample()
          }
        } finally {
          before?.marker.dispose()
        }
      }
    },
    dispose() {
      disposed = true
      interact()
      releaseAnchor()
      subscriptions.forEach((subscription) => subscription.dispose())
      element.removeEventListener('wheel', onWheel, true)
      element.removeEventListener('pointerdown', onPointerDown, true)
      element.removeEventListener('keydown', onKeyDown, true)
      view.removeEventListener('pointerup', onPointerDone, true)
      view.removeEventListener('pointercancel', onPointerDone, true)
    },
  }
}
