import { agentLaunch, attach, mocks, options, settings } from './terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Terminal } from '@xterm/headless'
import { createTerminalKeyboardState } from '../../../src/shared/terminal-keyboard-state'
import type { TerminalEvent } from '../../../src/shared/contracts'
import { TerminalManager } from '../../../src/main/terminal/manager'

describe('Terminal output and attachments', () => {
  it('batches output, pauses at high water, and resumes only after rendering acknowledgements', async () => {
    const events: TerminalEvent[] = []
    const manager = new TerminalManager((event) => events.push(event))
    const entry = options()
    await manager.create(entry, settings)
    const { attachmentId } = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(12)
    expect(events).toHaveLength(1)
    expect(process.pause).toHaveBeenCalled()
    await vi.runAllTimersAsync()
    const resumes = process.resume.mock.calls.length
    manager.acknowledge(entry.id, attachmentId, 999999)
    expect(process.resume).toHaveBeenCalledTimes(resumes)
    manager.acknowledge(entry.id, attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(resumes + 1)
  })

  it('reports exit code, flushes pending output and rejects later input', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = { ...options(), ...agentLaunch() }
    await manager.create(entry, settings)
    const { attachmentId } = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('last output')
    process.listeners.exit({ exitCode: 7 })
    await vi.runAllTimersAsync()
    expect(send.mock.calls.map(([event]) => event.type)).toEqual(['data', 'exit'])
    expect(send).toHaveBeenLastCalledWith({
      type: 'exit',
      id: entry.id,
      attachmentId,
      exitCode: 7,
      signal: undefined,
    })
    expect(() => manager.write(entry.id, 'no')).toThrow('已退出')
    expect(manager.hasLive()).toBe(false)
    const restored = await attach(manager, entry)
    expect(restored.snapshot).toContain('last output')
    expect(restored.agent).toMatchObject({
      launchId: entry.launchId,
      runtimeState: 'exited',
      exitCode: 7,
      activityState: 'unknown',
    })
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
  })

  it('keeps output and releases renderer backpressure while detached; ignores stale detach and ACK', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings)
    const first = await attach(manager, entry)
    expect(first.snapshot.endsWith('\x1b[=0u')).toBe(true)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    await vi.runAllTimersAsync()
    manager.detach(entry.id, first.attachmentId)
    const resumes = process.resume.mock.calls.length
    process.listeners.data('\r\nWHILE_DETACHED\r\n\x1b[>1u\x1b[>3u\x1b[?1049h\x1b[>7')
    process.listeners.data('u\x1b[>15u\x1b[HALT CONTENT')
    await vi.runAllTimersAsync()
    const second = await attach(manager, entry)
    expect(second.snapshot).toContain('WHILE_DETACHED')
    expect(second.snapshot.endsWith('\x1b[=15u')).toBe(true)
    const restored = new Terminal({
      cols: entry.cols,
      rows: entry.rows,
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
    })
    const keyboard = createTerminalKeyboardState(restored.parser)
    const replies: string[] = []
    restored.onData((data) => replies.push(data))
    const parse = async (data: string) => {
      const parsed = new Promise<void>((resolve) => restored.write(data, resolve))
      await vi.runAllTimersAsync()
      await parsed
    }
    const expectFlags = async (flags: number) => {
      await parse('\x1b[?u')
      expect(replies.at(-1)).toBe(`\x1b[?${flags}u`)
      expect(keyboard.flags).toBe(flags)
    }
    try {
      await parse(second.snapshot)
      expect(restored.buffer.active.type).toBe('alternate')
      expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe('ALT CONTENT')
      await expectFlags(15)
      await parse('\x1b[<u')
      await expectFlags(7)
      await parse('\x1b[<u')
      await expectFlags(0)
      await parse('\x1b[?1049l')
      expect(restored.buffer.active.type).toBe('normal')
      await expectFlags(3)
      await parse('\x1b[<u')
      await expectFlags(1)
      await parse('\x1b[<u')
      await expectFlags(0)
    } finally {
      keyboard.dispose()
      restored.dispose()
    }
    manager.detach(entry.id, first.attachmentId)
    process.listeners.data('y'.repeat(150000))
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ attachmentId: second.attachmentId }),
    )
    const currentResumes = process.resume.mock.calls.length
    manager.acknowledge(entry.id, first.attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(currentResumes)
    manager.acknowledge(entry.id, second.attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(currentResumes + 1)
    expect(resumes).toBeGreaterThan(0)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    process.listeners.data('\x1b[<2u\x1b[?1049l\x1b[<2u')
    const third = await attach(manager, entry)
    expect(third.snapshot.endsWith('\x1b[=0u')).toBe(true)
    await manager.close(entry.id)
  })

  it('delivers output queued after the snapshot barrier exactly once, while earlier output stays in the snapshot', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('BEFORE_BARRIER\r\n')
    const attaching = manager.attach({ ...entry, attachmentId: randomUUID() })
    await Promise.resolve()
    process.listeners.data('AFTER_BARRIER\r\n')
    await vi.runAllTimersAsync()
    const restored = await attaching
    expect(restored.snapshot).toContain('BEFORE_BARRIER')
    expect(restored.snapshot).not.toContain('AFTER_BARRIER')
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'data', data: 'AFTER_BARRIER\r\n' }),
    )
    await manager.close(entry.id)
  })

  it('answers terminal status queries while detached, leaving attached renderer responses unduplicated', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('\x1b[6n')
    await vi.runAllTimersAsync()
    expect(process.write).toHaveBeenCalledExactlyOnceWith('\x1b[1;1R')
    await attach(manager, entry)
    process.listeners.data('\x1b[6n')
    await vi.runAllTimersAsync()
    expect(process.write).toHaveBeenCalledOnce()
    await manager.close(entry.id)
  })

  it('attaches to exited sessions with their final screen and never respawns a missing session', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await expect(manager.attach({ ...entry, attachmentId: randomUUID() })).rejects.toThrow('不存在')
    expect(mocks.spawn).not.toHaveBeenCalled()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('\x1b[?1049h\x1b[2J\x1b[4;9H中文 TUI')
    process.listeners.exit({ exitCode: 7 })
    const result = await attach(manager, entry)
    expect(result).toMatchObject({ exited: true, exitCode: 7, cols: 80, rows: 24 })
    expect(result.snapshot).toContain('中文 TUI')
    expect(result.snapshot).toContain('\x1b[?1049h')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await manager.close(entry.id)
  })

  it('applies scrollback changes to Host snapshots and validates the limit before discarding history', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data(Array.from({ length: 1200 }, (_, index) => `LINE_${index}\r\n`).join(''))
    await vi.runAllTimersAsync()
    expect((await attach(manager, entry)).snapshot).toContain('LINE_0\r\n')
    expect(() => manager.setScrollback(1)).toThrow()
    manager.setScrollback(1000)
    const restored = await attach(manager, entry)
    expect(restored.snapshot).not.toContain('LINE_0\r\n')
    expect(restored.snapshot).toContain('LINE_1199')
    await manager.close(entry.id)
  })
})
