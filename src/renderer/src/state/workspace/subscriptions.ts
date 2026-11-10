import { useSourceControl } from '../source-control-store'
import { terminalIndicatorState } from '../../features/agents/lib/agent-status'
import { pruneTerminalLayouts } from '../../../../shared/terminal-layout'
import { unwrap } from '../../../../shared/contracts'
import type { AgentSession, WorkspaceLayout } from '../../../../shared/contracts'
import type { StoreApi } from 'zustand'
import type { WorkspaceState } from './types'
import { currentWorkspace, terminalTabs } from './selectors'

export function savedLayout(state: WorkspaceState): WorkspaceLayout {
  const workspaces = state.workspaces.filter((workspace) =>
    state.projects.includes(workspace.projectPath),
  )
  return {
    workspaces,
    tabs: state.tabs
      .filter((tab) => workspaces.some((workspace) => workspace.id === tab.workspaceId))
      .map(({ id, projectPath, workspaceId, title, kind, provider }) => ({
        id,
        projectPath,
        workspaceId,
        title,
        ...(kind === 'agent' ? { kind, provider } : {}),
      })),
    ...(state.terminalLayouts.length
      ? {
          terminalLayouts: pruneTerminalLayouts(
            state.terminalLayouts,
            new Set(state.tabs.map((tab) => tab.id)),
          ),
        }
      : {}),
    selectedProject: state.selectedProject,
    selectedWorkspaces: state.selectedWorkspaces,
    activeTabs: state.activeTabs,
  }
}

export function installWorkspaceSubscriptions(store: StoreApi<WorkspaceState>) {
  let completionRead:
    | {
        terminalId: string
        launchId?: string
        lastTurnId?: string
        timer: ReturnType<typeof setTimeout>
      }
    | undefined

  function markAgentRead(agent: AgentSession): void {
    void window.desktop
      .readAgent(agent.terminalId, agent.launchId, agent.revision)
      .then(unwrap)
      .catch((error) => console.warn('无法标记 Agent 状态已读。', error))
  }

  function readVisibleTerminal(state: WorkspaceState): void {
    const tab = state.tabs.find(
      (candidateTab) =>
        candidateTab.id === state.visibleTerminal &&
        !candidateTab.closingStatus &&
        candidateTab.workspaceId === currentWorkspace(state)?.id &&
        state.activeTabs[candidateTab.workspaceId] === candidateTab.id,
    )
    const agent = !state.agentConnectionLost ? tab?.agent : undefined
    const shellCompleted = !!tab && !tab.agent && terminalIndicatorState(tab) === 'completed'
    const errorUnread = !!tab && terminalIndicatorState(tab) === 'error'
    const completed =
      (agent?.runtimeState === 'running' &&
        (agent.activityState === 'completed' || agent.activityState === 'failed')) ||
      shellCompleted ||
      errorUnread
    const unread = agent?.unread || shellCompleted || errorUnread
    if (
      completionRead &&
      (!completed ||
        !unread ||
        completionRead.terminalId !== tab?.id ||
        completionRead.launchId !== agent?.launchId ||
        completionRead.lastTurnId !== agent?.lastTurnId)
    ) {
      clearTimeout(completionRead.timer)
      completionRead = undefined
    }
    if (!unread || !tab) return
    if (!completed) {
      if (agent) markAgentRead(agent)
      return
    }
    if (completionRead) return
    completionRead = {
      terminalId: tab.id,
      launchId: agent?.launchId,
      lastTurnId: agent?.lastTurnId,
      timer: setTimeout(() => {
        completionRead = undefined
        const current = store.getState().tabs.find((item) => item.id === tab.id)
        if (current && terminalIndicatorState(current) === 'error')
          store.getState().updateTab(current.id, { errorRead: true })
        else if (current?.agent?.unread) markAgentRead(current.agent)
        else if (current && terminalIndicatorState(current) === 'completed')
          store.getState().updateTab(current.id, { shellUnread: false })
      }, 1000),
    }
  }
  const unsubscribeLayout = store.subscribe((state, previous) => {
    if (!state.layoutLoaded || state.layoutFrozen) return
    const layout = savedLayout(state)
    if (
      previous.layoutLoaded &&
      !previous.layoutFrozen &&
      JSON.stringify(layout) === JSON.stringify(savedLayout(previous))
    )
      return
    void window.desktop
      .saveLayout(layout)
      .then(unwrap)
      .catch((error) => console.error(error))
  })
  const unsubscribeTabOrder = store.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.terminalLayouts === previous.terminalLayouts) return
    const workspaceIds = new Set([...state.tabs, ...previous.tabs].map((tab) => tab.workspaceId))
    for (const id of workspaceIds)
      useSourceControl.getState().syncTerminals(
        id,
        terminalTabs(state)
          .filter((tab) => tab.workspaceId === id)
          .map((tab) => tab.id),
      )
  })
  const unsubscribeTerminalRead = store.subscribe(readVisibleTerminal)

  return () => {
    unsubscribeLayout()
    unsubscribeTabOrder()
    unsubscribeTerminalRead()
    if (completionRead) clearTimeout(completionRead.timer)
  }
}
