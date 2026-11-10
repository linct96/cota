import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { terminalTabs, useWorkspace } from '../../../src/renderer/src/state/workspace'
import type { TerminalTab } from '../../../src/renderer/src/state/workspace'
import {
  agentIndicatorState,
  agentTabState,
  workspaceTerminalSummary as workspaceAgentSummary,
} from '../../../src/renderer/src/features/agents/lib/agent-status'

import { restoreAgentWorkspace } from './agent-workspace.fixture'

describe('Workspace Agent state and unread indicators', () => {
  it('prioritizes Agent outcomes and indicators across terminal groups', async () => {
    const { workspace, live, other, buffered } = await restoreAgentWorkspace()
    const store = () => useWorkspace.getState()
    const completion = {
      ...buffered,
      revision: 4,
      activityState: 'completed' as const,
      unread: true,
    }
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
    expect(workspaceAgentSummary([store().tabs[0]])).toBeUndefined()
    for (const status of ['starting', 'running', 'error', 'exited'] as const) {
      expect(workspaceAgentSummary([{ ...store().tabs[1], agent: undefined, status }])?.state).toBe(
        status === 'error' ? 'error' : 'other',
      )
    }
    for (const runtimeState of ['starting', 'stopping', 'exited'] as const) {
      expect(
        agentIndicatorState({ ...store().tabs[1], agent: { ...completion, runtimeState } }),
      ).toBe('other')
    }
    for (const activityState of ['idle', 'unknown'] as const) {
      expect(
        agentIndicatorState({ ...store().tabs[1], agent: { ...completion, activityState } }),
      ).toBe('other')
    }
    expect(agentTabState({ ...store().tabs[1], closingStatus: 'running' })).toBe('other')
    expect(agentTabState(store().tabs[1])).toBe('completed')
    const failed = {
      ...store().tabs[1],
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
    const succeeded = { ...store().tabs[1], agent: { ...completion, outcome: 'success' as const } }
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
    const groupIndicator = (background: TerminalTab, focused = store().tabs[0]) =>
      terminalTabs({
        ...store(),
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
      })[0]
    for (const background of [working, succeeded, store().tabs[1], failed]) {
      const grouped = groupIndicator(background)
      expect(grouped.indicatorTab).toBe(background)
      expect(grouped).toMatchObject({ id: 'group', kind: 'shell', cwd: other.cwd })
    }
    const focusedAgent = { ...succeeded, id: other.id }
    expect(groupIndicator(working, focusedAgent).indicatorTab).toBe(focusedAgent)
    expect(groupIndicator(succeeded, focusedAgent).indicatorTab).toBe(focusedAgent)
    expect(groupIndicator(failed, focusedAgent).indicatorTab).toBe(failed)
    const connectionError = { ...focusedAgent, status: 'error' as const }
    expect(groupIndicator(succeeded, connectionError).indicatorTab).toBe(connectionError)
    expect(groupIndicator(succeeded, { ...store().tabs[0], status: 'error' }).indicatorTab).toBe(
      succeeded,
    )
    for (const background of [
      { ...succeeded, agent: { ...succeeded.agent, unread: false } },
      { ...failed, agent: { ...failed.agent, unread: false } },
      { ...failed, status: 'error' as const, errorRead: true },
      { ...working, closingStatus: 'running' as const },
      { ...working, agent: { ...buffered, runtimeState: 'exited' as const } },
      { ...working, agent: { ...buffered, activityState: 'idle' as const } },
    ]) {
      expect(groupIndicator(background).indicatorTab).toBe(store().tabs[0])
    }
  })

  it('acknowledges only visible current Agent revisions and rejects stale shell identities', async () => {
    const { live, agent, other, buffered } = await restoreAgentWorkspace()
    const store = () => useWorkspace.getState()
    const completion = {
      ...buffered,
      revision: 4,
      activityState: 'completed' as const,
      unread: true,
    }
    store().receiveAgent({ type: 'state', session: completion })
    const succeeded = { ...store().tabs[1], agent: { ...completion, outcome: 'success' as const } }
    const failed = {
      ...store().tabs[1],
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    const working = { ...failed, agent: buffered }
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
      expect(store().tabs[1].agent?.unread).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    const read = { ...completion, revision: 5, unread: false }
    store().receiveAgent({ type: 'state', session: read })
    expect(store().tabs[1].agent?.activityState).toBe('completed')
    expect(agentTabState(store().tabs[1])).toBe('completed')
    expect(agentIndicatorState(store().tabs[1])).toBe('other')
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
    store().receiveAgent({ type: 'state', session: completion })
    store().receiveAgent({
      type: 'state',
      session: { ...completion, revision: 6, launchId: crypto.randomUUID() },
    })
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 6, cwd: '/wrong' } })
    expect(store().tabs[1].agent).toEqual(read)
    const attention = { ...read, revision: 6, activityState: 'needs-input' as const, unread: true }
    store().setVisibleTerminal(undefined)
    store().receiveAgent({ type: 'state', session: attention })
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
    expect(workspaceAgentSummary([failed, working, store().tabs[1]])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败 · 1 个待处理 · 1 个执行中',
    })
    expect(workspaceAgentSummary([{ ...store().tabs[1], kind: 'shell' }])).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(live.id)
      const reads = vi.mocked(api.readAgent).mock.calls.length
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
      vi.advanceTimersByTime(500)
      store().receiveAgent({ type: 'state', session: { ...buffered, revision: 8 } })
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      expect(agentIndicatorState(store().tabs[1])).toBe('working')
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
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
    } finally {
      vi.useRealTimers()
    }
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
    expect(store().tabs[1]).toMatchObject({
      status: 'running',
      error: '关闭失败：permission denied',
    })
    expect(agentTabState(store().tabs[1])).toBe('other')
    const manual = {
      ...agent,
      terminalId: other.id,
      launchId: crypto.randomUUID(),
      revision: 1,
      activityState: 'working' as const,
    }
    store().receiveAgent({ type: 'state', session: manual })
    expect(store().tabs[0]).toMatchObject({ kind: 'shell', status: 'running', agent: manual })
    expect(store().tabs[0].launchId).toBeUndefined()
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(store().tabs[0].agent).toBeUndefined()
    expect(store().tabs[0].status).toBe('running')
    store().receiveAgent({ type: 'state', session: manual })
    expect(store().tabs[0].agent).toBeUndefined()
    const restarted = { ...manual, launchId: crypto.randomUUID(), revision: 3 }
    store().receiveAgent({ type: 'state', session: restarted })
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(store().tabs[0].agent).toEqual(restarted)
    store().updateTab(other.id, { agent: manual })
    expect(store().tabs[0].agent).toEqual(restarted)
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
      expect(agentIndicatorState(store().tabs[1])).toBe('failed')
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenLastCalledWith(live.id, agent.launchId, 14)
      store().receiveAgent({
        type: 'state',
        session: { ...failed.agent, revision: 15, unread: false },
      })
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
      expect(agentTabState(store().tabs[1])).toBe('failed')
      store().receiveAgent({
        type: 'state',
        session: { ...read, revision: 16, runtimeState: 'error' },
      })
      expect(agentIndicatorState(store().tabs[1])).toBe('error')
      vi.advanceTimersByTime(999)
      expect(agentIndicatorState(store().tabs[1])).toBe('error')
      vi.advanceTimersByTime(1)
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
      expect(agentTabState(store().tabs[1])).toBe('error')
      expect(store().tabs[1].status).toBe('error')
      store().updateTab(live.id, { title: 'Codex renamed' })
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
      store().receiveAgent({ type: 'state', session: { ...read, revision: 17 } })
      store().updateTab(live.id, { status: 'error', error: '连接失败' })
      expect(agentIndicatorState(store().tabs[1])).toBe('error')
      vi.advanceTimersByTime(1000)
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
      expect(store().tabs[1].error).toBe('连接失败')
      expect(api.readAgent).toHaveBeenCalledTimes(reads + 1)
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
    store().receiveAgent({ type: 'disconnected' })
    expect(store().tabs[1].agent).toMatchObject({
      activityState: 'unknown',
      observability: 'unavailable',
      unread: false,
    })
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
    expect(store().tabs[1].agent?.activityState).toBe('unknown')
    const saved = vi.mocked(api.saveLayout).mock.calls.at(-1)![0]
    expect(saved.tabs[1]).not.toHaveProperty('agent')
    expect(saved.tabs[1]).not.toHaveProperty('launchId')
  })
})
