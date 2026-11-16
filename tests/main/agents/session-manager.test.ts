import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AgentEventType } from '../../../src/shared/contracts'
import { AgentSessionManager } from '../../../src/main/agents/runtime/session-manager'

const agentLaunch = () => ({
  kind: 'agent' as const,
  provider: 'codex' as const,
  launchId: randomUUID(),
})
const options = () => ({
  id: randomUUID(),
  projectPath: '/tmp/project',
  cwd: '/tmp/project',
  workspaceKind: 'local' as const,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  cols: 80,
  rows: 24,
})

const engines: AgentSessionManager[] = []
function piSession() {
  const agent = { ...options(), ...agentLaunch(), provider: 'pi' as const }
  const updates = vi.fn()
  const engine = new AgentSessionManager(updates)
  engines.push(engine)
  const state = engine.create(agent.id, agent.launchId, 'pi', agent)
  engine.runtime(agent.id, 'running')
  const token = engine.enable(agent.id, 'pi-extension', 'full')
  const channel = {}
  const event = (type: AgentEventType, turnId?: string) => ({
    terminalId: agent.id,
    launchId: agent.launchId,
    provider: 'pi',
    token,
    eventId: randomUUID(),
    timestamp: Date.now(),
    type,
    ...(turnId ? { turnId } : {}),
  })
  return { agent, updates, engine, state, token, channel, event }
}

