type TerminalKeyEvent = Pick<
  KeyboardEvent,
  | 'type'
  | 'key'
  | 'code'
  | 'keyCode'
  | 'shiftKey'
  | 'ctrlKey'
  | 'altKey'
  | 'metaKey'
  | 'repeat'
  | 'isComposing'
  | 'preventDefault'
>

export function createTerminalInputHandler({
  platform,
  canSend,
  write,
  useKitty,
}: {
  platform: string
  canSend: () => boolean
  write: (data: string) => void
  useKitty: () => boolean
}) {
  let composing = false
  let settling = false
  let heldEnter: 'ime' | 'newline' | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const send = (data: string) => {
    if (!disposed && canSend()) write(data)
  }
  const reset = () => {
    clearTimeout(settleTimer)
    settleTimer = undefined
    composing = settling = false
    heldEnter = undefined
  }
  return {
    send,
    reset,
    compositionStart() {
      clearTimeout(settleTimer)
      composing = true
      settling = false
    },
    compositionEnd() {
      composing = false
      settling = true
      clearTimeout(settleTimer)
      // xterm flushes composed text asynchronously; this turn's Enter still belongs to the IME.
      settleTimer = setTimeout(() => {
        settling = false
        settleTimer = undefined
      }, 0)
    },
    handleKeyEvent(event: TerminalKeyEvent): boolean {
      if (disposed) return false
      const isEnter =
        event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter'
      if (isEnter) {
        if (event.type === 'keyup') {
          const handled = heldEnter !== undefined
          heldEnter = undefined
          return !handled
        }
        if (heldEnter && (event.type === 'keypress' || event.repeat)) {
          if (heldEnter === 'newline') event.preventDefault()
          return false
        }
        if (event.type === 'keydown') {
          heldEnter = undefined
          if (composing || settling || event.isComposing || event.keyCode === 229) {
            // Let the IME confirm natively without forwarding Enter to the PTY.
            heldEnter = 'ime'
            return false
          }
          if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            if (useKitty()) return true
            heldEnter = 'newline'
            event.preventDefault()
            send('\x1b\r')
            return false
          }
        }
      }
      const key = event.key.toLowerCase()
      // Keep macOS menu accelerators out of Kitty encoding, including key releases.
      if (
        platform === 'darwin' &&
        event.metaKey &&
        !event.ctrlKey &&
        ((!event.altKey &&
          !event.shiftKey &&
          [
            'o',
            't',
            'w',
            ',',
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            'a',
            'x',
            'c',
            'v',
            'z',
            'q',
            'h',
            'm',
          ].includes(key)) ||
          (!event.altKey && event.shiftKey && key === 'z') ||
          (event.altKey && !event.shiftKey && event.code === 'KeyH'))
      )
        return false
      return !(
        (event.metaKey || (platform === 'win32' && event.ctrlKey && event.shiftKey)) &&
        ['c', 'v'].includes(key)
      )
    },
    dispose() {
      disposed = true
      reset()
    },
  }
}
