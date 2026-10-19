import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, type TerminalEvent } from '../src/shared/contracts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  stop: vi.fn(),
  busy: vi.fn(),
  directory: vi.fn(),
  shell: vi.fn(),
}))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../src/main/process-tree', () => ({
  stopProcessTree: mocks.stop,
  hasRunningJob: mocks.busy,
}))
vi.mock('../src/main/validation', async (original) => ({
  ...(await original<object>()),
  projectDirectory: mocks.directory,
}))
vi.mock('../src/main/shell', () => ({
  resolveShell: mocks.shell,
  shellEnvironment: () => ({ TERM: 'xterm-256color' }),
}))
import { TerminalManager } from '../src/main/terminals'

function child() {
  const listeners = {
    data: (_data: string) => {},
    exit: (_event: { exitCode: number; signal?: number }) => {},
  }
  const dispose = vi.fn()
  return {
    pid: 98765,
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose,
    onData: vi.fn((callback) => {
      listeners.data = callback
      return { dispose }
    }),
    onExit: vi.fn((callback) => {
      listeners.exit = callback
      return { dispose }
    }),
    listeners,
  }
}
const settings = structuredClone(DEFAULT_CONFIG.preferences)
const options = () => ({
  id: randomUUID(),
  projectPath: '/tmp/project',
  cwd: '/tmp/project',
  workspaceKind: 'local' as const,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  cols: 80,
  rows: 24,
})
async function attach(
  manager: TerminalManager,
  entry: ReturnType<typeof options>,
  attachmentId = randomUUID(),
) {
  const promise = manager.attach({ ...entry, attachmentId })
  await vi.runAllTimersAsync()
  return { ...(await promise), attachmentId }
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.spawn.mockImplementation(child)
  mocks.directory.mockImplementation(async (path: string) => path)
  mocks.shell.mockResolvedValue('/bin/zsh')
  mocks.stop.mockResolvedValue(undefined)
  mocks.busy.mockResolvedValue(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('single PTY owner', () => {
  it('spawns an interactive login shell at the validated cwd', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-il'],
      expect.objectContaining({ cwd: '/tmp/project', cols: 80, rows: 24 }),
    )
    manager.write(entry.id, '中文\r')
    manager.resize(entry.id, 100, 30)
    expect(mocks.spawn.mock.results[0].value.write).toHaveBeenCalledWith('中文\r')
    expect(mocks.spawn.mock.results[0].value.resize).toHaveBeenCalledWith(100, 30)
  })
  it('skips confirmation only for idle shells and falls back to confirmation when inspection fails', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    expect(mocks.busy).toHaveBeenCalledWith(98765, '/bin/zsh')
    mocks.busy.mockResolvedValueOnce(true)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    mocks.busy.mockRejectedValueOnce(new Error('ps failed'))
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    const process = mocks.spawn.mock.results[0].value
    mocks.busy.mockImplementationOnce(async () => {
      process.listeners.exit({ exitCode: 0 })
      return true
    })
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    mocks.busy.mockClear()
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    expect(await manager.needsCloseConfirmation(randomUUID())).toBe(false)
    expect(mocks.busy).not.toHaveBeenCalled()
    await manager.close(entry.id)
  })
  it('does not advertise in-flight creates as recoverable sessions when creation fails', async () => {
    const manager = new TerminalManager(vi.fn())
    let fail!: (error: Error) => void
    mocks.directory.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    const creating = manager.create(options(), settings)
    await Promise.resolve()
    const rejected = expect(creating).rejects.toThrow('missing')
    const listing = manager.list()
    fail(new Error('missing'))
    await rejected
    expect(await listing).toEqual([])
  })
  it('reserves slots before async validation, enforcing the limit on concurrent creates', async () => {
    const manager = new TerminalManager(vi.fn())
    await Promise.all(Array.from({ length: 10 }, () => manager.create(options(), settings)))
    await expect(manager.create(options(), settings)).rejects.toThrow('10')
    expect(mocks.spawn).toHaveBeenCalledTimes(10)
  })
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
    const entry = options()
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
  })
  it('retries a concurrent create with the same ID without spawning twice, rejecting a different owner', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await Promise.all([manager.create(entry, settings), manager.create(entry, settings)])
    await expect(manager.create({ ...entry, workspaceId: randomUUID() }, settings)).rejects.toThrow(
      '占用',
    )
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
  it('keeps output and releases renderer backpressure while detached; ignores stale detach and ACK', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings)
    const first = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    await vi.runAllTimersAsync()
    manager.detach(entry.id, first.attachmentId)
    const resumes = process.resume.mock.calls.length
    process.listeners.data('\r\nWHILE_DETACHED\r\n')
    await vi.runAllTimersAsync()
    const second = await attach(manager, entry)
    expect(second.snapshot).toContain('WHILE_DETACHED')
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
  it('closes only the requested process tree and unsubscribes', async () => {
    const manager = new TerminalManager(vi.fn())
    const a = options(),
      b = options()
    await manager.create(a, settings)
    await manager.create(b, settings)
    const closing = manager.close(a.id)
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.spawn.mock.results[0].value.resize).not.toHaveBeenCalled()
    await closing
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.spawn.mock.results[0].value.dispose).toHaveBeenCalledTimes(2)
    expect(manager.isLive(b.id)).toBe(true)
  })
  it('waits for in-flight creation and closes only the removed workspace', async () => {
    const manager = new TerminalManager(vi.fn())
    const other = {
      ...options(),
      projectPath: '/tmp/other',
      cwd: '/tmp/other',
      workspaceId: '22222222-2222-4222-8222-222222222222',
    }
    await manager.create(other, settings)
    const sibling = { ...options(), workspaceId: randomUUID() }
    await manager.create(sibling, settings)
    const entry = options()
    let finish!: (path: string) => void
    mocks.directory.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const creating = manager.create(entry, settings)
    const closing = manager.closeWorkspace(entry)
    expect(mocks.stop).not.toHaveBeenCalled()
    await Promise.resolve()
    finish('/tmp/project')
    await creating
    await closing
    expect(manager.isLive(entry.id)).toBe(false)
    expect(manager.isLive(other.id)).toBe(true)
    expect(manager.isLive(sibling.id)).toBe(true)
    expect(mocks.stop).toHaveBeenCalledOnce()
  })
  it('closes every workspace in a project while preserving other projects', async () => {
    const manager = new TerminalManager(vi.fn())
    const first = options()
    const second = { ...options(), workspaceId: randomUUID() }
    const other = { ...options(), projectPath: '/tmp/other', cwd: '/tmp/other' }
    await manager.create(first, settings)
    await manager.create(second, settings)
    await manager.create(other, settings)
    await manager.closeProject('/tmp/project')
    expect(manager.isLive(first.id)).toBe(false)
    expect(manager.isLive(second.id)).toBe(false)
    expect(manager.isLive(other.id)).toBe(true)
    expect(mocks.stop).toHaveBeenCalledTimes(2)
  })
  it('preserves sessions after workspace cleanup fails so removal can be retried', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.closeWorkspace(entry)).rejects.toThrow('permission denied')
    expect(manager.isLive(entry.id)).toBe(true)
    await manager.closeWorkspace(entry)
    expect(manager.isLive(entry.id)).toBe(false)
  })
  it('frees a failed creation slot and exposes invalid-directory errors', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    mocks.directory.mockRejectedValueOnce(new Error('项目目录不可访问'))
    await expect(manager.create(entry, settings)).rejects.toThrow('不可访问')
    await manager.create(entry, settings)
    expect(manager.isLive(entry.id)).toBe(true)
  })
  it('prevents new spawns while shutting down an in-flight creation', async () => {
    const manager = new TerminalManager(vi.fn())
    const creation = manager.create(options(), settings)
    const shutdown = manager.shutdown()
    await expect(creation).rejects.toThrow('正在退出')
    await shutdown
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('does not silently discard a session when process cleanup fails', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.shutdown()).rejects.toThrow('permission denied')
    expect(manager.hasLive()).toBe(true)
    await manager.close(entry.id)
  })
})
