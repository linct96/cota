import type { TerminalTab } from '../store'

export type AgentDisplayState =
  | 'other'
  | 'working'
  | 'needs-input'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'error'
export const AGENT_STATE_LABELS: Record<AgentDisplayState, string> = {
  other: '其他状态',
  error: '连接失败',
  working: '执行中',
  'needs-input': '待处理',
  completed: '本轮结束',
  succeeded: '已完成',
  failed: '执行失败',
  interrupted: '已中断',
}

export function agentTabState(tab: TerminalTab): AgentDisplayState {
  if (tab.closingStatus) return 'other'
  if (tab.status === 'error') return 'error'
  const runtime = tab.agent?.runtimeState ?? tab.status
  if (runtime !== 'running') return runtime === 'error' ? 'error' : 'other'
  const activity = tab.agent?.activityState
  if (!activity || activity === 'idle' || activity === 'unknown') return 'other'
  return activity === 'completed' && tab.agent?.outcome === 'success' ? 'succeeded' : activity
}

export function agentIndicatorState(tab: TerminalTab): AgentDisplayState {
  const state = agentTabState(tab)
  return (state === 'completed' || state === 'succeeded') && !tab.agent?.unread ? 'other' : state
}

export type TerminalDisplayState = AgentDisplayState | 'running'
export const TERMINAL_STATE_LABELS: Record<TerminalDisplayState, string> = {
  ...AGENT_STATE_LABELS,
  running: '运行中',
}

export function terminalIndicatorState(tab: TerminalTab): TerminalDisplayState {
  if (tab.kind === 'agent' || tab.provider || tab.agent) return agentIndicatorState(tab)
  return !tab.closingStatus && tab.status === 'running' && tab.shellActivity === 'running'
    ? 'running'
    : 'other'
}

export function workspaceTerminalSummary(tabs: TerminalTab[]) {
  const states = tabs
    .filter(
      (tab) =>
        tab.kind === 'agent' ||
        tab.provider ||
        tab.agent ||
        terminalIndicatorState(tab) === 'running',
    )
    .map((tab) => {
      const state = terminalIndicatorState(tab)
      return state === 'failed' && !tab.agent?.unread ? 'other' : state
    })
  const priority: TerminalDisplayState[] = [
    'needs-input',
    'error',
    'failed',
    'working',
    'running',
    'succeeded',
    'completed',
    'interrupted',
    'other',
  ]
  const counts = priority.flatMap((state) => {
    const count = states.filter((value) => value === state).length
    return count ? [{ state, count }] : []
  })
  if (!counts.length) return undefined
  return {
    ...counts[0],
    description: counts
      .map(({ state, count }) => `${count} 个${TERMINAL_STATE_LABELS[state]}`)
      .join(' · '),
  }
}
