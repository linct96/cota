import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { terminalTabs, useWorkspace } from '../../../src/renderer/src/state/workspace'
import {
  terminalIndicatorState,
  workspaceTerminalSummary as workspaceAgentSummary,
} from '../../../src/renderer/src/features/agents/lib/agent-status'

describe('Shell activity indicators', () => {
  it('shows ordinary shell running and unread completion dots without changing Agent indicators', () => {
    const shell = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectPath: '/tmp/project',
      title: 'Shell',
      kind: 'shell' as const,
      status: 'running' as const,
      shellActivity: 'running' as const,
    }
    expect(terminalIndicatorState(shell)).toBe('running')
    expect(workspaceAgentSummary([shell])).toEqual({
      state: 'running',
      count: 1,
      description: '1 个运行中',
    })
    for (const shellActivity of ['unknown', 'idle', undefined] as const) {
      expect(terminalIndicatorState({ ...shell, shellActivity })).toBe('other')
      expect(workspaceAgentSummary([{ ...shell, shellActivity }])).toBeUndefined()
    }
    for (const status of ['starting', 'exited', 'error'] as const)
      expect(terminalIndicatorState({ ...shell, status })).toBe('other')
    expect(terminalIndicatorState({ ...shell, closingStatus: 'running' })).toBe('other')
    expect(terminalIndicatorState({ ...shell, kind: 'agent' })).toBe('other')
    expect(workspaceAgentSummary([shell, { ...shell, kind: 'agent', status: 'error' }])).toEqual({
      state: 'error',
      count: 1,
      description: '1 个连接失败 · 1 个运行中',
    })

    const store = () => useWorkspace.getState()
    const current = () => store().tabs[0]
    useWorkspace.setState({
      workspaces: [
        {
          id: shell.workspaceId,
          projectPath: shell.projectPath,
          name: '工作区',
          kind: 'local',
        },
      ],
      selectedProject: shell.projectPath,
      activeTabs: { [shell.workspaceId]: shell.id },
      tabs: [{ ...shell, shellActivity: undefined }],
    })
    store().updateTab(shell.id, { shellActivity: 'idle' })
    expect(terminalIndicatorState(current())).toBe('other')
    vi.useFakeTimers()
    try {
      store().updateTab(shell.id, { shellActivity: 'running' })
      expect(terminalIndicatorState(current())).toBe('running')
      store().updateTab(shell.id, { shellActivity: 'idle' })
      expect(terminalIndicatorState(current())).toBe('completed')
      expect(workspaceAgentSummary(store().tabs)).toEqual({
        state: 'completed',
        count: 1,
        description: '1 个本轮结束',
      })
      const focused = { ...shell, id: 'focused', shellActivity: 'idle' as const }
      const grouped = terminalTabs({
        tabs: [focused, current()],
        closingTerminalTabs: [],
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
                { type: 'terminal', id: shell.id },
              ],
            },
          },
        ],
      })[0]
      expect(grouped.indicatorTab).toBe(current())
      vi.advanceTimersByTime(5000)
      expect(current().shellUnread).toBe(true)
      store().setVisibleTerminal(shell.id)
      vi.advanceTimersByTime(999)
      expect(terminalIndicatorState(current())).toBe('completed')
      store().updateTab(shell.id, { title: 'Shell renamed' })
      vi.advanceTimersByTime(1)
      expect(terminalIndicatorState(current())).toBe('other')
      expect(workspaceAgentSummary(store().tabs)).toBeUndefined()
      store().updateTab(shell.id, { shellActivity: 'idle' })
      expect(terminalIndicatorState(current())).toBe('other')

      store().updateTab(shell.id, { shellActivity: 'running' })
      expect(current().shellUnread).toBe(false)
      store().updateTab(shell.id, { shellActivity: 'idle' })
      vi.advanceTimersByTime(500)
      store().setVisibleTerminal(undefined)
      vi.advanceTimersByTime(3000)
      expect(terminalIndicatorState(current())).toBe('completed')
      store().setVisibleTerminal(shell.id)
      vi.advanceTimersByTime(500)
      store().updateTab(shell.id, { shellActivity: 'running' })
      vi.advanceTimersByTime(1000)
      expect(terminalIndicatorState(current())).toBe('running')
      store().updateTab(shell.id, { shellActivity: 'idle' })
      vi.advanceTimersByTime(999)
      expect(terminalIndicatorState(current())).toBe('completed')
      vi.advanceTimersByTime(1)
      expect(terminalIndicatorState(current())).toBe('other')
      expect(api.readAgent).not.toHaveBeenCalled()
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })
})
