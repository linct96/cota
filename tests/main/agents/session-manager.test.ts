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
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe('Agent session state', () => {
  it('validates event identity, deduplicates revisions and tracks Pi turn outcomes', () => {
    const agent = { ...options(), ...agentLaunch(), provider: 'pi' as const }
    const updates = vi.fn()
    const engine = new AgentSessionManager(updates)
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
    const ready = event('session-started')
    expect(engine.receive({ ...ready, token: '0'.repeat(64) }, channel)).toBe(false)
    expect(engine.receive({ ...ready, launchId: randomUUID() }, channel)).toBe(false)
    expect(engine.receive({ ...ready, provider: 'claude' }, channel)).toBe(false)
    expect(engine.receive({ ...ready, prompt: 'never accepted' }, channel)).toBe(false)
    expect(engine.receive({ ...ready, timestamp: Date.now() - 31_000 }, channel)).toBe(false)
    expect(engine.receive({ ...ready, type: 'constructor' }, channel)).toBe(false)
    expect(engine.receive(ready, channel)).toBe(true)
    expect(state).toMatchObject({ activityState: 'idle', observability: 'full' })
    expect(engine.receive(ready, {})).toBe(false)
    const revision = state.revision
    expect(engine.receive(ready, channel)).toBe(true)
    expect(state.revision).toBe(revision)
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
    for (let index = 0; index < 101; index++) engine.receive(ready, channel)
    expect(engine.receive(ready, channel)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(engine.receive(event('turn-started', 'turn-3'), channel)).toBe(true)
    engine.disconnect(channel)
    expect(state).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    expect(engine.receive(event('turn-completed', 'turn-3'), channel)).toBe(false)
    expect(JSON.stringify(updates.mock.calls)).not.toContain(token)
    engine.disable()
  })

  it('tracks Hook outcomes, child activity, background inventories and expiration', () => {
    const engine = new AgentSessionManager(vi.fn())
    const hookAgent = { ...options(), ...agentLaunch(), provider: 'claude' as const }
    const hookState = engine.create(hookAgent.id, hookAgent.launchId, 'claude', hookAgent)
    engine.runtime(hookAgent.id, 'running')
    const hookToken = engine.enable(hookAgent.id, 'claude-hooks', 'partial')
    const hookEvent = (type: AgentEventType, turnId = 'prompt-1') => ({
      eventId: randomUUID(),
      timestamp: Date.now(),
      type,
      ...(turnId ? { turnId } : {}),
      terminalId: hookAgent.id,
      launchId: hookAgent.launchId,
      provider: 'claude',
      token: hookToken,
    })
    engine.receive(hookEvent('turn-started'), {})
    engine.receive(hookEvent('turn-completed'), {})
    expect(hookState.activityState).toBe('working')
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      unread: true,
    })
    engine.receive(hookEvent('turn-active'), {})
    expect(hookState).toMatchObject({ activityState: 'working', unread: false })
    engine.receive(hookEvent('turn-failed'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({ activityState: 'failed', outcome: 'failure', unread: true })
    engine.receive(hookEvent('turn-active'), {})
    engine.receive(hookEvent('turn-interrupted'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      unread: false,
    })
    engine.receive(hookEvent('turn-started', 'prompt-2'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('working')
    const childEvent = (type: AgentEventType, agentId = 'child-a') => ({
      ...hookEvent(type, 'prompt-2'),
      agentId,
    })
    engine.receive(childEvent('turn-started'), {})
    engine.receive({ ...childEvent('turn-started', 'child-b'), turnId: undefined }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(childEvent('turn-started'), {})
    engine.receive(hookEvent('turn-ended', 'prompt-2'), {})
    expect(hookState).toMatchObject({
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
    expect(hookState.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    expect(hookState).toMatchObject({
      activityState: 'working',
      waitingChildren: 0,
      workingChildren: 2,
    })
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('working')
    engine.receive({ ...childEvent('turn-ended', 'child-b'), turnId: undefined }, {})
    expect(hookState).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      workingChildren: 0,
    })
    const resumed = childEvent('turn-started')
    engine.receive(resumed, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(resumed, {})
    engine.receive(childEvent('turn-started'), {})
    expect(hookState.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('completed')
    engine.receive({ ...hookEvent('attention-required', 'prompt-2'), toolName: 'Bash' }, {})
    engine.receive(
      {
        ...hookEvent('turn-active', 'prompt-2'),
        toolName: 'Bash',
        requestId: 'parallel',
        requestDone: true,
      },
      {},
    )
    expect(hookState.activityState).toBe('needs-input')
    const emptyInventory = { agentIds: [], otherCount: 0 }
    const inventory = { agentIds: ['child-a', 'snapshot-only'], otherCount: 1 }
    for (const backgroundTasks of [
      { agentIds: ['child-a', 'child-a'], otherCount: 0 },
      { agentIds: ['bad/id'], otherCount: 0 },
      { agentIds: [], otherCount: -1 },
      { agentIds: [], otherCount: 257 },
      { agentIds: [], otherCount: 0, command: 'never accepted' },
    ])
      expect(engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks }, {})).toBe(
        false,
      )
    expect(
      engine.receive({ ...childEvent('turn-ended'), backgroundTasks: emptyInventory }, {}),
    ).toBe(false)
    engine.receive(childEvent('turn-started'), {})
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 3 })
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(hookState.workingChildren).toBe(3)
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.workingChildren).toBe(2)
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: emptyInventory }, {})
    expect(hookState).toMatchObject({ activityState: 'completed', workingChildren: 0 })
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: { agentIds: [], otherCount: 1 } },
      {},
    )
    engine.receive(hookEvent('turn-started', 'prompt-background'), {})
    vi.advanceTimersByTime(5 * 60_000)
    engine.expire()
    expect(hookState).toMatchObject({ activityState: 'working', observability: 'partial' })
    vi.advanceTimersByTime(24 * 60_000)
    engine.receive(hookEvent('turn-active', 'prompt-background'), {})
    engine.receive(hookEvent('turn-ended', 'prompt-background'), {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    vi.advanceTimersByTime(60_000)
    engine.expire()
    expect(hookState).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(
      { ...hookEvent('turn-failed', 'prompt-background'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'failed',
      outcome: 'failure',
      workingChildren: 0,
    })
    engine.receive(hookEvent('turn-started', 'prompt-2-clean'), {})
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-2-clean'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'completed',
      observability: 'partial',
      outcome: 'unknown',
    })
    const olderInventory = {
      ...hookEvent('turn-ended', 'prompt-2-clean'),
      backgroundTasks: emptyInventory,
    }
    vi.advanceTimersByTime(1)
    engine.receive(childEvent('turn-started'), {})
    engine.receive(olderInventory, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive(childEvent('turn-ended'), {})
    engine.receive(hookEvent('turn-started', 'prompt-cancel'), {})
    engine.receive(
      {
        ...hookEvent('turn-ended', 'prompt-cancel'),
        backgroundTasks: { agentIds: [], otherCount: 1 },
      },
      {},
    )
    engine.receive(hookEvent('turn-interrupted', 'prompt-cancel'), {})
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-cancel'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      workingChildren: 0,
    })
    engine.receive(hookEvent('turn-started', 'prompt-3'), {})
    engine.receive(childEvent('turn-started', 'child-stale'), {})
    vi.advanceTimersByTime(30 * 60_000 - 1)
    engine.expire()
    expect(hookState).toMatchObject({ activityState: 'working', observability: 'partial' })
    vi.advanceTimersByTime(1)
    engine.expire()
    engine.receive(hookEvent('turn-ended', 'prompt-3'), {})
    expect(hookState).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(childEvent('turn-ended', 'child-stale'), {})
    expect(hookState).toMatchObject({ activityState: 'completed', observability: 'partial' })
    engine.runtime(hookAgent.id, 'exited', 7)
    expect(engine.receive(hookEvent('turn-completed', 'prompt-2'), {})).toBe(false)
    expect(hookState).toMatchObject({
      runtimeState: 'exited',
      activityState: 'unknown',
      exitCode: 7,
    })
    engine.disable()
  })
})