function hookSession() {
  const engine = new AgentSessionManager(vi.fn())
  engines.push(engine)
  const agent = { ...options(), ...agentLaunch(), provider: 'claude' as const }
  const state = engine.create(agent.id, agent.launchId, 'claude', agent)
  engine.runtime(agent.id, 'running')
  const token = engine.enable(agent.id, 'claude-hooks', 'partial')
  const event = (type: AgentEventType, turnId = 'prompt-1') => ({
    eventId: randomUUID(),
    timestamp: Date.now(),
    type,
    ...(turnId ? { turnId } : {}),
    terminalId: agent.id,
    launchId: agent.launchId,
    provider: 'claude',
    token,
  })
  const childEvent = (type: AgentEventType, agentId = 'child-a') => ({
    ...event(type, 'prompt-2'),
    agentId,
  })
  return { agent, engine, state, event, childEvent }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const engine of engines.splice(0)) engine.disable()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Agent session state', () => {
  it.each(['token', 'launchId', 'provider', 'prompt', 'timestamp', 'type'] as const)(
    'rejects invalid Pi event %s without blocking the valid session',
    (field) => {
      const { engine, state, channel, event } = piSession()
      const ready = event('session-started')
      const invalid = {
        token: { token: '0'.repeat(64) },
        launchId: { launchId: randomUUID() },
        provider: { provider: 'claude' },
        prompt: { prompt: 'never accepted' },
        timestamp: { timestamp: Date.now() - 31_000 },
        type: { type: 'constructor' },
      }
      expect(engine.receive({ ...ready, ...invalid[field] }, channel)).toBe(false)
      expect(engine.receive(ready, channel)).toBe(true)
      expect(state).toMatchObject({ activityState: 'idle', observability: 'full' })
    },
  )

  it('binds Pi events to their channel and deduplicates revisions', () => {
    const { engine, state, channel, event } = piSession()
    const ready = event('session-started')
    expect(engine.receive(ready, channel)).toBe(true)
    expect(engine.receive(ready, {})).toBe(false)
    const revision = state.revision
    expect(engine.receive(ready, channel)).toBe(true)
    expect(state.revision).toBe(revision)
  })

  it('tracks Pi turn outcomes and acknowledges only the current unread revision', () => {
    const { agent, engine, state, channel, event } = piSession()
    engine.receive(event('session-started'), channel)
    engine.receive(event('turn-started', 'turn-1'), channel)
    engine.receive(event('attention-required', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'needs-input', unread: true })
    engine.read(agent.id, agent.launchId, state.revision - 1)
    engine.read(agent.id, randomUUID(), state.revision)
    expect(state.unread).toBe(true)
    engine.read(agent.id, agent.launchId, state.revision)
    expect(state).toMatchObject({ activityState: 'needs-input', unread: false })
    engine.receive(event('turn-active', 'turn-1'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'completed', outcome: 'success', unread: true })
    engine.read(agent.id, agent.launchId, state.revision)
    expect(state).toMatchObject({ activityState: 'completed', unread: false })
    engine.receive(event('attention-required'), channel)
    engine.receive(event('activity-unknown'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    expect(state.activityState).toBe('unknown')
    engine.receive(event('turn-started', 'turn-2'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    engine.receive(event('turn-started', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'working', lastTurnId: 'turn-2' })
    engine.receive(event('turn-interrupted', 'turn-2'), channel)
    expect(state).toMatchObject({ activityState: 'interrupted', unread: false })
  })

  it('rate-limits Pi events, resumes after a second and disables a disconnected channel', () => {
    const { updates, engine, state, token, channel, event } = piSession()
    const ready = event('session-started')
    engine.receive(ready, channel)
    for (let index = 0; index < 101; index++) engine.receive(ready, channel)
    expect(engine.receive(ready, channel)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(engine.receive(event('turn-started', 'turn-3'), channel)).toBe(true)
    engine.disconnect(channel)
    expect(state).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    expect(engine.receive(event('turn-completed', 'turn-3'), channel)).toBe(false)
    expect(JSON.stringify(updates.mock.calls)).not.toContain(token)
  })

  it('tracks reversible Hook outcomes without treating a stopped turn as success', () => {
    const { engine, state, event } = hookSession()
    engine.receive(event('turn-started'), {})
    engine.receive(event('turn-completed'), {})
    expect(state.activityState).toBe('working')
    engine.receive(event('turn-ended'), {})
    expect(state).toMatchObject({ activityState: 'completed', outcome: 'unknown', unread: true })
    engine.receive(event('turn-active'), {})
    expect(state).toMatchObject({ activityState: 'working', unread: false })
    engine.receive(event('turn-failed'), {})
    engine.receive(event('turn-ended'), {})
    expect(state).toMatchObject({ activityState: 'failed', outcome: 'failure', unread: true })
    engine.receive(event('turn-active'), {})
    engine.receive(event('turn-interrupted'), {})
    engine.receive(event('turn-ended'), {})
    expect(state).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      unread: false,
    })
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(event('turn-ended'), {})
    expect(state.activityState).toBe('working')
  })

  it('tracks independent child waits and permits a completed child to start again', () => {
    const { engine, state, event, childEvent } = hookSession()
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(childEvent('turn-started'), {})
    engine.receive({ ...childEvent('turn-started', 'child-b'), turnId: undefined }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(childEvent('turn-started'), {})
    engine.receive(event('turn-ended', 'prompt-2'), {})
    expect(state).toMatchObject({
      activityState: 'needs-input',
      waitingChildren: 1,
      workingChildren: 1,
    })
    engine.receive(
      { ...childEvent('turn-active', 'child-b'), requestId: 'question-a', requestDone: true },
      {},
    )
    engine.receive(
      { ...childEvent('turn-active'), requestId: 'unrelated-tool', requestDone: true },
      {},
    )
    expect(state.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    expect(state).toMatchObject({
      activityState: 'working',
      waitingChildren: 0,
      workingChildren: 2,
    })
    engine.receive(childEvent('turn-ended'), {})
    expect(state.activityState).toBe('working')
    engine.receive({ ...childEvent('turn-ended', 'child-b'), turnId: undefined }, {})
    expect(state).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      workingChildren: 0,
    })
    const resumed = childEvent('turn-started')
    engine.receive(resumed, {})
    expect(state).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(resumed, {})
    engine.receive(childEvent('turn-started'), {})
    expect(state.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive(childEvent('turn-ended'), {})
    expect(state.activityState).toBe('completed')
  })

  it('keeps an unidentified parent wait when a parallel tool completes', () => {
    const { engine, state, event } = hookSession()
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(event('turn-ended', 'prompt-2'), {})
    engine.receive({ ...event('attention-required', 'prompt-2'), toolName: 'Bash' }, {})
    engine.receive(
      {
        ...event('turn-active', 'prompt-2'),
        toolName: 'Bash',
        requestId: 'parallel',
        requestDone: true,
      },
      {},
    )
    expect(state.activityState).toBe('needs-input')
  })

  it.each([
    ['duplicate IDs', { agentIds: ['child-a', 'child-a'], otherCount: 0 }],
    ['invalid ID', { agentIds: ['bad/id'], otherCount: 0 }],
    ['negative count', { agentIds: [], otherCount: -1 }],
    ['excessive count', { agentIds: [], otherCount: 257 }],
    ['extra command', { agentIds: [], otherCount: 0, command: 'never accepted' }],
  ])('rejects a background inventory with %s', (_label, backgroundTasks) => {
    const { engine, state, event } = hookSession()
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive({ ...event('attention-required', 'prompt-2'), toolName: 'Bash' }, {})
    expect(engine.receive({ ...event('turn-ended', 'prompt-2'), backgroundTasks }, {})).toBe(false)
    expect(state.activityState).toBe('needs-input')
  })

  it('rejects background inventories reported by a child', () => {
    const { engine, event, childEvent } = hookSession()
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(childEvent('turn-started'), {})
    engine.receive(childEvent('turn-ended'), {})
    expect(
      engine.receive(
        { ...childEvent('turn-ended'), backgroundTasks: { agentIds: [], otherCount: 0 } },
        {},
      ),
    ).toBe(false)
  })

  it('reconciles Hook child activity with background inventories without double-counting', () => {
    const { engine, state, event, childEvent } = hookSession()
    const emptyInventory = { agentIds: [], otherCount: 0 }
    const inventory = { agentIds: ['child-a', 'snapshot-only'], otherCount: 1 }
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(event('turn-ended', 'prompt-2'), {})
    engine.receive({ ...event('attention-required', 'prompt-2'), toolName: 'Bash' }, {})
    engine.receive(
      {
        ...event('turn-active', 'prompt-2'),
        toolName: 'Bash',
        requestId: 'parallel',
        requestDone: true,
      },
      {},
    )
    engine.receive(childEvent('turn-started'), {})
    expect(state.activityState).toBe('needs-input')
    engine.receive({ ...event('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(state).toMatchObject({ activityState: 'working', workingChildren: 3 })
    engine.receive({ ...event('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(state.workingChildren).toBe(3)
    engine.receive(childEvent('turn-ended'), {})
    expect(state.workingChildren).toBe(2)
    engine.receive({ ...event('turn-ended', 'prompt-2'), backgroundTasks: emptyInventory }, {})
    expect(state).toMatchObject({ activityState: 'completed', workingChildren: 0 })
  })

  it('expires stale background activity and recovers after fresh events', () => {
    const { engine, state, event } = hookSession()
    const emptyInventory = { agentIds: [], otherCount: 0 }
    engine.receive(event('turn-started', 'prompt-2'), {})
    engine.receive(
      { ...event('turn-ended', 'prompt-2'), backgroundTasks: { agentIds: [], otherCount: 1 } },
      {},
    )
    engine.receive(event('turn-started', 'prompt-background'), {})
    vi.advanceTimersByTime(5 * 60_000)
    engine.expire()
    expect(state).toMatchObject({ activityState: 'working', observability: 'partial' })
    vi.advanceTimersByTime(24 * 60_000)
    engine.receive(event('turn-active', 'prompt-background'), {})
    engine.receive(event('turn-ended', 'prompt-background'), {})
    expect(state).toMatchObject({ activityState: 'working', workingChildren: 1 })
    vi.advanceTimersByTime(60_000)
    engine.expire()
    expect(state).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(
      { ...event('turn-failed', 'prompt-background'), backgroundTasks: emptyInventory },
      {},
    )
    expect(state).toMatchObject({ activityState: 'failed', outcome: 'failure', workingChildren: 0 })
    engine.receive(event('turn-started', 'prompt-2-clean'), {})
    engine.receive(
      { ...event('turn-ended', 'prompt-2-clean'), backgroundTasks: emptyInventory },
      {},
    )
    expect(state).toMatchObject({
      activityState: 'completed',
      observability: 'partial',
      outcome: 'unknown',
    })
  })

  it('does not let an older inventory clear newer child activity', () => {
    const { engine, state, event, childEvent } = hookSession()
    const emptyInventory = { agentIds: [], otherCount: 0 }
    engine.receive(event('turn-started', 'prompt-2-clean'), {})
    engine.receive(
      { ...event('turn-ended', 'prompt-2-clean'), backgroundTasks: emptyInventory },
      {},
    )
    const olderInventory = {
      ...event('turn-ended', 'prompt-2-clean'),
      backgroundTasks: emptyInventory,
    }
    vi.advanceTimersByTime(1)
    engine.receive(childEvent('turn-started'), {})
    engine.receive(olderInventory, {})
    expect(state).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive(childEvent('turn-ended'), {})
    expect(state).toMatchObject({ activityState: 'completed', workingChildren: 0 })
  })

  it('preserves an interrupted outcome when background activity ends', () => {
    const { engine, state, event } = hookSession()
    engine.receive(event('turn-started', 'prompt-cancel'), {})
    engine.receive(
      {
        ...event('turn-ended', 'prompt-cancel'),
        backgroundTasks: { agentIds: [], otherCount: 1 },
      },
      {},
    )
    engine.receive(event('turn-interrupted', 'prompt-cancel'), {})
    engine.receive(
      { ...event('turn-ended', 'prompt-cancel'), backgroundTasks: { agentIds: [], otherCount: 0 } },
      {},
    )
    expect(state).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      workingChildren: 0,
    })
  })

  it('expires a stale child at thirty minutes and rejects events after process exit', () => {
    const { agent, engine, state, event, childEvent } = hookSession()
    engine.receive(event('turn-started', 'prompt-3'), {})
    engine.receive(childEvent('turn-started', 'child-stale'), {})
    vi.advanceTimersByTime(30 * 60_000 - 1)
    engine.expire()
    expect(state).toMatchObject({ activityState: 'working', observability: 'partial' })
    vi.advanceTimersByTime(1)
    engine.expire()
    engine.receive(event('turn-ended', 'prompt-3'), {})
    expect(state).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(childEvent('turn-ended', 'child-stale'), {})
    expect(state).toMatchObject({ activityState: 'completed', observability: 'partial' })
    engine.runtime(agent.id, 'exited', 7)
    expect(engine.receive(event('turn-completed', 'prompt-2'), {})).toBe(false)
    expect(state).toMatchObject({ runtimeState: 'exited', activityState: 'unknown', exitCode: 7 })
  })
})
