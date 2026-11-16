import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { terminalTabs, useWorkspace } from '../../../src/renderer/src/state/workspace'
import type { TerminalTab, WorkspaceState } from '../../../src/renderer/src/state/workspace'
import {
  agentIndicatorState,
  agentTabState,
  workspaceTerminalSummary as workspaceAgentSummary,
} from '../../../src/renderer/src/features/agents/lib/agent-status'

import { restoreAgentWorkspace } from './agent-workspace.fixture'

async function prepareAgentScenario() {
  const fixture = await restoreAgentWorkspace()
  return {
    ...fixture,
    store: () => useWorkspace.getState(),
    completion: {
      ...fixture.buffered,
      revision: 4,
      activityState: 'completed' as const,
      unread: true,
    },
  }
}

function tab(id: string): TerminalTab {
  const found = useWorkspace.getState().tabs.find((item) => item.id === id)
  if (!found) throw new Error(`Missing terminal ${id}`)
  return found
}

function splitGroup(focused: TerminalTab, background: TerminalTab): WorkspaceState {
  return {
    ...useWorkspace.getState(),
    tabs: [focused, background],
    terminalLayouts: [
      {
        id: 'group',
        activePaneId: focused.id,
        root: {
          type: 'split',
          id: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          children: [
            { type: 'terminal', id: focused.id },
            { type: 'terminal', id: background.id },
          ],
        },
      },
    ],
  }
}

