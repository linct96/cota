import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { terminalTabs, useWorkspace } from '../../../src/renderer/src/state/workspace'
import {
  terminalIndicatorState,
  workspaceTerminalSummary as workspaceAgentSummary,
} from '../../../src/renderer/src/features/agents/lib/agent-status'

function shellFixture() {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectPath: '/tmp/project',
    title: 'Shell',
    kind: 'shell' as const,
    status: 'running' as const,
    shellActivity: 'running' as const,
  }
}

function workspaceShell() {
  const shell = shellFixture()
  useWorkspace.setState({
    workspaces: [
      { id: shell.workspaceId, projectPath: shell.projectPath, name: '工作区', kind: 'local' },
    ],
    selectedProject: shell.projectPath,
    activeTabs: { [shell.workspaceId]: shell.id },
    tabs: [{ ...shell, shellActivity: undefined }],
  })
  return shell
}

const store = () => useWorkspace.getState()

describe('Shell activity indicators', () => {
  it('summarizes an ordinary running shell', () => {
    const shell = shellFixture()
    expect(terminalIndicatorState(shell)).toBe('running')
    expect(workspaceAgentSummary([shell])).toEqual({
      state: 'running',
      count: 1,
      description: '1 个运行中',
    })
  })

  it.each(['unknown', 'idle', undefined] as const)(
    'does not show activity for shell state %s',
    (shellActivity) => {
      const shell = { ...shellFixture(), shellActivity }
      expect(terminalIndicatorState(shell)).toBe('other')
      expect(workspaceAgentSummary([shell])).toBeUndefined()
    },
  )

  it.each(['starting', 'exited', 'error'] as const)(
    'does not show activity for terminal status %s',
    (status) => {
      expect(terminalIndicatorState({ ...shellFixture(), status })).toBe('other')
    },
  )

  it('keeps closing shells and Agent terminals out of shell indicators', () => {
    const shell = shellFixture()
    expect(terminalIndicatorState({ ...shell, closingStatus: 'running' })).toBe('other')
    expect(terminalIndicatorState({ ...shell, kind: 'agent' })).toBe('other')
    expect(workspaceAgentSummary([shell, { ...shell, kind: 'agent', status: 'error' }])).toEqual({
      state: 'error',
      count: 1,
      description: '1 个连接失败 · 1 个运行中',
    })
  })

  it('keeps a completed shell unread until it has been visible for one second', () => {
    const shell = workspaceShell()
    const current = () => store().tabs.find((entry) => entry.id === shell.id)!
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
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
  })

  it('shows a completed shell on its split group even when another pane is focused', () => {
    const shell = workspaceShell()
    store().updateTab(shell.id, { shellActivity: 'idle' })
    store().updateTab(shell.id, { shellActivity: 'running' })
    store().updateTab(shell.id, { shellActivity: 'idle' })
    const current = store().tabs.find((entry) => entry.id === shell.id)!
    const focused = { ...shell, id: 'focused', shellActivity: 'idle' as const }
    const grouped = terminalTabs({
      tabs: [focused, current],
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
    expect(grouped.indicatorTab).toBe(current)
  })

  it('cancels a visibility timer when the shell is hidden or starts running again', () => {
    const shell = workspaceShell()
    const current = () => store().tabs.find((entry) => entry.id === shell.id)!
    store().updateTab(shell.id, { shellActivity: 'idle' })
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(shell.id)
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
