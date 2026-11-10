import { agentLaunch, mocks, options, settings } from '../terminal/terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TerminalManager } from '../../../src/main/terminal/manager'

import { rows } from './agent-process.fixture'

function agentEvent() {
  return {
    managed: true,
    provider: 'pi',
    processId: 60001,
    sessionId: 'native-session',
    type: 'session-started',
    eventId: randomUUID(),
    timestamp: Date.now(),
  }
}
describe('Explicit Agent lifecycle and capabilities', () => {
  it('keeps explicit Agent identity through reconnects until its PTY exits', async () => {
    const manual = agentEvent()
    const directUpdates = vi.fn()
    const direct = new TerminalManager(vi.fn(), directUpdates, '/tmp/cota-test/agent.sock')
    const directEntry = { ...options(), ...agentLaunch(), provider: 'pi' as const }
    await direct.create(directEntry, settings)
    const directSpawn = mocks.spawn.mock.calls.at(-1)!
    const directChild = mocks.spawn.mock.results.at(-1)!.value
    expect(directSpawn.slice(0, 2)).toEqual(['/usr/local/bin/pi', []])
    expect(directSpawn[2].env).toMatchObject({
      COTA_AGENT_MANAGED: '1',
      COTA_AGENT_TERMINAL: directEntry.id,
      COTA_AGENT_RUNNER: process.execPath,
    })
    expect(directSpawn[2].env.COTA_AGENT_LAUNCH).toBeUndefined()
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'unknown',
      observability: 'unavailable',
    })
    mocks.processes.mockResolvedValue(rows.map((row) => ({ ...row, foreground: 98765 })))
    const directEvent = {
      ...manual,
      terminalId: directEntry.id,
      token: directSpawn[2].env.COTA_AGENT_TOKEN,
      processId: 98765,
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    const directChannel = {}
    expect(await direct.receiveAgentEvent({ ...directEvent, provider: 'codex' }, {})).toBe(false)
    expect(await direct.receiveAgentEvent({ ...directEvent, managed: undefined }, {})).toBe(false)
    expect(await direct.receiveAgentEvent(directEvent, directChannel)).toBe(true)
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'idle',
      observability: 'full',
    })
    expect(
      await direct.receiveAgentEvent(
        {
          ...directEvent,
          type: 'turn-started',
          turnId: 'direct-turn',
          eventId: randomUUID(),
        },
        directChannel,
      ),
    ).toBe(true)
    expect((await direct.list())[0].agent?.activityState).toBe('working')
    expect(
      await direct.receiveAgentEvent(
        {
          ...directEvent,
          type: 'session-ended',
          eventId: randomUUID(),
        },
        directChannel,
      ),
    ).toBe(true)
    const directRevision = (await direct.list())[0].agent!.revision
    expect(await direct.receiveAgentEvent({ ...directEvent, eventId: randomUUID() }, {})).toBe(true)
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'idle',
    })
    expect((await direct.list())[0].agent!.revision).toBeGreaterThan(directRevision)
    mocks.processes.mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(2000)
    expect((await direct.list())[0].agent?.runtimeState).toBe('running')
    expect(directUpdates.mock.calls.some(([event]) => event.type === 'removed')).toBe(false)
    directChild.listeners.exit({ exitCode: 7 })
    expect((await direct.list())[0]).toMatchObject({
      exited: true,
      exitCode: 7,
      agent: { launchId: directEntry.launchId, runtimeState: 'exited', exitCode: 7 },
    })
    expect(await direct.receiveAgentEvent(directEvent, {})).toBe(false)
    await direct.shutdown()
  })

  it('rejects a capability result that finishes after terminal closure starts', async () => {
    const directEvent = { ...agentEvent(), processId: 98765 }
    const pendingManager = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const pendingEntry = { ...options(), ...agentLaunch() }
    await pendingManager.create(pendingEntry, settings)
    const pendingEnv = mocks.spawn.mock.calls.at(-1)![2].env
    mocks.processes.mockResolvedValue(rows.map((row) => ({ ...row, foreground: 98765 })))
    let finishCapability!: (value: 'partial') => void
    mocks.capability.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCapability = resolve
        }),
    )
    const pendingEvent = {
      ...directEvent,
      terminalId: pendingEntry.id,
      provider: 'codex',
      token: pendingEnv.COTA_AGENT_TOKEN,
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    const pendingReceive = pendingManager.receiveAgentEvent(pendingEvent, {})
    await vi.waitFor(() => expect(finishCapability).toBeDefined())
    mocks.stop.mockRejectedValueOnce(new Error('pending close failed'))
    await expect(pendingManager.close(pendingEntry.id)).rejects.toThrow('pending close failed')
    finishCapability('partial')
    expect(await pendingReceive).toBe(false)
    expect((await pendingManager.list())[0].agent?.observability).toBe('unavailable')
    expect(
      await pendingManager.receiveAgentEvent({ ...pendingEvent, eventId: randomUUID() }, {}),
    ).toBe(false)
    await pendingManager.shutdown()
  })
})
