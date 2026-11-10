import { describe, expect, it, vi } from 'vitest'
import {
  isTerminalMenuShortcut,
  shortcutBinding,
  validateShortcutBindings,
} from '../../../src/shared/shortcuts'

import { Terminal } from '@xterm/headless'
import { createTerminalKeyboardState } from '../../../src/shared/terminal-keyboard-state'
import { createTerminalInputHandler } from '../../../src/renderer/src/features/terminal/lib/terminal-input'

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(
    class {
      dispose = vi.fn()
      onContextLoss = vi.fn((_listener: () => void) => ({ dispose: vi.fn() }))
    },
  ),
}))
describe('Terminal keyboard and native text input', () => {
  it('routes modified Enter once without submitting IME input or writing to inactive sessions', async () => {
    vi.useFakeTimers()
    const screen = new Terminal({
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
    })
    const keyboard = createTerminalKeyboardState(screen.parser)
    const replies: string[] = []
    screen.onData((data) => replies.push(data))
    const output = async (data: string) => {
      const parsed = new Promise<void>((resolve) => screen.write(data, resolve))
      await vi.runAllTimersAsync()
      await parsed
    }
    const expectFlags = async (flags: number) => {
      await output('\x1b[?u')
      expect(replies.at(-1)).toBe(`\x1b[?${flags}u`)
      expect(keyboard.flags).toBe(flags)
    }
    let running = true
    const write = vi.fn()
    const input = createTerminalInputHandler({
      platform: 'darwin',
      canSend: () => running,
      write,
      getKittyFlags: () => keyboard.flags,
      textarea: { value: '' },
    })
    type KeyEvent = Parameters<typeof input.handleKeyEvent>[0]
    const key = (overrides: Partial<KeyEvent> = {}): KeyEvent => ({
      type: 'keydown',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: vi.fn(),
      ...overrides,
    })
    const expectMenuShortcuts = () => {
      const shortcuts: Partial<KeyEvent>[] = [
        ...[
          'o',
          't',
          'd',
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
        ].map((workspaceKey) => ({ key: workspaceKey })),
        { key: 'Z', shiftKey: true },
        { key: 'T', code: 'KeyT', shiftKey: true },
        { key: 'D', code: 'KeyD', shiftKey: true },
        { key: '˙', code: 'KeyH', altKey: true },
      ]
      for (const shortcut of shortcuts) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const event = key({
            code: '',
            keyCode: 0,
            shiftKey: false,
            metaKey: true,
            ...shortcut,
            type,
          })
          expect(input.handleKeyEvent(event)).toBe(false)
          expect(event.preventDefault).not.toHaveBeenCalled()
        }
      }
      expect(
        input.handleKeyEvent(key({ key: 'w', shiftKey: false, metaKey: true, repeat: true })),
      ).toBe(false)
      for (const modifiers of [
        { metaKey: false, ctrlKey: true, shiftKey: false },
        { metaKey: true, ctrlKey: true, shiftKey: false },
        { metaKey: true, altKey: true, shiftKey: false },
        { metaKey: true, shiftKey: true },
      ])
        expect(input.handleKeyEvent(key({ key: 'w', code: 'KeyW', ...modifiers }))).toBe(true)
      expect(
        input.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: false })),
      ).toBe(true)
    }
    try {
      for (const platform of ['darwin', 'win32', 'linux']) {
        const editKey = (value: string, shiftKey = false) =>
          key({
            key: value,
            code: `Key${value.toUpperCase()}`,
            shiftKey,
            metaKey: platform === 'darwin',
            ctrlKey: platform !== 'darwin',
          })
        const remapped = { copy: 'CommandOrControl+Shift+B', paste: '', 'select-all': '' }
        for (const value of ['c', 'v', 'a']) {
          expect(isTerminalMenuShortcut(editKey(value), {}, platform)).toBe(true)
          expect(isTerminalMenuShortcut(editKey(value), remapped, platform)).toBe(true)
        }
        expect(isTerminalMenuShortcut(editKey('b', true), remapped, platform)).toBe(true)
        expect(isTerminalMenuShortcut(editKey('v', true), remapped, platform)).toBe(false)
        for (const value of ['x', 'z', 't', ','])
          expect(isTerminalMenuShortcut(editKey(value), remapped, platform)).toBe(false)
        const onShortcut = vi.fn()
        const clipboardInput = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 0,
          textarea: { value: '' },
          getShortcuts: () => remapped,
          onShortcut,
        })
        for (const type of ['keydown', 'keypress', 'keyup'])
          clipboardInput.handleKeyEvent({ ...editKey('b', true), type })
        expect(onShortcut).toHaveBeenCalledExactlyOnceWith('copy')
        clipboardInput.dispose()
        expect(shortcutBinding({}, 'toggle-right-panel', platform)).toBe('CommandOrControl+L')
        expect(shortcutBinding({ paste: '' }, 'paste', platform)).toBe('')
        expect(() =>
          validateShortcutBindings(
            {
              'toggle-right-panel': 'Shift+CommandOrControl+P',
              'new-terminal': 'CommandOrControl+Shift+P',
            },
            platform,
          ),
        ).toThrow('“新建终端”与“展开 / 收起右侧面板”的快捷键冲突。')
        const bindings = validateShortcutBindings(
          { 'toggle-right-panel': 'CommandOrControl+P' },
          platform,
        )
        let configured = false
        const panelInput = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 1,
          textarea: { value: '' },
          getShortcuts: () => (configured ? bindings : {}),
        })
        for (const value of ['l', 'p']) {
          for (const type of ['keydown', 'keypress', 'keyup'])
            expect(
              panelInput.handleKeyEvent(
                key({
                  key: value,
                  code: `Key${value.toUpperCase()}`,
                  type,
                  shiftKey: false,
                  metaKey: platform === 'darwin',
                  ctrlKey: platform !== 'darwin',
                }),
              ),
            ).toBe(false)
          configured = true
        }
        panelInput.dispose()
      }
      expectMenuShortcuts()
      for (const platform of ['win32', 'linux']) {
        const other = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 1,
          textarea: { value: '' },
        })
        expect(other.handleKeyEvent(key({ key: 'w', shiftKey: false, metaKey: true }))).toBe(true)
        expect(other.handleKeyEvent(key({ key: 'w', shiftKey: false, ctrlKey: true }))).toBe(true)
        expect(
          other.handleKeyEvent(key({ key: 'd', code: 'KeyD', shiftKey: false, ctrlKey: true })),
        ).toBe(true)
        expect(other.handleKeyEvent(key({ key: 'c', ctrlKey: true }))).toBe(platform !== 'win32')
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const reopen = key({ key: 'T', code: 'KeyT', ctrlKey: true, type })
          expect(other.handleKeyEvent(reopen)).toBe(false)
          expect(reopen.preventDefault).not.toHaveBeenCalled()
        }
        expect(other.handleKeyEvent(key({ key: 't', ctrlKey: true, shiftKey: false }))).toBe(true)
        other.dispose()
      }
      expect(input.handleKeyEvent(key({ shiftKey: false }))).toBe(true)
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const)
        expect(input.handleKeyEvent(key({ [modifier]: true }))).toBe(true)
      expect(input.handleKeyEvent(key({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false)
      expect(write).not.toHaveBeenCalled()

      const shiftEnter = key()
      expect(input.handleKeyEvent(shiftEnter)).toBe(false)
      expect(shiftEnter.preventDefault).toHaveBeenCalledOnce()
      expect(input.handleKeyEvent(key({ type: 'keypress' }))).toBe(false)
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(false)
      expect(input.handleKeyEvent(key({ type: 'keyup', shiftKey: false }))).toBe(false)
      expect(write.mock.calls).toEqual([['\x1b\r']])

      input.compositionStart()
      const confirm = key({ shiftKey: false, isComposing: true })
      expect(input.handleKeyEvent(confirm)).toBe(false)
      expect(confirm.preventDefault).not.toHaveBeenCalled()
      input.compositionEnd()
      expect(input.handleKeyEvent(key({ type: 'keyup' }))).toBe(false)
      expect(input.handleKeyEvent(key())).toBe(false)
      input.send('中文')
      vi.runAllTimers()
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(false)
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(input.handleKeyEvent(key())).toBe(false)
      expect(write.mock.calls).toEqual([['\x1b\r'], ['中文'], ['\x1b\r']])

      input.reset()
      expect(input.handleKeyEvent(key({ isComposing: true }))).toBe(false)
      input.reset()
      expect(input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))).toBe(false)
      input.reset()
      running = false
      input.send('late input')
      input.handleKeyEvent(key())
      expect(write).toHaveBeenCalledTimes(3)
      running = true
      input.compositionEnd()
      input.reset()
      expect(vi.getTimerCount()).toBe(0)
      input.send('resumed')
      expect(write.mock.calls).toEqual([['\x1b\r'], ['中文'], ['\x1b\r'], ['resumed']])

      await output('\x1b[>7') // Pi negotiation can span PTY output chunks.
      expect(keyboard.flags).toBe(0)
      await output('u')
      await expectFlags(7)
      expectMenuShortcuts()
      expect(input.handleKeyEvent(key({ shiftKey: false }))).toBe(true)
      const nativeShiftEnter = key()
      expect(input.handleKeyEvent(nativeShiftEnter)).toBe(true)
      expect(nativeShiftEnter.preventDefault).not.toHaveBeenCalled()
      expect(input.handleKeyEvent(key({ type: 'keypress' }))).toBe(true)
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(true)
      expect(input.handleKeyEvent(key({ type: 'keyup' }))).toBe(true)
      expect(write).toHaveBeenCalledTimes(4)
      input.reset() // Focus changes must not erase the CLI's negotiated mode.
      expect(keyboard.flags).toBe(7)
      input.compositionStart()
      expect(input.handleKeyEvent(key({ isComposing: true }))).toBe(false)
      input.compositionEnd()
      input.handleKeyEvent(key({ type: 'keyup' }))
      vi.runAllTimers()
      await output('\x1b[=1;3u')
      await expectFlags(6)
      await output('\x1b[=1;2u\x1b[=0;4u')
      await expectFlags(7)
      await output('\x1b[>3u\x1b[<u')
      await expectFlags(7)
      await output('\x1b[<u')
      await expectFlags(0)
      input.handleKeyEvent(key())
      expect(write).toHaveBeenLastCalledWith('\x1b\r')
      await output('\x1b[>1u\x1b[?1049h\x1b[>7u\x1b[!p')
      await expectFlags(0)
      expect(screen.buffer.active.type).toBe('alternate')
      await output('\x1b[?1049l')
      await expectFlags(0)
      await output('\x1b[>7u'.repeat(20) + '\x1b[<65535u')
      await expectFlags(0)
      await output('\x1b[>7u\x1b[?1049h\x1bc')
      await expectFlags(0)
      expect(screen.buffer.active.type).toBe('normal')
      input.compositionEnd()
      input.dispose()
      vi.runAllTimers()
      input.send('disposed input')
      expect(input.handleKeyEvent(key())).toBe(false)
      expect(write).toHaveBeenCalledTimes(5)
    } finally {
      input.dispose()
      keyboard.dispose()
      screen.dispose()
      vi.useRealTimers()
    }
  })

  it('routes native text commits once, preserving composition order, Kitty releases and cancellation', () => {
    vi.useFakeTimers()
    let flags = 0
    let running = true
    const textarea = { value: '' }
    const write = vi.fn()
    const input = createTerminalInputHandler({
      platform: 'darwin',
      canSend: () => running,
      write,
      getKittyFlags: () => flags,
      textarea,
    })
    type KeyEvent = Parameters<typeof input.handleKeyEvent>[0]
    const key = (overrides: Partial<KeyEvent> = {}): KeyEvent => ({
      type: 'keydown',
      key: '.',
      code: 'Period',
      keyCode: 190,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: vi.fn(),
      ...overrides,
    })
    const commit = (data: string, overrides = {}) => {
      textarea.value += data
      const event = {
        inputType: 'insertText',
        data,
        isComposing: false,
        stopImmediatePropagation: vi.fn(),
        ...overrides,
      }
      input.handleInput(event)
      return event
    }
    const output = () => write.mock.calls.map(([data]) => data).join('')
    try {
      for (const initial of ['', '上次提交']) {
        textarea.value = initial
        for (const process of [false, true]) {
          for (const delayed of [false, true]) {
            const event = key(process ? { key: 'Process', keyCode: 229 } : {})
            expect(input.handleKeyEvent(event)).toBe(false)
            expect(event.preventDefault).not.toHaveBeenCalled()
            expect(textarea.value).toBe('')
            expect(input.handleKeyEvent(key({ ...event, type: 'keypress' }))).toBe(false)
            if (delayed) {
              vi.runAllTimers()
              expect(input.handleKeyEvent(key({ ...event, type: 'keyup' }))).toBe(false)
            }
            expect(commit('。').stopImmediatePropagation).toHaveBeenCalledOnce()
            if (!delayed) input.handleKeyEvent(key({ ...event, type: 'keyup' }))
            expect(textarea.value).toBe('')
          }
        }
      }
      expect(output()).toBe('。'.repeat(8))
      write.mockClear()

      // A claimed printable key can open a real composition instead of committing directly.
      input.handleKeyEvent(key({ key: 'n', code: 'KeyN', keyCode: 78 }))
      input.compositionStart()
      expect(commit('ni', { isComposing: true }).stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      setTimeout(() => input.send(textarea.value), 0) // xterm's deferred composition commit
      input.compositionEnd()
      expect(commit('你').stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))
      commit('。')
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(output()).toBe('')
      expect(textarea.value).toBe('你')
      vi.runAllTimers()
      expect(output()).toBe('你。')

      write.mockClear()
      input.compositionStart()
      textarea.value = '好'
      input.compositionEnd()
      input.handleKeyEvent(key())
      commit('。')
      const control = key({ key: 'c', code: 'KeyC', ctrlKey: true })
      expect(input.handleKeyEvent(control)).toBe(true)
      input.send('好') // xterm finalizes before onKey, then emits the control byte.
      input.flushText()
      input.send('\x03')
      vi.runAllTimers()
      expect(output()).toBe('好。\x03')
      input.reset()

      for (flags of [0, 1, 2, 4, 7, 8, 10, 16, 24, 31]) {
        write.mockClear()
        input.handleKeyEvent(key())
        commit('。')
        input.handleKeyEvent(key({ type: 'keyup' }))
        const press = flags & 8 ? (flags & 16 ? '\x1b[46;;12290u' : '\x1b[46u') : '。'
        expect(output()).toBe(press + (flags & 2 ? '\x1b[46;1:3u' : ''))
      }
      flags = 7
      write.mockClear()
      input.handleKeyEvent(key({ key: '?', code: 'Slash', shiftKey: true }))
      input.handleKeyEvent(key({ key: '/', code: 'Slash', type: 'keyup' }))
      commit('？') // Key release may precede the native commit.
      expect(output()).toBe('？\x1b[47;1:3u')
      write.mockClear()
      input.handleKeyEvent(key())
      commit('。')
      flags = 0 // An exiting CLI must not leak a release report into its successor.
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(output()).toBe('。')

      write.mockClear()
      const letter = key({ key: 'a', code: 'KeyA' })
      input.handleKeyEvent(letter)
      commit('a')
      input.handleKeyEvent(key({ ...letter, repeat: true }))
      commit('a')
      input.handleKeyEvent(key({ ...letter, type: 'keyup' }))
      input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))
      commit('🙂')
      expect(output()).toBe('aa🙂')
      write.mockClear()
      expect(input.handleKeyEvent(key({ key: 'Dead', code: 'Quote' }))).toBe(true)
      expect(input.handleKeyEvent(key({ key: 'e', code: 'KeyE' }))).toBe(true)
      expect(commit('é').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(key())
      input.reset() // Blur cancels a pending native commit.
      expect(commit('。').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(key())
      running = false
      commit('。')
      running = true
      flags = 7
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(write).not.toHaveBeenCalled()
      input.compositionStart()
      textarea.value = '再'
      input.compositionEnd()
      input.handleKeyEvent(key())
      commit('。')
      input.dispose()
      vi.runAllTimers()
      input.send('late')
      expect(write).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      input.dispose()
      vi.useRealTimers()
    }
  })
})
