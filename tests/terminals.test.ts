import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { TerminalEvent } from '../src/shared/contracts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  stop: vi.fn(),
  directory: vi.fn(),
  shell: vi.fn(),
}))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../src/main/process-tree', () => ({ stopProcessTree: mocks.stop }))
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
const settings = { shellPath: null, scrollback: 5000 }
const options = () => ({ id: randomUUID(), projectPath: '/tmp/project', cols: 80, rows: 24 })
beforeEach(() => {
  vi.useFakeTimers()
  mocks.spawn.mockImplementation(child)
  mocks.directory.mockResolvedValue('/tmp/project')
  mocks.shell.mockResolvedValue('/bin/zsh')
  mocks.stop.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('single PTY owner', () => {
  it('spawns an interactive login shell at the validated cwd', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings, ['/tmp/project'])
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
  it('reserves slots before async validation, enforcing the limit on concurrent creates', async () => {
    const manager = new TerminalManager(vi.fn())
    await Promise.all(
      Array.from({ length: 10 }, () => manager.create(options(), settings, ['/tmp/project'])),
    )
    await expect(manager.create(options(), settings, ['/tmp/project'])).rejects.toThrow('10')
    expect(mocks.spawn).toHaveBeenCalledTimes(10)
  })
  it('batches output, pauses at high water, and resumes only after rendering acknowledgements', async () => {
    const events: TerminalEvent[] = []
    const manager = new TerminalManager((event) => events.push(event))
    const entry = options()
    await manager.create(entry, settings, ['/tmp/project'])
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(12)
    expect(events).toHaveLength(1)
    expect(process.pause).toHaveBeenCalledOnce()
    manager.acknowledge(entry.id, 999999)
    expect(process.resume).not.toHaveBeenCalled()
    manager.acknowledge(entry.id, 150000)
    expect(process.resume).toHaveBeenCalledOnce()
  })
  it('reports exit code, flushes pending output and rejects later input', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings, ['/tmp/project'])
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('last output')
    process.listeners.exit({ exitCode: 7 })
    expect(send.mock.calls.map(([event]) => event.type)).toEqual(['data', 'exit'])
    expect(send).toHaveBeenLastCalledWith({
      type: 'exit',
      id: entry.id,
      exitCode: 7,
      signal: undefined,
    })
    expect(() => manager.write(entry.id, 'no')).toThrow('已退出')
    expect(manager.hasLive()).toBe(false)
  })
  it('closes only the requested process tree and unsubscribes', async () => {
    const manager = new TerminalManager(vi.fn())
    const a = options(),
      b = options()
    await manager.create(a, settings, ['/tmp/project'])
    await manager.create(b, settings, ['/tmp/project'])
    const closing = manager.close(a.id)
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.spawn.mock.results[0].value.resize).not.toHaveBeenCalled()
    await closing
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.spawn.mock.results[0].value.dispose).toHaveBeenCalledTimes(2)
    expect(manager.isLive(b.id)).toBe(true)
  })
  it('waits for in-flight creation and closes only the removed project', async () => {
    const manager = new TerminalManager(vi.fn())
    const other = { ...options(), projectPath: '/tmp/other' }
    await manager.create(other, settings, ['/tmp/other'])
    const entry = options()
    let finish!: (path: string) => void
    mocks.directory.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const creating = manager.create(entry, settings, ['/tmp/project'])
    const closing = manager.closeProject('/tmp/project')
    expect(mocks.stop).not.toHaveBeenCalled()
    finish('/tmp/project')
    await creating
    await closing
    expect(manager.isLive(entry.id)).toBe(false)
    expect(manager.isLive(other.id)).toBe(true)
    expect(mocks.stop).toHaveBeenCalledOnce()
  })
  it('preserves sessions after project cleanup fails so removal can be retried', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings, ['/tmp/project'])
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.closeProject('/tmp/project')).rejects.toThrow('permission denied')
    expect(manager.isLive(entry.id)).toBe(true)
    await manager.closeProject('/tmp/project')
    expect(manager.isLive(entry.id)).toBe(false)
  })
  it('frees a failed creation slot and exposes invalid-directory errors', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    mocks.directory.mockRejectedValueOnce(new Error('项目目录不可访问'))
    await expect(manager.create(entry, settings, ['/tmp/project'])).rejects.toThrow('不可访问')
    await manager.create(entry, settings, ['/tmp/project'])
    expect(manager.isLive(entry.id)).toBe(true)
  })
  it('prevents new spawns while shutting down an in-flight creation', async () => {
    const manager = new TerminalManager(vi.fn())
    const creation = manager.create(options(), settings, ['/tmp/project'])
    const shutdown = manager.shutdown()
    await expect(creation).rejects.toThrow('正在退出')
    await shutdown
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('does not silently discard a session when process cleanup fails', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings, ['/tmp/project'])
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.shutdown()).rejects.toThrow('permission denied')
    expect(manager.hasLive()).toBe(true)
    await manager.close(entry.id)
  })
})
