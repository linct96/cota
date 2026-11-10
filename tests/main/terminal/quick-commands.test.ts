import { agentLaunch, mocks, options, settings } from './terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import { TerminalManager } from '../../../src/main/terminal/manager'

describe('Terminal quick command startup', () => {
  it('prepares quick command startup once, gates Fish input and rejects unsafe launches', async () => {
    vi.useRealTimers()
    mocks.processes.mockResolvedValue([])
    const manager = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const entry = { ...options(), startupCommand: 'printf hello\npwd' }
    mocks.prepareShell.mockResolvedValueOnce(['--rcfile', '/tmp/cota-test/rcfile', '-i'])
    await manager.create(entry, settings)
    expect(mocks.prepareShell).toHaveBeenLastCalledWith(
      '/bin/zsh',
      expect.any(Object),
      '/tmp/cota-test',
      entry.startupCommand,
    )
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/bin/zsh',
      ['--rcfile', '/tmp/cota-test/rcfile', '-i'],
      expect.objectContaining({ cwd: entry.cwd }),
    )
    await manager.create(entry, settings)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.prepareShell).toHaveBeenCalledOnce()
    expect(() => manager.create({ ...options(), startupCommand: '\u001b[31m' }, settings)).toThrow(
      '控制字符',
    )
    await expect(
      manager.create({ ...options(), ...agentLaunch(), startupCommand: 'echo nope' }, settings),
    ).rejects.toThrow('只能在新建 Shell')
    mocks.prepareShell.mockRejectedValueOnce(new Error('shell setup failed'))
    await expect(
      manager.create({ ...options(), startupCommand: 'echo nope' }, settings),
    ).rejects.toThrow('shell setup failed')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect((await manager.list()).map((session) => session.id)).toEqual([entry.id])
    try {
      mocks.shell.mockResolvedValue('/bin/fish')
      const fishEntry = { ...options(), startupCommand: 'printf 中文\npwd\n' }
      await manager.create(fishEntry, settings)
      const terminal = mocks.spawn.mock.results.at(-1)!.value
      const token = mocks.spawn.mock.calls.at(-1)![2].env.COTA_SHELL_ACTIVITY
      const marker = (value = token, pid = terminal.pid) =>
        `\u001b]133;A;Cota=${value};Shell=${pid}\u0007`
      const drain = () => manager.attach({ ...fishEntry, attachmentId: randomUUID() })
      const settle = () => new Promise((resolve) => setTimeout(resolve, 45))
      terminal.listeners.data(marker('0'.repeat(64)) + marker(token, terminal.pid + 1))
      await drain()
      await settle()
      expect(terminal.write).not.toHaveBeenCalled()
      const ready = marker()
      terminal.listeners.data(ready.slice(0, 18))
      await drain()
      terminal.listeners.data(ready.slice(18))
      await drain()
      await settle()
      expect(terminal.write).not.toHaveBeenCalled()
      terminal.listeners.data('\x1b[?2004h')
      await drain()
      expect(terminal.write).not.toHaveBeenCalled()
      await settle()
      expect(terminal.write).toHaveBeenCalledExactlyOnceWith('\x1b[200~printf 中文\npwd\x1b[201~\r')
      await manager.create(fishEntry, settings)
      terminal.listeners.data(ready)
      await drain()
      await settle()
      expect(terminal.write).toHaveBeenCalledOnce()

      for (const ending of ['close', 'exit']) {
        const pending = { ...options(), startupCommand: 'echo never' }
        await manager.create(pending, settings)
        const child = mocks.spawn.mock.results.at(-1)!.value
        const startupToken = mocks.spawn.mock.calls.at(-1)![2].env.COTA_SHELL_ACTIVITY
        child.listeners.data(
          `\u001b]133;A;Cota=${startupToken};Shell=${child.pid}\u0007\x1b[?2004h`,
        )
        await manager.attach({ ...pending, attachmentId: randomUUID() })
        if (ending === 'close') await manager.close(pending.id)
        else child.listeners.exit({ exitCode: 0 })
        await settle()
        expect(child.write, ending).not.toHaveBeenCalled()
      }
    } finally {
      await manager.shutdown()
    }
  })
})
