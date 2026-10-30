import { pruneTerminalLayouts } from '../../../../shared/terminal-layout'
import { AGENT_PROVIDERS, unwrap, type TerminalSession } from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { WorkspaceState, TerminalTab } from './types'
import { createWorkspace } from './workspace-actions'
import { currentWorkspace, nextWorkspaceName } from './selectors'

export const createBootstrapActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<WorkspaceState, 'bootstrap'>
> = (set, get) => {
  return {
    async bootstrap() {
      try {
        const { config, sessions, warning, worktreeScans } = unwrap(
          await window.desktop.bootstrap(),
        )
        if (warning) console.warn(warning)
        const layout = config.layout
        const workspaces = [...(layout?.workspaces || [])]
        const tabs: TerminalTab[] = []
        const orphanSessions: TerminalSession[] = []
        for (const session of sessions) {
          const bound = workspaces.find((workspace) => workspace.id === session.workspaceId)
          const record = config.worktreeRecords.find((entry) => entry.id === session.worktreeId)
          if (
            (bound &&
              (bound.projectPath !== session.projectPath ||
                bound.kind !== session.workspaceKind)) ||
            (session.workspaceKind === 'git-worktree' &&
              (!bound ||
                bound.kind !== 'git-worktree' ||
                bound.worktreeId !== session.worktreeId ||
                record?.path !== session.cwd ||
                record?.repoCommonDir !== session.repoCommonDir)) ||
            (session.workspaceKind === 'local' && session.cwd !== session.projectPath)
          ) {
            orphanSessions.push(session)
            continue
          }
          if (!config.recentProjects.includes(session.projectPath)) continue
          if (!workspaces.some((workspace) => workspace.id === session.workspaceId))
            workspaces.push({
              id: session.workspaceId,
              projectPath: session.projectPath,
              name: nextWorkspaceName(session.projectPath, workspaces),
              kind: 'local',
            })
          const saved = layout?.tabs.find(
            (tab) =>
              tab.id === session.id &&
              tab.workspaceId === session.workspaceId &&
              tab.projectPath === session.projectPath,
          )
          tabs.push({
            id: session.id,
            projectPath: session.projectPath,
            workspaceId: session.workspaceId,
            title:
              ((saved?.kind === 'agent') === (session.kind === 'agent') &&
              saved?.provider === session.provider
                ? saved?.title
                : undefined) ||
              (session.provider
                ? `${AGENT_PROVIDERS[session.provider].name} · ${tabs.length + 1}`
                : undefined) ||
              `Terminal ${tabs.length + 1}`,
            kind: session.kind,
            service: session.service,
            provider: session.provider,
            launchId: session.kind === 'agent' ? session.agent?.launchId : undefined,
            agent: session.agent,
            agentRevision: session.agent?.revision ?? session.agentRevision,
            cwd: session.cwd,
            status: session.exited ? 'exited' : 'running',
            shellActivity: session.shellActivity,
            exitCode: session.exitCode,
          })
        }
        const savedOrder = new Map(layout?.tabs.map((tab, index) => [tab.id, index]))
        tabs.sort((a, b) => (savedOrder.get(a.id) ?? Infinity) - (savedOrder.get(b.id) ?? Infinity))
        for (const path of config.recentProjects)
          if (!workspaces.some((workspace) => workspace.projectPath === path))
            workspaces.push(createWorkspace(path))
        const activeTabs: Record<string, string> = {}
        for (const tab of tabs) {
          if (!activeTabs[tab.workspaceId] || layout?.activeTabs[tab.workspaceId] === tab.id)
            activeTabs[tab.workspaceId] = tab.id
        }
        const selectedWorkspaces = layout?.selectedWorkspaces || {}
        const selectedWorkspace = currentWorkspace({
          workspaces,
          selectedProject: layout?.selectedProject,
          selectedWorkspaces,
        })
        set({
          ready: true,
          bootstrapError: undefined,
          layoutLoaded: true,
          projects: config.recentProjects,
          workspaces,
          selectedProject: tabs.some((tab) => tab.workspaceId === selectedWorkspace?.id)
            ? layout?.selectedProject
            : undefined,
          selectedWorkspaces,
          tabs,
          terminalLayouts: pruneTerminalLayouts(
            layout?.terminalLayouts || [],
            new Set(tabs.map((tab) => tab.id)),
          ),
          activeTabs,
          preferences: config.preferences,
          worktreeRecords: config.worktreeRecords,
          worktreeScans: worktreeScans || {},
          orphanSessions,
        })
        void get().refreshWorkspaceOpeners().catch(console.warn)
        const pending = get().pendingAgentUpdates
        set({ pendingAgentUpdates: {} })
        for (const event of Object.values(pending)) get().receiveAgent(event)
        if (get().agentConnectionLost) get().receiveAgent({ type: 'disconnected' })
      } catch (error) {
        console.error(error)
        set({ ready: true, bootstrapError: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}
