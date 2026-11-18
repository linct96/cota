import { mocks, options, settings } from '../terminal/terminal.fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TerminalManager } from '../../../src/main/terminal/manager'

import { backgroundRows, rows } from './agent-process.fixture'

const managers: TerminalManager[] = []

async function managedShell() {
  const managedUpdates = vi.fn()
  const dynamic = new TerminalManager(vi.fn(), managedUpdates, '/tmp/cota-test/agent.sock')
  managers.push(dynamic)
  const shell = options()
  mocks.shell.mockResolvedValueOnce('/usr/local/bin/fish')
  mocks.prepareShell.mockResolvedValueOnce(['-il', '-C', 'codex-wrapper'])
  await dynamic.create(shell, settings)
  const env = mocks.spawn.mock.calls.at(-1)![2].env
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
  const manualRows = rows.map((row) =>
    row.pid === 60000 ? { ...row, command: '/usr/bin/node', provider: 'pi' as const } : row,
  )
  return { dynamic, shell, env, manual, manualRows, managedUpdates }
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown()
})

describe('Managed Agent event authentication', () => {
  it('provides managed event credentials to the configured shell', async () => {
    const { shell, env } = await managedShell()
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/usr/local/bin/fish',
      ['-il', '-C', 'codex-wrapper'],
      expect.any(Object),
    )
    expect(env).toMatchObject({ COTA_AGENT_MANAGED: '1', COTA_AGENT_TERMINAL: shell.id })
  })

  it('rejects an invalid token before authenticating or creating an Agent', async () => {
    const { dynamic, shell, manual, manualRows } = await managedShell()
    const invalid = { ...manual, token: '0'.repeat(64) }
    const channel = {}
    expect(dynamic.authenticManagedEvent(invalid)).toBe(false)
    expect(await dynamic.receiveAgentEvent(invalid, channel)).toBe(false)
    expect((await dynamic.list()).find((entry) => entry.id === shell.id)?.agent).toBeUndefined()
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, channel)).toBe(true)
  })

  it.each([
    ['a foreign process', { processId: 1 }],
    ['a private payload', { prompt: 'secret' }],
    ['a background Claude process', { provider: 'claude', processId: 60002 }],
    ['a nested background Pi process', { processId: 60003 }],
  ])('rejects %s without blocking a valid foreground event', async (_label, change) => {
    const { dynamic, shell, manual, manualRows } = await managedShell()
    const channel = {}
    expect(await dynamic.receiveAgentEvent({ ...manual, ...change }, channel)).toBe(false)
    expect((await dynamic.list()).find((entry) => entry.id === shell.id)?.agent).toBeUndefined()
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, channel)).toBe(true)
  })

  it('creates an observable Pi session only for the matching foreground provider', async () => {
    const { dynamic, shell, manual, manualRows } = await managedShell()
    const channel = {}
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, channel)).toBe(true)
    expect(mocks.agent).toHaveBeenCalledWith('pi', { shellPath: settings.shellPath }, undefined)
    const terminal = (await dynamic.list()).find((entry) => entry.id === shell.id)!
    expect(terminal.agent).toMatchObject({
      provider: 'pi',
      activityState: 'idle',
      observability: 'full',
    })
    expect(terminal.kind).toBeUndefined()
    expect(await dynamic.receiveAgentEvent({ ...manual, provider: 'codex' }, {})).toBe(false)
  })

  it('keeps Antigravity invocations in one turn and starts a fresh turn after Stop', async () => {
    const { dynamic, shell, manual, manualRows } = await managedShell()
    mocks.capability.mockResolvedValueOnce('partial')
    mocks.processes.mockResolvedValue(
      manualRows.map((row) =>
        row.pid === 60000 ? { ...row, command: '/usr/local/bin/agy', provider: undefined } : row,
      ),
    )
    const update = (type: string, sessionId = manual.sessionId) =>
      dynamic.receiveAgentEvent(
        { ...manual, provider: 'agy', type, sessionId, eventId: randomUUID() },
        {},
      )
    const state = async () => (await dynamic.list()).find((entry) => entry.id === shell.id)?.agent
    expect(await update('session-started')).toBe(true)
    expect((await state())?.activityState).toBe('idle')
    expect(await update('turn-started')).toBe(true)
    const first = (await state())?.lastTurnId
    expect(first).toBeTruthy()
    expect(await update('turn-started')).toBe(true)
    expect(await update('turn-ended', 'another-conversation')).toBe(true)
    expect(await state()).toMatchObject({ activityState: 'working', lastTurnId: first })
    expect(await update('turn-ended')).toBe(true)
    expect(await state()).toMatchObject({ activityState: 'completed', lastTurnId: first })
    expect(await update('turn-started')).toBe(true)
    expect((await state())?.lastTurnId).not.toBe(first)
    expect(await update('turn-failed')).toBe(true)
    expect(await state()).toMatchObject({
      activityState: 'failed',
      eventSource: 'agy-hooks',
      observability: 'partial',
    })
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(2000)
    expect(await state()).toBeUndefined()
  })

  it('marks an unobserved run unknown and replaces it when the foreground process restarts', async () => {
    const { dynamic, shell, manual, manualRows, managedUpdates } = await managedShell()
    const channel = {}
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, channel)).toBe(true)
    const firstRun = (await dynamic.list()).find((entry) => entry.id === shell.id)!.agent!
    const working = {
      ...manual,
      type: 'turn-started',
      turnId: 'native-turn',
      eventId: randomUUID(),
    }
    expect(await dynamic.receiveAgentEvent(working, channel)).toBe(true)
    expect(
      (await dynamic.list()).find((entry) => entry.id === shell.id)?.agent?.activityState,
    ).toBe('working')
    mocks.processes.mockRejectedValueOnce(new Error('ps unavailable'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(
      (await dynamic.list()).find((entry) => entry.id === shell.id)?.agent?.activityState,
    ).toBe('unknown')
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await dynamic.list()).find((entry) => entry.id === shell.id)?.agent).toBeUndefined()
    expect(managedUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'removed', launchId: firstRun.launchId }),
    )
    const secondRows = manualRows.map((row) => ({ ...row, started: `${row.started}-new` }))
    mocks.processes.mockResolvedValue(secondRows)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        {},
      ),
    ).toBe(true)
    const secondRun = (await dynamic.list()).find((entry) => entry.id === shell.id)!.agent!
    expect(secondRun.launchId).not.toBe(firstRun.launchId)
    expect(secondRun.revision).toBeGreaterThan(firstRun.revision)
  })

  it('starts a new launch after session end and rejects events after shell shutdown', async () => {
    const { dynamic, shell, manual, manualRows } = await managedShell()
    const channel = {}
    mocks.processes.mockResolvedValue(manualRows)
    expect(await dynamic.receiveAgentEvent(manual, channel)).toBe(true)
    const firstRun = (await dynamic.list()).find((entry) => entry.id === shell.id)!.agent!
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, type: 'session-ended', eventId: randomUUID(), timestamp: Date.now() },
        channel,
      ),
    ).toBe(true)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        {},
      ),
    ).toBe(true)
    expect((await dynamic.list()).find((entry) => entry.id === shell.id)?.agent?.launchId).not.toBe(
      firstRun.launchId,
    )
    dynamic.write(shell.id, 'still a shell\r')
    await dynamic.shutdown()
    expect(dynamic.authenticManagedEvent(manual)).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, timestamp: Date.now() }, channel)).toBe(
      false,
    )
  })
})
