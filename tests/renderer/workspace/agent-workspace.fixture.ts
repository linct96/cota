import { api } from './workspace.fixture'
import { vi } from 'vitest'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { useWorkspace } from '../../../src/renderer/src/state/workspace'

export async function restoreAgentWorkspace() {
  const path = '/tmp/project'
  const workspace = {
    id: crypto.randomUUID(),
    projectPath: path,
    name: 'Agent 实验',
    kind: 'local' as const,
  }
  const live = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    projectPath: path,
    title: 'Codex',
    kind: 'agent' as const,
    provider: 'codex' as const,
    cwd: path,
    workspaceKind: 'local' as const,
  }
  const agent = {
    terminalId: live.id,
    projectPath: path,
    workspaceId: workspace.id,
    cwd: path,
    revision: 2,
    unread: false,
    launchId: crypto.randomUUID(),
    provider: 'codex' as const,
    runtimeState: 'running' as const,
    activityState: 'unknown' as const,
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
    eventSource: 'process' as const,
    observability: 'unavailable' as const,
  }
  const other = {
    ...live,
    id: crypto.randomUUID(),
    title: 'Shell',
    kind: 'shell' as const,
    provider: undefined,
  }
  const lost = { ...live, id: crypto.randomUUID() }
  const orphan = {
    ...other,
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    cols: 80,
    rows: 24,
    exited: true,
    exitCode: 7,
  }
  vi.mocked(api.bootstrap).mockResolvedValueOnce({
    ok: true,
    value: {
      config: {
        ...structuredClone(DEFAULT_CONFIG),
        recentProjects: [path],
        layout: {
          workspaces: [workspace],
          tabs: [other, live, lost],
          selectedProject: path,
          selectedWorkspaces: { [path]: workspace.id },
          activeTabs: { [workspace.id]: live.id },
        },
      },
      sessions: [other, live]
        .map((tab) => ({
          ...tab,
          cols: 80,
          rows: 24,
          exited: false,
          ...(tab.id === live.id ? { agent } : {}),
        }))
        .concat(orphan),
    },
  })
  const buffered = { ...agent, revision: 3, activityState: 'working' as const }
  useWorkspace.getState().receiveAgent({ type: 'state', session: buffered })
  await useWorkspace.getState().bootstrap()
  return { path, workspace, live, agent, other, lost, orphan, buffered }
}
