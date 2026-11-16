import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

type KeyEvent = Parameters<ReturnType<typeof createTerminalInputHandler>['handleKeyEvent']>[0]

function enterKey(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
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
  }
}

function editKey(platform: string, value: string, shiftKey = false): KeyEvent {
  return enterKey({
    key: value,
    code: `Key${value.toUpperCase()}`,
    shiftKey,
    metaKey: platform === 'darwin',
    ctrlKey: platform !== 'darwin',
  })
}

function periodKey(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
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
  }
}

function createKeyboardFixture() {
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
  const state = { running: true }
  const write = vi.fn()
  const input = createTerminalInputHandler({
    platform: 'darwin',
    canSend: () => state.running,
    write,
    getKittyFlags: () => keyboard.flags,
    textarea: { value: '' },
  })
  return { screen, keyboard, replies, output, state, write, input }
}

function createNativeFixture() {
  const state = { flags: 0, running: true }
  const textarea = { value: '' }
  const write = vi.fn()
  const input = createTerminalInputHandler({
    platform: 'darwin',
    canSend: () => state.running,
    write,
    getKittyFlags: () => state.flags,
    textarea,
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
  return { state, textarea, write, input, commit, output }
}

describe('Terminal keyboard and native text input', () => {
  describe('keyboard routing', () => {
    let fixture: ReturnType<typeof createKeyboardFixture>
    let cleanup: (() => void) | undefined

    beforeEach(() => {
      vi.useFakeTimers()
      cleanup = undefined
      fixture = createKeyboardFixture()
      cleanup = () => {
        fixture.input.dispose()
        fixture.keyboard.dispose()
        fixture.screen.dispose()
      }
    })
    afterEach(() => {
      try {
        cleanup?.()
      } finally {
        vi.useRealTimers()
      }
    })

    const remapped = { copy: 'CommandOrControl+Shift+B', paste: '', 'select-all': '' }

    it.each(['darwin', 'win32', 'linux'])(
      'recognizes default and remapped edit shortcuts on %s',
      (platform) => {
        for (const value of ['c', 'v', 'a']) {
          expect(isTerminalMenuShortcut(editKey(platform, value), {}, platform)).toBe(true)
          expect(isTerminalMenuShortcut(editKey(platform, value), remapped, platform)).toBe(true)
        }
        expect(isTerminalMenuShortcut(editKey(platform, 'b', true), remapped, platform)).toBe(true)
        expect(isTerminalMenuShortcut(editKey(platform, 'v', true), remapped, platform)).toBe(false)
        for (const value of ['x', 'z', 't', ','])
          expect(isTerminalMenuShortcut(editKey(platform, value), remapped, platform)).toBe(false)
      },
    )

    it.each(['darwin', 'win32', 'linux'])('dispatches remapped copy once on %s', (platform) => {
      const { state, write } = fixture
      const onShortcut = vi.fn()
      const clipboardInput = createTerminalInputHandler({
        platform,
        canSend: () => state.running,
        write,
        getKittyFlags: () => 0,
        textarea: { value: '' },
        getShortcuts: () => remapped,
        onShortcut,
      })
      try {
        for (const type of ['keydown', 'keypress', 'keyup'])
          clipboardInput.handleKeyEvent({ ...editKey(platform, 'b', true), type })
        expect(onShortcut).toHaveBeenCalledExactlyOnceWith('copy')
        expect(write).not.toHaveBeenCalled()
      } finally {
        clipboardInput.dispose()
      }
    })

    it.each(['darwin', 'win32', 'linux'])('validates shortcut bindings on %s', (platform) => {
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
    })

    it.each(['darwin', 'win32', 'linux'])(
      'routes panel shortcuts after bindings change on %s',
      (platform) => {
        const { state, write } = fixture
        const bindings = validateShortcutBindings(
          { 'toggle-right-panel': 'CommandOrControl+P' },
          platform,
        )
        let configured = false
        const panelInput = createTerminalInputHandler({
          platform,
          canSend: () => state.running,
          write,
          getKittyFlags: () => 1,
          textarea: { value: '' },
          getShortcuts: () => (configured ? bindings : {}),
        })
        try {
          for (const value of ['l', 'p']) {
            for (const type of ['keydown', 'keypress', 'keyup'])
              expect(panelInput.handleKeyEvent({ ...editKey(platform, value), type })).toBe(false)
            configured = true
          }
          expect(write).not.toHaveBeenCalled()
        } finally {
          panelInput.dispose()
        }
      },
    )

    const menuShortcuts: (Partial<KeyEvent> & { key: string })[] = [
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
      ].map((key) => ({ key })),
      { key: 'Z', shiftKey: true },
      { key: 'T', code: 'KeyT', shiftKey: true },
      { key: 'D', code: 'KeyD', shiftKey: true },
      { key: '˙', code: 'KeyH', altKey: true },
    ]

    it.each(
      [0, 7].flatMap((flags) =>
        menuShortcuts.map((shortcut) => ({
          flags,
          shortcut,
          label: `${shortcut.shiftKey ? 'shift+' : ''}${shortcut.altKey ? 'alt+' : ''}${shortcut.key}`,
        })),
      ),
    )('keeps macOS shortcut $label out of Kitty mode $flags', async ({ flags, shortcut }) => {
      const { input, keyboard, output } = fixture
      if (flags) await output('\x1b[>7u')
      expect(keyboard.flags).toBe(flags)
      for (const type of ['keydown', 'keypress', 'keyup']) {
        const event = enterKey({
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
    })

    it.each([0, 7])('distinguishes macOS menu modifiers in Kitty mode %i', async (flags) => {
      const { input, keyboard, output } = fixture
      if (flags) await output('\x1b[>7u')
      expect(keyboard.flags).toBe(flags)
      expect(
        input.handleKeyEvent(enterKey({ key: 'w', shiftKey: false, metaKey: true, repeat: true })),
      ).toBe(false)
      for (const modifiers of [
        { metaKey: false, ctrlKey: true, shiftKey: false },
        { metaKey: true, ctrlKey: true, shiftKey: false },
        { metaKey: true, altKey: true, shiftKey: false },
        { metaKey: true, shiftKey: true },
      ])
        expect(input.handleKeyEvent(enterKey({ key: 'w', code: 'KeyW', ...modifiers }))).toBe(true)
      expect(
        input.handleKeyEvent(enterKey({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: false })),
      ).toBe(true)
    })

    it.each(['win32', 'linux'])('routes non-macOS shortcuts on %s', (platform) => {
      const { state, write } = fixture
      const other = createTerminalInputHandler({
        platform,
        canSend: () => state.running,
        write,
        getKittyFlags: () => 1,
        textarea: { value: '' },
      })
      try {
        expect(other.handleKeyEvent(enterKey({ key: 'w', shiftKey: false, metaKey: true }))).toBe(
          true,
        )
        expect(other.handleKeyEvent(enterKey({ key: 'w', shiftKey: false, ctrlKey: true }))).toBe(
          true,
        )
        expect(
          other.handleKeyEvent(
            enterKey({ key: 'd', code: 'KeyD', shiftKey: false, ctrlKey: true }),
          ),
        ).toBe(true)
        expect(other.handleKeyEvent(enterKey({ key: 'c', ctrlKey: true }))).toBe(
          platform !== 'win32',
        )
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const reopen = enterKey({ key: 'T', code: 'KeyT', ctrlKey: true, type })
          expect(other.handleKeyEvent(reopen)).toBe(false)
          expect(reopen.preventDefault).not.toHaveBeenCalled()
        }
        expect(other.handleKeyEvent(enterKey({ key: 't', ctrlKey: true, shiftKey: false }))).toBe(
          true,
        )
      } finally {
        other.dispose()
      }
    })

    it('sends modified Enter once without claiming other modifiers', () => {
      const { input, write } = fixture
      expect(input.handleKeyEvent(enterKey({ shiftKey: false }))).toBe(true)
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const)
        expect(input.handleKeyEvent(enterKey({ [modifier]: true }))).toBe(true)
      expect(input.handleKeyEvent(enterKey({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false)
      expect(write).not.toHaveBeenCalled()

      const shiftEnter = enterKey()
      expect(input.handleKeyEvent(shiftEnter)).toBe(false)
      expect(shiftEnter.preventDefault).toHaveBeenCalledOnce()
      expect(input.handleKeyEvent(enterKey({ type: 'keypress' }))).toBe(false)
      expect(input.handleKeyEvent(enterKey({ repeat: true }))).toBe(false)
      expect(input.handleKeyEvent(enterKey({ type: 'keyup', shiftKey: false }))).toBe(false)
      expect(write.mock.calls).toEqual([['\x1b\r']])
    })

    it('does not submit IME confirmation as Enter and resumes after composition', () => {
      const { input, write } = fixture
      input.compositionStart()
      const confirm = enterKey({ shiftKey: false, isComposing: true })
      expect(input.handleKeyEvent(confirm)).toBe(false)
      expect(confirm.preventDefault).not.toHaveBeenCalled()
      input.compositionEnd()
      expect(input.handleKeyEvent(enterKey({ type: 'keyup' }))).toBe(false)
      expect(input.handleKeyEvent(enterKey())).toBe(false)
      input.send('中文')
      vi.runAllTimers()
      expect(input.handleKeyEvent(enterKey({ repeat: true }))).toBe(false)
      input.handleKeyEvent(enterKey({ type: 'keyup' }))
      expect(input.handleKeyEvent(enterKey())).toBe(false)
      expect(write.mock.calls).toEqual([['中文'], ['\x1b\r']])

      input.reset()
      expect(input.handleKeyEvent(enterKey({ isComposing: true }))).toBe(false)
      input.reset()
      expect(input.handleKeyEvent(enterKey({ key: 'Process', keyCode: 229 }))).toBe(false)
    })

    it('ignores input while a session is inactive and clears pending timers on reset', () => {
      const { input, state, write } = fixture
      state.running = false
      input.send('late input')
      input.handleKeyEvent(enterKey())
      expect(write).not.toHaveBeenCalled()
      state.running = true
      input.compositionEnd()
      input.reset()
      expect(vi.getTimerCount()).toBe(0)
      input.send('resumed')
      expect(write.mock.calls).toEqual([['resumed']])
    })

    it('negotiates and resets Kitty flags across split output and terminal buffer changes', async () => {
      const { input, keyboard, output, replies, screen, write } = fixture
      const expectFlags = async (flags: number) => {
        await output('\x1b[?u')
        expect(replies.at(-1)).toBe(`\x1b[?${flags}u`)
        expect(keyboard.flags).toBe(flags)
      }
      await output('\x1b[>7')
      expect(keyboard.flags).toBe(0)
      await output('u')
      await expectFlags(7)
      expect(input.handleKeyEvent(enterKey({ shiftKey: false }))).toBe(true)
      const nativeShiftEnter = enterKey()
      expect(input.handleKeyEvent(nativeShiftEnter)).toBe(true)
      expect(nativeShiftEnter.preventDefault).not.toHaveBeenCalled()
      expect(input.handleKeyEvent(enterKey({ type: 'keypress' }))).toBe(true)
      expect(input.handleKeyEvent(enterKey({ repeat: true }))).toBe(true)
      expect(input.handleKeyEvent(enterKey({ type: 'keyup' }))).toBe(true)
      expect(write).not.toHaveBeenCalled()
      input.reset()
      expect(keyboard.flags).toBe(7)
      input.compositionStart()
      expect(input.handleKeyEvent(enterKey({ isComposing: true }))).toBe(false)
      input.compositionEnd()
      input.handleKeyEvent(enterKey({ type: 'keyup' }))
      vi.runAllTimers()
      await output('\x1b[=1;3u')
      await expectFlags(6)
      await output('\x1b[=1;2u\x1b[=0;4u')
      await expectFlags(7)
      await output('\x1b[>3u\x1b[<u')
      await expectFlags(7)
      await output('\x1b[<u')
      await expectFlags(0)
      input.handleKeyEvent(enterKey())
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
      expect(input.handleKeyEvent(enterKey())).toBe(false)
      expect(write).toHaveBeenCalledOnce()
    })
  })

  describe('native text commits', () => {
    let fixture: ReturnType<typeof createNativeFixture>
    let cleanup: (() => void) | undefined

    beforeEach(() => {
      vi.useFakeTimers()
      cleanup = undefined
      fixture = createNativeFixture()
      cleanup = () => fixture.input.dispose()
    })
    afterEach(() => {
      try {
        cleanup?.()
      } finally {
        vi.useRealTimers()
      }
    })

    it.each(
      ['', '上次提交'].flatMap((initial) =>
        [false, true].flatMap((process) =>
          [false, true].map((delayed) => ({
            initial,
            process,
            delayed,
            label: `${initial ? 'previous text' : 'empty'}, process=${process}, delayed=${delayed}`,
          })),
        ),
      ),
    )('claims a native text commit: $label', ({ initial, process, delayed }) => {
      const { input, textarea, commit, output } = fixture
      textarea.value = initial
      const event = periodKey(process ? { key: 'Process', keyCode: 229 } : {})
      expect(input.handleKeyEvent(event)).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(textarea.value).toBe('')
      expect(input.handleKeyEvent(periodKey({ ...event, type: 'keypress' }))).toBe(false)
      if (delayed) {
        vi.runAllTimers()
        expect(input.handleKeyEvent(periodKey({ ...event, type: 'keyup' }))).toBe(false)
      }
      expect(commit('。').stopImmediatePropagation).toHaveBeenCalledOnce()
      if (!delayed) input.handleKeyEvent(periodKey({ ...event, type: 'keyup' }))
      expect(textarea.value).toBe('')
      expect(output()).toBe('。')
    })

    it('keeps successive native commits independent across process keys and delayed releases', () => {
      const { input, textarea, commit, output } = fixture
      for (const initial of ['', '上次提交']) {
        textarea.value = initial
        for (const process of [false, true]) {
          for (const delayed of [false, true]) {
            const event = periodKey(process ? { key: 'Process', keyCode: 229 } : {})
            input.handleKeyEvent(event)
            input.handleKeyEvent(periodKey({ ...event, type: 'keypress' }))
            if (delayed) {
              vi.runAllTimers()
              input.handleKeyEvent(periodKey({ ...event, type: 'keyup' }))
            }
            commit('。')
            if (!delayed) input.handleKeyEvent(periodKey({ ...event, type: 'keyup' }))
          }
        }
      }
      expect(output()).toBe('。'.repeat(8))
    })

    it('preserves composition order before a deferred native text commit', () => {
      const { input, textarea, commit, output } = fixture
      input.handleKeyEvent(periodKey({ key: 'n', code: 'KeyN', keyCode: 78 }))
      input.compositionStart()
      expect(commit('ni', { isComposing: true }).stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      setTimeout(() => input.send(textarea.value), 0)
      input.compositionEnd()
      expect(commit('你').stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      input.handleKeyEvent(periodKey({ key: 'Process', keyCode: 229 }))
      commit('。')
      input.handleKeyEvent(periodKey({ type: 'keyup' }))
      expect(output()).toBe('')
      expect(textarea.value).toBe('你')
      vi.runAllTimers()
      expect(output()).toBe('你。')
    })

    it('flushes composed text before the following control byte', () => {
      const { input, textarea, commit, output } = fixture
      input.compositionStart()
      textarea.value = '好'
      input.compositionEnd()
      input.handleKeyEvent(periodKey())
      commit('。')
      const control = periodKey({ key: 'c', code: 'KeyC', ctrlKey: true })
      expect(input.handleKeyEvent(control)).toBe(true)
      input.send('好')
      input.flushText()
      input.send('\x03')
      vi.runAllTimers()
      expect(output()).toBe('好。\x03')
      input.reset()
    })

    it.each([0, 1, 2, 4, 7, 8, 10, 16, 24, 31])(
      'encodes native text and releases with Kitty flags %i',
      (flags) => {
        const { input, state, commit, output } = fixture
        state.flags = flags
        input.handleKeyEvent(periodKey())
        commit('。')
        input.handleKeyEvent(periodKey({ type: 'keyup' }))
        const press = flags & 8 ? (flags & 16 ? '\x1b[46;;12290u' : '\x1b[46u') : '。'
        expect(output()).toBe(press + (flags & 2 ? '\x1b[46;1:3u' : ''))
      },
    )

    it('keeps successive native commits independent when Kitty flags change', () => {
      const { input, state, write, commit, output } = fixture
      const flags = [0, 1, 2, 4, 7, 8, 10, 16, 24, 31]
      const outputs: string[] = []
      for (const value of flags) {
        state.flags = value
        write.mockClear()
        input.handleKeyEvent(periodKey())
        commit('。')
        input.handleKeyEvent(periodKey({ type: 'keyup' }))
        outputs.push(output())
      }
      expect(outputs).toEqual(
        flags.map((value) => {
          const press = value & 8 ? (value & 16 ? '\x1b[46;;12290u' : '\x1b[46u') : '。'
          return press + (value & 2 ? '\x1b[46;1:3u' : '')
        }),
      )
    })

    it('keeps a Kitty release that arrives before the native commit', () => {
      const { input, state, commit, output } = fixture
      state.flags = 7
      input.handleKeyEvent(periodKey({ key: '?', code: 'Slash', shiftKey: true }))
      input.handleKeyEvent(periodKey({ key: '/', code: 'Slash', type: 'keyup' }))
      commit('？')
      expect(output()).toBe('？\x1b[47;1:3u')
    })

    it('does not leak a Kitty release after the CLI resets its flags', () => {
      const { input, state, commit, output } = fixture
      state.flags = 7
      input.handleKeyEvent(periodKey())
      commit('。')
      state.flags = 0
      input.handleKeyEvent(periodKey({ type: 'keyup' }))
      expect(output()).toBe('。')
    })

    it('handles repeated native text and emoji commits', () => {
      const { input, commit, output } = fixture
      const letter = periodKey({ key: 'a', code: 'KeyA' })
      input.handleKeyEvent(letter)
      commit('a')
      input.handleKeyEvent(periodKey({ ...letter, repeat: true }))
      commit('a')
      input.handleKeyEvent(periodKey({ ...letter, type: 'keyup' }))
      input.handleKeyEvent(periodKey({ key: 'Process', keyCode: 229 }))
      commit('🙂')
      expect(output()).toBe('aa🙂')
    })

    it('leaves dead keys native and cancels pending commits on blur or inactivity', () => {
      const { input, state, write, commit } = fixture
      expect(input.handleKeyEvent(periodKey({ key: 'Dead', code: 'Quote' }))).toBe(true)
      expect(input.handleKeyEvent(periodKey({ key: 'e', code: 'KeyE' }))).toBe(true)
      expect(commit('é').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(periodKey())
      input.reset()
      expect(commit('。').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(periodKey())
      state.running = false
      commit('。')
      state.running = true
      state.flags = 7
      input.handleKeyEvent(periodKey({ type: 'keyup' }))
      expect(write).not.toHaveBeenCalled()
    })

    it('discards pending native text and timers when disposed', () => {
      const { input, state, textarea, write, commit } = fixture
      state.flags = 7
      input.compositionStart()
      textarea.value = '再'
      input.compositionEnd()
      input.handleKeyEvent(periodKey())
      commit('。')
      input.dispose()
      vi.runAllTimers()
      input.send('late')
      expect(write).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
