import { mocks, options, settings } from '../terminal/terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TerminalManager } from '../../../src/main/terminal/manager'

import { backgroundRows, rows } from './agent-process.fixture'

describe('Managed Agent event authentication', () => {
  it('authenticates managed events against the foreground process and isolates repeated launches', async () => {
    const managedUpdates = vi.fn()
    const dynamic = new TerminalManager(vi.fn(), managedUpdates, '/tmp/cota-test/agent.sock')
    const shell = options()
    mocks.shell.mockResolvedValueOnce('/usr/local/bin/fish')
    mocks.prepareShell.mockResolvedValueOnce(['-il', '-C', 'codex-wrapper'])
    await dynamic.create(shell, settings)
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/usr/local/bin/fish',
      ['-il', '-C', 'codex-wrapper'],
      expect.any(Object),
    )
    const env = mocks.spawn.mock.calls.at(-1)![2].env
    expect(env).toMatchObject({ COTA_AGENT_MANAGED: '1', COTA_AGENT_TERMINAL: shell.id })
    mocks.processes.mockResolvedValue(backgroundRows)
    const manual = {
      managed: true,
      terminalId: shell.id,
      token: env.COTA_AGENT_TOKEN,
      provider: 'pi',
      processId: 60001,
      sessionId: 'native-session',
      type: 'session-started',
      eventId: randomUUID(),
      timestamp: Date.now(),
    }
    const manualChannel = {}
    expect(dynamic.authenticManagedEvent({ ...manual, token: '0'.repeat(64) })).toBe(false)
    expect(
      await dynamic.receiveAgentEvent({ ...manual, token: '0'.repeat(64) }, manualChannel),
    ).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, processId: 1 }, manualChannel)).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, prompt: 'secret' }, manualChannel)).toBe(
      false,
    )
    expect((await dynamic.list())[0].agent).toBeUndefined()
    expect(
      await dynamic.receiveAgentEvent({ ...manual, provider: 'claude', processId: 60002 }, {}),
    ).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, processId: 60003 }, {})).toBe(false)
    expect((await dynamic.list())[0].agent).toBeUndefined()
    const manualRows = rows.map((row) =>
      row.pid === 60000 ? { ...row, command: '/usr/bin/node', provider: 'pi' as const } : row,
    )
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, manualChannel)).toBe(true)
    const firstRun = (await dynamic.list())[0].agent!
    expect(firstRun).toMatchObject({ provider: 'pi', activityState: 'idle', observability: 'full' })
    expect((await dynamic.list())[0].kind).toBeUndefined()
    expect(await dynamic.receiveAgentEvent({ ...manual, provider: 'codex' }, {})).toBe(false)
    const working = {
      ...manual,
      type: 'turn-started',
      turnId: 'native-turn',
      eventId: randomUUID(),
    }
    expect(await dynamic.receiveAgentEvent(working, manualChannel)).toBe(true)
    expect((await dynamic.list())[0].agent?.activityState).toBe('working')
    mocks.processes.mockRejectedValueOnce(new Error('ps unavailable'))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await dynamic.list())[0].agent?.activityState).toBe('unknown')
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await dynamic.list())[0].agent).toBeUndefined()
    expect(managedUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'removed', launchId: firstRun.launchId }),
    )
    const secondRows = manualRows.map((row) => ({ ...row, started: `${row.started}-new` }))
    mocks.processes.mockResolvedValue(secondRows)
    const secondChannel = {}
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        secondChannel,
      ),
    ).toBe(true)
    const secondRun = (await dynamic.list())[0].agent!
    expect(secondRun.launchId).not.toBe(firstRun.launchId)
    expect(secondRun.revision).toBeGreaterThan(firstRun.revision)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, type: 'session-ended', eventId: randomUUID(), timestamp: Date.now() },
        secondChannel,
      ),
    ).toBe(true)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        {},
      ),
    ).toBe(true)
    expect((await dynamic.list())[0].agent?.launchId).not.toBe(secondRun.launchId)
    dynamic.write(shell.id, 'still a shell\r')
    await dynamic.shutdown()
    expect(dynamic.authenticManagedEvent(manual)).toBe(false)
    expect(
      await dynamic.receiveAgentEvent({ ...manual, timestamp: Date.now() }, manualChannel),
    ).toBe(false)
  })
})
