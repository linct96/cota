import { agentLaunch, mocks, options, settings } from './terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import { MAX_TERMINALS } from '../../../src/shared/contracts'
import { TerminalManager } from '../../../src/main/terminal/manager'

describe('Terminal creation and cleanup', () => {
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
    mocks.busy.mockImplementationOnce(() => {
      try {
        process.listeners.exit({ exitCode: 0 })
        return Promise.resolve(true)
      } catch (cause) {
        return Promise.reject(cause)
      }
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
    await Promise.all(
      Array.from({ length: MAX_TERMINALS }, (_, index) =>
        manager.create(index % 2 ? { ...options(), ...agentLaunch() } : options(), settings),
      ),
    )
    await expect(manager.create(options(), settings)).rejects.toThrow(
      `最多保留 ${MAX_TERMINALS} 个终端`,
    )
    expect(mocks.spawn).toHaveBeenCalledTimes(MAX_TERMINALS)
  })

  it('retries a concurrent create with the same ID without spawning twice, rejecting a different owner', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = { ...options(), ...agentLaunch(), provider: 'claude' as const }
    await Promise.all([manager.create(entry, settings), manager.create(entry, settings)])
    await expect(manager.create({ ...entry, workspaceId: randomUUID() }, settings)).rejects.toThrow(
      '占用',
    )
    await expect(manager.create({ ...entry, launchId: randomUUID() }, settings)).rejects.toThrow(
      '占用',
    )
    await expect(manager.create({ ...entry, provider: 'pi' }, settings)).rejects.toThrow('占用')
    await expect(manager.create({ ...options(), id: entry.id }, settings)).rejects.toThrow('占用')
    for (const provider of ['__proto__', 'sh', 'codex; touch nope']) {
      expect(() => manager.create({ ...entry, provider: provider as never }, settings)).toThrow(
        '不支持',
      )
    }
    expect(() => manager.create({ ...entry, launchId: 'invalid' }, settings)).toThrow('标识无效')
    expect(mocks.spawn).toHaveBeenCalledOnce()
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
    const entry = { ...options(), ...agentLaunch() }
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
    const updates = vi.fn()
    const manager = new TerminalManager(vi.fn(), updates)
    const entry = { ...options(), ...agentLaunch() }
    await manager.create(entry, settings)
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.shutdown()).rejects.toThrow('permission denied')
    expect(manager.hasLive()).toBe(true)
    expect((await manager.list())[0].agent).toMatchObject({
      runtimeState: 'running',
      launchId: entry.launchId,
      activityState: 'unknown',
      observability: 'unavailable',
      observabilityReason: expect.stringContaining('关闭失败'),
    })
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ runtimeState: 'running' }),
      }),
    )
    manager.write(entry.id, 'save before retry\r')
    manager.resize(entry.id, 100, 30)
    expect(mocks.spawn.mock.results[0].value.write).toHaveBeenCalledWith('save before retry\r')
    expect(mocks.spawn.mock.results[0].value.resize).toHaveBeenCalledWith(100, 30)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    await manager.close(entry.id)
    const exiting = { ...options(), ...agentLaunch() }
    await manager.create(exiting, settings)
    mocks.stop.mockImplementationOnce(() => {
      try {
        mocks.spawn.mock.results[1].value.listeners.exit({ exitCode: 9 })
        throw new Error('descendant cleanup failed')
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    await expect(manager.close(exiting.id)).rejects.toThrow('descendant cleanup failed')
    expect((await manager.list())[0].agent).toMatchObject({ runtimeState: 'exited', exitCode: 9 })
    expect(() => manager.write(exiting.id, 'no')).toThrow('已退出')
    await manager.close(exiting.id)
  })
  it('spawns a validated login shell and an explicit Agent without parsing their output', async () => {
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
    const agent = { ...options(), ...agentLaunch(), provider: 'pi' as const }
    await manager.create(agent, settings)
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/usr/local/bin/pi',
      [],
      expect.objectContaining({ cwd: entry.cwd }),
    )
    expect(await manager.needsCloseConfirmation(agent.id)).toBe(true)
    mocks.spawn.mock.results[1].value.listeners.data('Completed! Waiting for input...')
    await vi.runAllTimersAsync()
    expect((await manager.list())[1]).toMatchObject({
      kind: 'agent',
      provider: 'pi',
      agent: {
        terminalId: agent.id,
        launchId: agent.launchId,
        runtimeState: 'running',
        activityState: 'unknown',
        observability: 'unavailable',
      },
    })
    await manager.shutdown()
  })
})