describe('Workspace Agent state and unread indicators', () => {
  it('does not change focus when an Agent completes while not visible', async () => {
    const { workspace, live, completion, store } = await prepareAgentScenario()
    const focus = store().focusVersion
    store().receiveAgent({ type: 'state', session: completion })
    expect(api.readAgent).not.toHaveBeenCalled()
    expect(store().focusVersion).toBe(focus)
    expect(store().activeTabs[workspace.id]).toBe(live.id)
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'completed',
      count: 1,
      description: '1 个本轮结束',
    })
  })

  it('omits an ordinary shell from the Agent summary', async () => {
    const { other } = await prepareAgentScenario()
    expect(workspaceAgentSummary([tab(other.id)])).toBeUndefined()
  })

  it.each(['starting', 'running', 'error', 'exited'] as const)(
    'summarizes Agent terminal status %s without an Agent session',
    async (status) => {
      const { live } = await prepareAgentScenario()
      expect(workspaceAgentSummary([{ ...tab(live.id), agent: undefined, status }])?.state).toBe(
        status === 'error' ? 'error' : 'other',
      )
    },
  )

  it.each(['starting', 'stopping', 'exited'] as const)(
    'does not show a completion indicator for runtime %s',
    async (runtimeState) => {
      const { live, completion } = await prepareAgentScenario()
      expect(agentIndicatorState({ ...tab(live.id), agent: { ...completion, runtimeState } })).toBe(
        'other',
      )
    },
  )

  it.each(['idle', 'unknown'] as const)(
    'does not show an Agent indicator for activity %s',
    async (activityState) => {
      const { live, completion } = await prepareAgentScenario()
      expect(
        agentIndicatorState({ ...tab(live.id), agent: { ...completion, activityState } }),
      ).toBe('other')
    },
  )

  it('classifies a completed Agent and suppresses a closing terminal', async () => {
    const { live, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    expect(agentTabState({ ...tab(live.id), closingStatus: 'running' })).toBe('other')
    expect(agentTabState(tab(live.id))).toBe('completed')
  })

  it('summarizes unread Agent outcomes in priority order', async () => {
    const { live, buffered, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    const failed = {
      ...tab(live.id),
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    expect(agentIndicatorState(failed)).toBe('failed')
    expect(agentIndicatorState({ ...failed, agent: { ...failed.agent, unread: false } })).toBe(
      'other',
    )
    expect(workspaceAgentSummary([failed])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败',
    })
    const working = { ...failed, agent: buffered }
    expect(workspaceAgentSummary([working, failed, working])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败 · 2 个执行中',
    })
    expect(
      workspaceAgentSummary([{ ...failed, agent: { ...failed.agent, unread: false } }]),
    ).toEqual({ state: 'other', count: 1, description: '1 个其他状态' })
    const succeeded = { ...tab(live.id), agent: { ...completion, outcome: 'success' as const } }
    expect(agentTabState(succeeded)).toBe('succeeded')
    expect(
      workspaceAgentSummary([
        working,
        failed,
        { ...failed, agent: { ...completion, activityState: 'needs-input' as const } },
        { ...failed, agent: completion },
        succeeded,
      ]),
    ).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败 · 1 个已完成 · 1 个本轮结束 · 1 个待处理 · 1 个执行中',
    })
  })

  it('prioritizes focused and background indicators in a split terminal group', async () => {
    const { live, other, buffered, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    const focused = tab(other.id)
    const completed = tab(live.id)
    const failed = {
      ...completed,
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    const working = { ...failed, agent: buffered }
    const succeeded = { ...completed, agent: { ...completion, outcome: 'success' as const } }
    for (const background of [working, succeeded, completed, failed]) {
      const grouped = terminalTabs(splitGroup(focused, background))[0]
      expect(grouped.indicatorTab).toBe(background)
      expect(grouped).toMatchObject({ id: 'group', kind: 'shell', cwd: other.cwd })
    }
    const focusedAgent = { ...succeeded, id: other.id }
    expect(terminalTabs(splitGroup(focusedAgent, working))[0].indicatorTab).toBe(focusedAgent)
    expect(terminalTabs(splitGroup(focusedAgent, succeeded))[0].indicatorTab).toBe(focusedAgent)
    expect(terminalTabs(splitGroup(focusedAgent, failed))[0].indicatorTab).toBe(failed)
    const connectionError = { ...focusedAgent, status: 'error' as const }
    expect(terminalTabs(splitGroup(connectionError, succeeded))[0].indicatorTab).toBe(
      connectionError,
    )
    expect(
      terminalTabs(splitGroup({ ...focused, status: 'error' }, succeeded))[0].indicatorTab,
    ).toBe(succeeded)
    for (const background of [
      { ...succeeded, agent: { ...succeeded.agent, unread: false } },
      { ...failed, agent: { ...failed.agent, unread: false } },
      { ...failed, status: 'error' as const, errorRead: true },
      { ...working, closingStatus: 'running' as const },
      { ...working, agent: { ...buffered, runtimeState: 'exited' as const } },
      { ...working, agent: { ...buffered, activityState: 'idle' as const } },
    ]) {
      expect(terminalTabs(splitGroup(focused, background))[0].indicatorTab).toBe(focused)
    }
  })

  it('acknowledges a completed Agent only after its active terminal remains visible', async () => {
    const { live, agent, other, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(5000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(500)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(undefined)
      vi.advanceTimersByTime(5000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(500)
      store().selectTab(other.id)
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().selectTab(live.id)
      vi.advanceTimersByTime(999)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().updateTab(other.id, { title: 'Shell renamed' })
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenCalledExactlyOnceWith(live.id, agent.launchId, 4)
      expect(tab(live.id).agent?.unread).toBe(true)
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })

  it('updates Agent indicators and summary after a read', async () => {
    const { live, buffered, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    const succeeded = { ...tab(live.id), agent: { ...completion, outcome: 'success' as const } }
    const working = { ...tab(live.id), agent: buffered }
    const read = { ...completion, revision: 5, unread: false }
    store().receiveAgent({ type: 'state', session: read })
    expect(tab(live.id).agent?.activityState).toBe('completed')
    expect(agentTabState(tab(live.id))).toBe('completed')
    expect(agentIndicatorState(tab(live.id))).toBe('other')
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'other',
      count: 1,
      description: '1 个其他状态',
    })
    expect(
      workspaceAgentSummary([{ ...succeeded, agent: { ...succeeded.agent, unread: false } }])
        ?.state,
    ).toBe('other')
    expect(workspaceAgentSummary([working])?.state).toBe('working')
  })

  it.each(['older revision', 'different launch', 'different cwd'] as const)(
    'ignores an Agent update with %s after a read',
    async (mismatch) => {
      const { live, completion, store } = await prepareAgentScenario()
      store().receiveAgent({ type: 'state', session: completion })
      const read = { ...completion, revision: 5, unread: false }
      store().receiveAgent({ type: 'state', session: read })
      const invalid =
        mismatch === 'older revision'
          ? completion
          : mismatch === 'different launch'
            ? { ...completion, revision: 6, launchId: crypto.randomUUID() }
            : { ...completion, revision: 6, cwd: '/wrong' }
      store().receiveAgent({ type: 'state', session: invalid })
      expect(tab(live.id).agent).toEqual(read)
      const attention = {
        ...read,
        revision: 6,
        activityState: 'needs-input' as const,
        unread: true,
      }
      store().receiveAgent({ type: 'state', session: attention })
      expect(tab(live.id).agent).toEqual(attention)
    },
  )

  it('summarizes Agents needing input alongside failures and working sessions', async () => {
    const { live, buffered, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: completion })
    const failed = {
      ...tab(live.id),
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    const working = { ...failed, agent: buffered }
    const read = { ...completion, revision: 5, unread: false }
    store().receiveAgent({ type: 'state', session: read })
    const attention = { ...read, revision: 6, activityState: 'needs-input' as const, unread: true }
    store().setVisibleTerminal(undefined)
    store().receiveAgent({ type: 'state', session: attention })
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
    expect(workspaceAgentSummary([failed, working, tab(live.id)])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败 · 1 个待处理 · 1 个执行中',
    })
    expect(workspaceAgentSummary([{ ...tab(live.id), kind: 'shell' }])).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
  })

  it('cancels and coalesces pending reads as visible Agent revisions change', async () => {
    const { live, agent, buffered, completion, store } = await prepareAgentScenario()
    const attention = {
      ...completion,
      revision: 6,
      activityState: 'needs-input' as const,
      unread: true,
    }
    store().receiveAgent({ type: 'state', session: attention })
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(live.id)
      const reads = vi.mocked(api.readAgent).mock.calls.length
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
      vi.advanceTimersByTime(500)
      store().receiveAgent({ type: 'state', session: { ...buffered, revision: 8 } })
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      expect(agentIndicatorState(tab(live.id))).toBe('working')
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 9 } })
      vi.advanceTimersByTime(500)
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 10 } })
      vi.advanceTimersByTime(499)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenLastCalledWith(live.id, agent.launchId, 10)
      store().receiveAgent({
        type: 'state',
        session: { ...completion, revision: 11, unread: false },
      })
      store().setVisibleTerminal(undefined)
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads + 1)
      expect(agentIndicatorState(tab(live.id))).toBe('other')
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })

  it('preserves a close error across Agent runtime transitions', async () => {
    const { live, completion, store } = await prepareAgentScenario()
    const attention = {
      ...completion,
      revision: 6,
      activityState: 'needs-input' as const,
      unread: true,
    }
    store().receiveAgent({ type: 'state', session: attention })
    store().receiveAgent({
      type: 'state',
      session: {
        ...attention,
        revision: 12,
        runtimeState: 'stopping',
        activityState: 'unknown',
        unread: false,
      },
    })
    store().updateTab(live.id, { error: '关闭失败：permission denied' })
    store().receiveAgent({
      type: 'state',
      session: {
        ...attention,
        revision: 13,
        runtimeState: 'running',
        activityState: 'unknown',
        observability: 'unavailable',
        unread: false,
      },
    })
    expect(tab(live.id)).toMatchObject({
      status: 'running',
      error: '关闭失败：permission denied',
    })
    expect(agentTabState(tab(live.id))).toBe('other')
  })

  it('isolates manually detected Agent launches on a shell terminal', async () => {
    const { agent, other, store } = await prepareAgentScenario()
    const manual = {
      ...agent,
      terminalId: other.id,
      launchId: crypto.randomUUID(),
      revision: 1,
      activityState: 'working' as const,
    }
    store().receiveAgent({ type: 'state', session: manual })
    expect(tab(other.id)).toMatchObject({ kind: 'shell', status: 'running', agent: manual })
    expect(tab(other.id).launchId).toBeUndefined()
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(tab(other.id).agent).toBeUndefined()
    expect(tab(other.id).status).toBe('running')
    store().receiveAgent({ type: 'state', session: manual })
    expect(tab(other.id).agent).toBeUndefined()
    const restarted = { ...manual, launchId: crypto.randomUUID(), revision: 3 }
    store().receiveAgent({ type: 'state', session: restarted })
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(tab(other.id).agent).toEqual(restarted)
    store().updateTab(other.id, { agent: manual })
    expect(tab(other.id).agent).toEqual(restarted)
  })

  it('acknowledges a failure only after it remains visible', async () => {
    const { live, agent, completion, store } = await prepareAgentScenario()
    const failed = {
      ...tab(live.id),
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(undefined)
      const reads = vi.mocked(api.readAgent).mock.calls.length
      store().receiveAgent({ type: 'state', session: { ...failed.agent, revision: 14 } })
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(500)
      store().setVisibleTerminal(undefined)
      vi.advanceTimersByTime(1000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(999)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      expect(agentIndicatorState(tab(live.id))).toBe('failed')
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenLastCalledWith(live.id, agent.launchId, 14)
      store().receiveAgent({
        type: 'state',
        session: { ...failed.agent, revision: 15, unread: false },
      })
      expect(agentIndicatorState(tab(live.id))).toBe('other')
      expect(agentTabState(tab(live.id))).toBe('failed')
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })

  it('clears transient error indicators without losing the tab error', async () => {
    const { live, completion, store } = await prepareAgentScenario()
    const read = { ...completion, revision: 5, unread: false }
    store().receiveAgent({
      type: 'state',
      session: { ...read, revision: 15, activityState: 'failed', outcome: 'failure' },
    })
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(live.id)
      store().receiveAgent({
        type: 'state',
        session: { ...read, revision: 16, runtimeState: 'error' },
      })
      expect(agentIndicatorState(tab(live.id))).toBe('error')
      vi.advanceTimersByTime(999)
      expect(agentIndicatorState(tab(live.id))).toBe('error')
      vi.advanceTimersByTime(1)
      expect(agentIndicatorState(tab(live.id))).toBe('other')
      expect(agentTabState(tab(live.id))).toBe('error')
      expect(tab(live.id).status).toBe('error')
      store().updateTab(live.id, { title: 'Codex renamed' })
      expect(agentIndicatorState(tab(live.id))).toBe('other')
      store().receiveAgent({ type: 'state', session: { ...read, revision: 17 } })
      store().updateTab(live.id, { status: 'error', error: '连接失败' })
      expect(agentIndicatorState(tab(live.id))).toBe('error')
      vi.advanceTimersByTime(1000)
      expect(agentIndicatorState(tab(live.id))).toBe('other')
      expect(tab(live.id).error).toBe('连接失败')
      expect(api.readAgent).not.toHaveBeenCalled()
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })

  it('ignores Agent state after disconnect and excludes session data from saved layouts', async () => {
    const { live, completion, store } = await prepareAgentScenario()
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 17, unread: false } })
    store().updateTab(live.id, { title: 'Codex renamed', status: 'error', error: '连接失败' })
    store().receiveAgent({ type: 'disconnected' })
    expect(tab(live.id).agent).toMatchObject({
      activityState: 'unknown',
      observability: 'unavailable',
      unread: false,
    })
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
    expect(tab(live.id).agent?.activityState).toBe('unknown')
    const saved = vi.mocked(api.saveLayout).mock.calls.at(-1)![0]
    const savedAgent = saved.tabs.find((item) => item.id === live.id)
    expect(savedAgent).toBeDefined()
    expect(savedAgent).not.toHaveProperty('agent')
    expect(savedAgent).not.toHaveProperty('launchId')
  })
})
