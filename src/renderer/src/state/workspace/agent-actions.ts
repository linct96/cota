import { MAX_TERMINALS, unwrap } from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { WorkspaceState } from './types'

export const createAgentActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<WorkspaceState, 'receiveAgent' | 'setVisibleTerminal'>
> = (set, get) => {
  return {
    receiveAgent(event) {
      if (event.type === 'disconnected') {
        set((state) => ({
          agentConnectionLost: true,
          tabs: state.tabs.map((tab) =>
            tab.agent
              ? {
                  ...tab,
                  agent: {
                    ...tab.agent,
                    activityState: 'unknown',
                    outcome: 'unknown',
                    workingChildren: 0,
                    waitingChildren: 0,
                    unread: false,
                    observability: 'unavailable',
                    observabilityReason: 'Terminal Host 已断开；重新打开应用后尝试恢复。',
                  },
                }
              : tab,
          ),
        }))
        return
      }
      if (get().agentConnectionLost) return
      const terminalId = event.type === 'state' ? event.session.terminalId : event.terminalId
      const revision = event.type === 'state' ? event.session.revision : event.revision
      if (!get().layoutLoaded) {
        const previous = get().pendingAgentUpdates[terminalId]
        const previousRevision =
          previous?.type === 'state' ? previous.session.revision : previous?.revision
        if (previousRevision === undefined || previousRevision < revision)
          set((state) => ({
            pendingAgentUpdates: {
              ...Object.fromEntries(
                Object.entries(state.pendingAgentUpdates).slice(-MAX_TERMINALS),
              ),
              [terminalId]: event,
            },
          }))
        return
      }
      if (event.type === 'removed') {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === event.terminalId &&
            (tab.agentRevision ?? tab.agent?.revision ?? 0) < event.revision &&
            (tab.kind !== 'agent' || !tab.agent || tab.agent.launchId === event.launchId)
              ? { ...tab, agent: undefined, agentRevision: event.revision }
              : tab,
          ),
        }))
        return
      }
      const agent = event.session
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (
            tab.id !== agent.terminalId ||
            (tab.kind === 'agent' &&
              (tab.launchId !== agent.launchId || tab.provider !== agent.provider)) ||
            tab.projectPath !== agent.projectPath ||
            tab.workspaceId !== agent.workspaceId ||
            (tab.cwd && tab.cwd !== agent.cwd) ||
            (tab.agentRevision ?? tab.agent?.revision ?? 0) >= agent.revision
          )
            return tab
          return {
            ...tab,
            agent,
            shellUnread: false,
            ...(tab.agent?.runtimeState !== agent.runtimeState ||
            tab.agent.launchId !== agent.launchId
              ? { errorRead: false }
              : {}),
            agentRevision: agent.revision,
            cwd: agent.cwd,
            ...(tab.kind === 'agent'
              ? {
                  exitCode: agent.exitCode,
                  status: agent.runtimeState === 'stopping' ? tab.status : agent.runtimeState,
                }
              : {}),
          }
        }),
      }))
    },

    setVisibleTerminal(id) {
      set({ visibleTerminal: id })
      void window.desktop
        .setVisibleTerminal(id)
        .then(unwrap)
        .catch((error) => console.warn('无法同步当前可见终端。', error))
    },
  }
}
