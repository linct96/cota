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

export function workspaceAgentSummary(tabs: TerminalTab[]) {
  const states = tabs
    .filter((tab) => tab.kind === 'agent' || tab.provider || tab.agent)
    .map((tab) => {
      const state = agentIndicatorState(tab)
      return state === 'failed' && !tab.agent?.unread ? 'other' : state
    })
  const priority: AgentDisplayState[] = [
    'needs-input',
    'error',
    'failed',
    'working',
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
      .map(({ state, count }) => `${count} 个${AGENT_STATE_LABELS[state]}`)
      .join(' · '),
  }
}
