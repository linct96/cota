import { mocks, options, settings } from '../terminal/terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import { TerminalManager } from '../../../src/main/terminal/manager'

import { backgroundRows, codexRows, rows } from './agent-process.fixture'

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
describe('Terminal Agent discovery', () => {
  it('discovers Codex from foreground ownership and drops replaced process identities', async () => {
    const manual = agentEvent()
    const startup = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const startupEntry = options()
    await startup.create(startupEntry, settings)
    const startupEnv = mocks.spawn.mock.calls.at(-1)![2].env
    mocks.processes.mockResolvedValue(backgroundRows)
    await vi.advanceTimersByTimeAsync(500)
    expect((await startup.list())[0].agent).toBeUndefined()
    mocks.processes.mockResolvedValue(codexRows)
    startup.write(startupEntry.id, 'codex\r')
    await vi.advanceTimersByTimeAsync(350)
    const detected = (await startup.list())[0].agent!
    expect(detected).toMatchObject({
      provider: 'codex',
      runtimeState: 'running',
      activityState: 'unknown',
      eventSource: 'process',
      observability: 'unavailable',
      unread: false,
    })
    expect((await startup.list())[0].kind).toBeUndefined()
    const detectedRevision = detected.revision
    await vi.advanceTimersByTimeAsync(500)
    expect((await startup.list())[0].agent?.revision).toBe(detectedRevision)
    const startupEvent = {
      ...manual,
      terminalId: startupEntry.id,
      token: startupEnv.COTA_AGENT_TOKEN,
      provider: 'codex',
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-ended',
          turnId: 'too-early',
        },
        {},
      ),
    ).toBe(false)
    expect(await startup.receiveAgentEvent({ ...startupEvent, provider: 'pi' }, {})).toBe(false)
    const startupChannel = {}
    expect(await startup.receiveAgentEvent(startupEvent, startupChannel)).toBe(true)
    expect((await startup.list())[0].agent).toMatchObject({
      launchId: detected.launchId,
      activityState: 'idle',
      observability: 'partial',
    })
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-started',
          turnId: 'first-turn',
          eventId: randomUUID(),
        },
        startupChannel,
      ),
    ).toBe(true)
    expect((await startup.list())[0].agent?.activityState).toBe('working')
    mocks.processes.mockRejectedValueOnce(new Error('process snapshot unavailable'))
    await vi.advanceTimersByTimeAsync(750)
    expect((await startup.list())[0].agent).toMatchObject({
      launchId: detected.launchId,
      activityState: 'unknown',
    })
    mocks.processes.mockResolvedValue(
      codexRows.map((row) =>
        row.pid === 60000
          ? { ...row, started: `${row.started}-reused`, command: '/bin/python3' }
          : row,
      ),
    )
    await vi.advanceTimersByTimeAsync(1500)
    expect((await startup.list())[0].agent).toBeUndefined()
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-ended',
          turnId: 'old-turn',
        },
        {},
      ),
    ).toBe(false)
    mocks.processes.mockResolvedValue(
      codexRows.map((row) => ({
        ...row,
        started: `${row.started}-restarted`,
      })),
    )
    startup.write(startupEntry.id, 'codex\r')
    await vi.advanceTimersByTimeAsync(350)
    const restarted = (await startup.list())[0].agent!
    expect(restarted.launchId).not.toBe(detected.launchId)
    expect(restarted.revision).toBeGreaterThan(detectedRevision)
    expect(restarted.activityState).toBe('unknown')
    await startup.shutdown()
  })

  it('upgrades discovered Claude and Pi sessions only after their first valid Hook', async () => {
    const manual = agentEvent()
    for (const provider of ['claude', 'pi'] as const) {
      const generic = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
      const genericEntry = options()
      await generic.create(genericEntry, settings)
      const genericEnv = mocks.spawn.mock.calls.at(-1)![2].env
      mocks.processes.mockResolvedValue(
        codexRows.map((row) =>
          row.pid === 60000
            ? { ...row, command: provider === 'pi' ? '/usr/bin/node' : '/bin/claude', provider }
            : row,
        ),
      )
      await vi.advanceTimersByTimeAsync(350)
      const discovered = (await generic.list())[0].agent!
      expect(discovered).toMatchObject({
        provider,
        activityState: 'unknown',
        eventSource: 'process',
        observability: 'unavailable',
      })
      expect(mocks.processes).toHaveBeenLastCalledWith(true, [98765])
      expect(
        await generic.receiveAgentEvent(
          {
            ...manual,
            terminalId: genericEntry.id,
            token: genericEnv.COTA_AGENT_TOKEN,
            provider,
            timestamp: Date.now(),
            eventId: randomUUID(),
          },
          {},
        ),
      ).toBe(true)
      expect((await generic.list())[0].agent).toMatchObject({
        launchId: discovered.launchId,
        activityState: 'idle',
        observability: provider === 'pi' ? 'full' : 'partial',
      })
      await generic.shutdown()
    }
  })

  it('coalesces process observations, backs off on failures and stops polling after shutdown', async () => {
    const cadence = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const idleEntry = options()
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await cadence.create(idleEntry, settings)
    const idleChild = mocks.spawn.mock.results.at(-1)!.value
    await vi.advanceTimersByTimeAsync(350)
    const idleReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(1999)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 1)
    cadence.write(idleEntry.id, 'claude\r')
    await vi.advanceTimersByTimeAsync(349)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 2)
    idleChild.listeners.data('\x1b]133;')
    idleChild.listeners.data('C\x07')
    await vi.advanceTimersByTimeAsync(400)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 3)
    mocks.processes.mockRejectedValueOnce(new Error('snapshot unavailable'))
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    const failedReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(3999)
    expect(mocks.processes).toHaveBeenCalledTimes(failedReads)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(failedReads + 1)
    let finishObservation!: (value: typeof rows) => void
    mocks.processes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishObservation = resolve
        }),
    )
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    const pendingReads = mocks.processes.mock.calls.length
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    expect(mocks.processes).toHaveBeenCalledTimes(pendingReads)
    finishObservation(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(350)
    expect(mocks.processes).toHaveBeenCalledTimes(pendingReads + 1)
    await cadence.shutdown()
    const stoppedReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.processes).toHaveBeenCalledTimes(stoppedReads)
  })
})
