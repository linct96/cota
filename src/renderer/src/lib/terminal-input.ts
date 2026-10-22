import type { Terminal } from '@xterm/xterm'
import { createTerminalKeyboardState } from '../../../shared/terminal-keyboard-state'
import { encodeTerminalText } from './terminal-input-encoding'
import { isTerminalMouseReport } from './terminal-wheel'

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

type TerminalInputOptions = {
  platform: string
  canSend: () => boolean
  write: (data: string, encoding?: 'utf8' | 'binary') => void
}

type TextPress = {
  event: TerminalKeyEvent
  encoding?: ReturnType<typeof encodeTerminalText>
  released?: TerminalKeyEvent
  delivered: boolean
}

export function createTerminalInputHandler({
  platform,
  canSend,
  write,
  getKittyFlags,
  textarea,
}: TerminalInputOptions & {
  getKittyFlags: () => number
  textarea: Pick<HTMLTextAreaElement, 'value'>
}) {
  let composing = false
  let settling = false
  let deadKey = false
  let heldEnter: 'ime' | 'newline' | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let pendingText: TextPress | undefined
  let compositionValue = ''
  const textKeys = new Map<string, TextPress>()
  const deferredText: TextPress[] = []
  const keyId = (event: TerminalKeyEvent) => event.code || event.key
  const send = (data: string) => {
    if (data && !disposed && canSend()) write(data)
  }
  const release = (press: TextPress) => {
    if (press.delivered && press.released && press.encoding)
      send(press.encoding.release(press.released, getKittyFlags()))
  }
  const deliver = (press: TextPress) => {
    if (!press.encoding || disposed || !canSend()) return
    send(press.encoding.data)
    press.delivered = true
    release(press)
  }
  const flushText = () => {
    const queued = deferredText.splice(0)
    for (const press of queued) deliver(press)
    if (!composing && (queued.length || pendingText)) textarea.value = ''
    compositionValue = ''
  }
  const reset = () => {
    clearTimeout(settleTimer)
    settleTimer = undefined
    composing = settling = false
    heldEnter = undefined
    pendingText = undefined
    compositionValue = ''
    textKeys.clear()
    deferredText.length = 0
  }
  return {
    send,
    reset,
    flushText,
    compositionStart() {
      composing = true
      // A real composition takes ownership back from the initial printable/Process key.
      pendingText = undefined
    },
    compositionEnd() {
      composing = false
      settling = true
      compositionValue = textarea.value
      clearTimeout(settleTimer)
      // Registered after xterm's compositionend: its commit must precede the next text press.
      settleTimer = setTimeout(() => {
        settling = false
        settleTimer = undefined
        flushText()
      }, 0)
    },
    handleInput(
      event: Pick<InputEvent, 'inputType' | 'data' | 'isComposing' | 'stopImmediatePropagation'>,
    ) {
      if (
        disposed ||
        composing ||
        event.isComposing ||
        event.inputType !== 'insertText' ||
        !pendingText
      )
        return
      const press = pendingText
      pendingText = undefined
      event.stopImmediatePropagation()
      if (event.data) {
        press.encoding = encodeTerminalText(event.data, press.event, getKittyFlags())
        if (settling) deferredText.push(press)
        else deliver(press)
      }
      // Do not let xterm's deferred composition diff include text this module already owns.
      textarea.value = settling ? compositionValue : ''
    },
    handleKeyEvent(event: TerminalKeyEvent): boolean {
      if (disposed) return false
      if (event.type === 'keydown' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
        pendingText = undefined
      const claimed = textKeys.get(keyId(event))
      if (event.type === 'keyup' && claimed) {
        claimed.released = event
        textKeys.delete(keyId(event))
        release(claimed)
        return false
      }
      if (event.type === 'keypress' && claimed) return false
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
            if (getKittyFlags() > 0) return true
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
      if (
        (event.metaKey || (platform === 'win32' && event.ctrlKey && event.shiftKey)) &&
        ['c', 'v'].includes(key)
      )
        return false

      if (event.type !== 'keydown') return true
      if (event.key === 'Dead' || event.key === 'AltGraph') {
        deadKey = true
        return true
      }
      if (deadKey && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
        // xterm must consume its own dead-key state before native text interception resumes.
        deadKey = false
        return true
      }
      if (
        !composing &&
        !event.isComposing &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        (Array.from(event.key).length === 1 || event.keyCode === 229 || event.key === 'Process')
      ) {
        const press: TextPress = { event, delivered: false }
        pendingText = press
        textKeys.set(keyId(event), press)
        if (!settling) textarea.value = ''
        // No preventDefault: the native text system, not keydown, decides the committed text.
        return false
      }
      return true
    },
    dispose() {
      disposed = true
      reset()
    },
  }
}

/** Own the browser/xterm boundary here so a view cannot accidentally install only half the input path. */
export function installTerminalInput(terminal: Terminal, options: TerminalInputOptions) {
  const textarea = terminal.textarea!
  const keyboard = createTerminalKeyboardState(terminal.parser)
  const canSend = () => !terminal.options.disableStdin && options.canSend()
  const input = createTerminalInputHandler({
    ...options,
    canSend,
    // Preserve xterm's user-input notifications (selection clearing and scroll-to-bottom).
    write: (value) => terminal.input(value, true),
    getKittyFlags: () => keyboard.flags,
    textarea,
  })
  let mouseReports = ''
  const flushMouse = () => {
    const value = mouseReports
    mouseReports = ''
    if (value && canSend()) options.write(value)
  }
  const data = terminal.onData((value) => {
    if (!canSend()) return
    if (isTerminalMouseReport(value)) {
      if (!mouseReports) queueMicrotask(flushMouse)
      mouseReports += value
    } else {
      // 同一批滚动报告合并写入 PTY；普通键盘输入保持原有顺序和写入边界。
      flushMouse()
      options.write(value)
    }
  })
  const binary = terminal.onBinary((value) => {
    if (!canSend()) return
    flushMouse()
    options.write(value, 'binary')
  })
  // xterm flushes a pending composition before onKey; native text must precede that control key.
  const key = terminal.onKey(input.flushText)
  terminal.attachCustomKeyEventHandler(input.handleKeyEvent)
  // Ancestor capture runs before xterm's textarea input listener, even though xterm opened first.
  const element = terminal.element!
  const nativeInput = (event: Event) => {
    if (event.target === textarea) input.handleInput(event as InputEvent)
  }
  element.addEventListener('input', nativeInput, true)
  textarea.addEventListener('compositionstart', input.compositionStart)
  textarea.addEventListener('compositionend', input.compositionEnd)
  textarea.addEventListener('blur', input.reset)
  return {
    dispose() {
      mouseReports = ''
      input.dispose()
      keyboard.dispose()
      data.dispose()
      binary.dispose()
      key.dispose()
      element.removeEventListener('input', nativeInput, true)
      textarea.removeEventListener('compositionstart', input.compositionStart)
      textarea.removeEventListener('compositionend', input.compositionEnd)
      textarea.removeEventListener('blur', input.reset)
      terminal.attachCustomKeyEventHandler(() => false)
    },
  }
}
