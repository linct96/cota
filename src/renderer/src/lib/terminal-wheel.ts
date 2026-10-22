import type { Terminal } from '@xterm/xterm'

const replayedEvents = new WeakSet<Event>()

export const isTerminalWheelReplay = (event: Event) => replayedEvents.has(event)

export const isTerminalMouseReport = (data: string) =>
  data.startsWith('\x1b[<') || data.startsWith('\x1b[M')

export function installTerminalWheel(terminal: Terminal) {
  let disposed = false
  let direction = 0
  let remainder = 0
  let lastTime = 0
  let lastDistance = 0
  let streak = 0
  let pending = 0
  let scheduled = false
  let source: WheelEvent | undefined
  let target: EventTarget | null = null
  const reset = () => {
    direction = remainder = lastTime = lastDistance = streak = pending = 0
  }

  terminal.attachCustomWheelEventHandler((event) => {
    if (isTerminalWheelReplay(event)) return true
    if (
      disposed ||
      terminal.modes.mouseTrackingMode === 'none' ||
      !terminal.element?.classList.contains('enable-mouse-events') ||
      event.shiftKey ||
      event.deltaY === 0
    ) {
      reset()
      return true
    }
    const nextDirection = Math.sign(event.deltaY)
    if (direction !== nextDirection) reset()
    direction = nextDirection

    const legacy = event as WheelEvent & { wheelDeltaY?: number; wheelDelta?: number }
    const legacyDelta = legacy.wheelDeltaY ?? legacy.wheelDelta ?? 0
    const legacyRows = Number.isFinite(legacyDelta) ? Math.abs(legacyDelta) / 120 : 0
    const discrete = event.deltaMode !== 0 || legacyRows >= 100 / 120
    const cellHeight = terminal.dimensions?.css.cell.height || 16
    let distance = Math.max(
      Math.abs(event.deltaY) *
        (event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? terminal.rows : 1 / cellHeight),
      legacyRows,
    )
    // 触控板按物理距离累计；离散滚轮沿用 Orca 的压缩和连续滚动加速。
    if (discrete) {
      distance = Math.max(1, distance)
      const interval = event.timeStamp - lastTime
      const accelerating =
        lastTime > 0 && interval >= 0 && interval <= 45 && distance >= lastDistance * 0.85
      streak = accelerating ? Math.min(4, streak + 1) : 0
      const cadence = interval <= 16 ? 1 : (45 - interval) / 29
      const bonus = accelerating ? (3 * cadence * streak) / 4 : 0
      lastTime = event.timeStamp
      lastDistance = distance
      distance = Math.min(9, Math.min(6, 1 + Math.log2(distance) * 1.6) + bonus)
    }
    const total = remainder + distance
    const reports = Math.trunc(total)
    remainder = total - reports
    pending += reports
    source = event
    target = event.currentTarget ?? terminal.element!
    event.preventDefault()

    if (!scheduled && pending > 0) {
      scheduled = true
      // 等原事件返回后重放，避免重入 xterm 的滚轮处理。
      queueMicrotask(() => {
        scheduled = false
        const count = pending
        const original = source
        const destination = target
        pending = 0
        if (!original || !destination) return
        for (let i = 0; i < count; i++) {
          if (disposed || terminal.modes.mouseTrackingMode === 'none') break
          const replay = new WheelEvent('wheel', {
            bubbles: original.bubbles,
            cancelable: true,
            composed: original.composed,
            view: original.view,
            clientX: original.clientX,
            clientY: original.clientY,
            screenX: original.screenX,
            screenY: original.screenY,
            ctrlKey: original.ctrlKey,
            altKey: original.altKey,
            metaKey: original.metaKey,
            shiftKey: original.shiftKey,
            buttons: original.buttons,
            deltaMode: 1,
            deltaY: Math.sign(original.deltaY),
          })
          replayedEvents.add(replay)
          destination.dispatchEvent(replay)
        }
      })
    }
    return false
  })

  return {
    dispose() {
      disposed = true
      reset()
      source = undefined
      target = null
      terminal.attachCustomWheelEventHandler(() => true)
    },
  }
}
