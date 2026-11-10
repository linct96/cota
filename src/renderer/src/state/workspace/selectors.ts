import {
  terminalIndicatorState,
  workspaceTerminalSummary,
} from '../../features/agents/lib/agent-status'
import { terminalPaneIds } from '../../../../shared/terminal-layout'
import type { ProjectWorkspace } from '../../../../shared/contracts'
import type { TerminalTab, WorkspaceState } from './types'

export function nextWorkspaceName(path: string, workspaces: ProjectWorkspace[]): string {
  const numbers = workspaces
    .filter((workspace) => workspace.projectPath === path)
    .map((workspace) =>
      workspace.name === '工作区' ? 1 : Number(/^工作区 (\d+)$/.exec(workspace.name)?.[1] || 0),
    )
    .filter(Number.isSafeInteger)
  const next = Math.max(0, ...numbers) + 1
  return next === 1 ? '工作区' : `工作区 ${next}`
}

export function currentWorkspace(
  state: Pick<WorkspaceState, 'workspaces' | 'selectedProject' | 'selectedWorkspaces'>,
): ProjectWorkspace | undefined {
  const workspaces = state.workspaces.filter(
    (workspace) => workspace.projectPath === state.selectedProject,
  )
  return (
    workspaces.find(
      (workspace) => workspace.id === state.selectedWorkspaces[state.selectedProject || ''],
    ) || workspaces[0]
  )
}

export function terminalTabId(state: Pick<WorkspaceState, 'terminalLayouts'>, id: string): string {
  return (
    state.terminalLayouts.find(
      (group) => group.id === id || terminalPaneIds(group.root).includes(id),
    )?.id || id
  )
}

export function terminalTabs(
  state: Pick<WorkspaceState, 'tabs' | 'terminalLayouts' | 'closingTerminalTabs'>,
): (TerminalTab & { indicatorTab?: TerminalTab })[] {
  const seen = new Set<string>()
  return state.tabs.flatMap((tab) => {
    const group = state.terminalLayouts.find((candidateGroup) =>
      terminalPaneIds(candidateGroup.root).includes(tab.id),
    )
    const id = group?.id || tab.id
    if (seen.has(id)) return []
    seen.add(id)
    if (!group) return [tab]
    const ids = terminalPaneIds(group.root)
    const panes = state.tabs.filter((pane) => ids.includes(pane.id))
    const focused = panes.find((pane) => pane.id === group.activePaneId) || panes[0]
    const indicatorState = workspaceTerminalSummary(panes)?.state
    const indicatorTab =
      indicatorState !== 'other'
        ? [focused, ...panes].find((pane) => terminalIndicatorState(pane) === indicatorState)
        : undefined
    return [
      {
        ...focused,
        id,
        indicatorTab: indicatorTab || focused,
        status: panes.some((pane) => pane.status === 'starting')
          ? ('starting' as const)
          : focused.status,
        closingStatus: state.closingTerminalTabs.includes(id)
          ? focused.status
          : panes.find((pane) => pane.closingStatus)?.closingStatus,
      },
    ]
  })
}
