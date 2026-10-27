import { create } from 'zustand'
import { useSourceControl } from './lib/source-control-store'
import { useRightPanel } from './lib/right-panel-store'
import { terminalIndicatorState, workspaceTerminalSummary } from './lib/agent-status'
import { gitFileKey } from '../../shared/source-control'
import {
  mapTerminalPane,
  pruneTerminalLayouts,
  removeTerminalPanes,
  terminalPaneIds,
  type TerminalPane,
  type TerminalLayout,
} from '../../shared/terminal-layout'
import {
  DEFAULT_CONFIG,
  MAX_TERMINALS,
  AGENT_PROVIDERS,
  type AgentProvider,
  type AgentSession,
  type AgentUpdate,
  unwrap,
  type Preferences,
  type WorkspaceOpener,
  type ProjectWorkspace,
  type WorkspaceLayout,
  type Shortcut,
  type CreateWorktreeInput,
  type CreateWorktreeResult,
  type WorktreeRecord,
  type WorktreeScan,
  type TerminalSession,
} from '../../shared/contracts'

export type { ProjectWorkspace } from '../../shared/contracts'

export interface TerminalTab {
  id: string
  projectPath: string
  workspaceId: string
  title: string
  kind?: 'shell' | 'agent'
  provider?: AgentProvider
  launchId?: string
  agent?: AgentSession
  agentRevision?: number
  cwd?: string
  status: 'starting' | 'running' | 'exited' | 'error'
  shellActivity?: import('../../shared/contracts').ShellActivity
  // shortcut: 完成未读仅保留在 Renderer；需要跨应用重启恢复时再迁移到 Host。
  shellUnread?: boolean
  exitCode?: number
  error?: string
  startupCommand?: string
  service?: import('../../shared/contracts').TerminalService
  closingStatus?: TerminalTab['status']
}

interface Workspace {
  bootstrapError?: string
  ready: boolean
  layoutLoaded: boolean
  projects: string[]
  selectedProject?: string
  workspaces: ProjectWorkspace[]
  selectedWorkspaces: Record<string, string>
  removingWorkspace?: string
  preferences: Preferences
  workspaceOpeners: WorkspaceOpener[]
  refreshWorkspaceOpeners(): Promise<void>
  tabs: TerminalTab[]
  terminalLayouts: TerminalLayout[]
  closingTerminalTabs: string[]
  pendingAgentUpdates: Record<string, Exclude<AgentUpdate, { type: 'disconnected' }>>
  agentConnectionLost: boolean
  visibleTerminal?: string
  receiveAgent(event: AgentUpdate): void
  setVisibleTerminal(id?: string): void
  activeTabs: Record<string, string>
  lastClosedWorkspaceId?: string
  focusVersion: number
  worktreeRecords: WorktreeRecord[]
  worktreeScans: Record<string, WorktreeScan>
  worktreeError?: string
  orphanSessions: TerminalSession[]
  creatingWorktree: boolean
  createGitWorktree(input: CreateWorktreeInput & { planId: string }): Promise<CreateWorktreeResult>
  refreshWorktrees(path: string): Promise<void>
  removeWorktree(id: string, deleteBranch?: boolean, unlink?: boolean): Promise<void>
  bootstrap(): Promise<void>
  openProject(): Promise<void>
  selectProject(path: string, workspaceId?: string): Promise<boolean>
  newWorkspace(path: string, name?: string): Promise<boolean>
  renameWorkspace(id: string, name: string): boolean
  removeWorkspace(id: string): Promise<boolean>
  removeProject(path: string): Promise<boolean>
  newTerminal(
    provider?: AgentProvider,
    workspaceId?: string,
    command?: import('../../shared/contracts').QuickCommand,
  ): string | undefined
  recentQuickCommands: Record<string, string>
  runQuickCommand(id: string, workspaceId: string): void
  splitTerminal(id: string, direction?: 'horizontal' | 'vertical'): void
  resizeTerminalSplit(id: string, ratio: number): void
  reopenTab(): void
  selectTab(id: string): void
  selectWorkspaceTab(workspaceId: string, key: string): void
  closeWorkspaceTab(workspaceId: string, key: string): void
  reorderTab(workspaceId: string, id: string, toIndex: number): void
  updateTab(id: string, value: Partial<TerminalTab>): void
  closeTab(id?: string): Promise<void>
  closePane(id: string, remember?: boolean): Promise<void>
  savePreferences(value: Preferences): Promise<void>
  shortcut(value: Exclude<Shortcut, 'settings'>): void
}

function createWorkspace(path: string, name = '工作区'): ProjectWorkspace {
  return { id: crypto.randomUUID(), projectPath: path, name, kind: 'local' }
}

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

function projectWorkspaces(path: string, state: Workspace): ProjectWorkspace[] {
  if (state.workspaces.some((workspace) => workspace.projectPath === path)) return state.workspaces
  return [...state.workspaces, createWorkspace(path)]
}

export function currentWorkspace(
  state: Pick<Workspace, 'workspaces' | 'selectedProject' | 'selectedWorkspaces'>,
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

export function terminalTabId(state: Pick<Workspace, 'terminalLayouts'>, id: string): string {
  return (
    state.terminalLayouts.find(
      (group) => group.id === id || terminalPaneIds(group.root).includes(id),
    )?.id || id
  )
}

export function terminalTabs(
  state: Pick<Workspace, 'tabs' | 'terminalLayouts' | 'closingTerminalTabs'>,
): (TerminalTab & { indicatorTab?: TerminalTab })[] {
  const seen = new Set<string>()
  return state.tabs.flatMap((tab) => {
    const group = state.terminalLayouts.find((group) =>
      terminalPaneIds(group.root).includes(tab.id),
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

function activeWorkspaceTab(workspaceId: string): string | undefined {
  const session = useSourceControl.getState().sessions[workspaceId]
  if (session?.changesActive) return 'changes'
  if (session?.activePinnedDiff) return `diff:${gitFileKey(session.activePinnedDiff)}`
  if (session?.activePinnedFile) return `file:${session.activePinnedFile}`
  if (session?.preview) return 'preview'
  const state = useWorkspace.getState()
  const id = state.activeTabs[workspaceId]
  return id ? `terminal:${terminalTabId(state, id)}` : undefined
}

function adjacentWorkspaceTab(workspaceId: string, key: string): string | undefined {
  const order = useSourceControl.getState().sessions[workspaceId]?.tabOrder || []
  const index = order.indexOf(key)
  return index < 0 ? undefined : order[index + 1] || order[index - 1]
}

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

function readVisibleTerminal(state: Workspace): void {
  const tab = state.tabs.find(
    (tab) =>
      tab.id === state.visibleTerminal &&
      !tab.closingStatus &&
      tab.workspaceId === currentWorkspace(state)?.id &&
      state.activeTabs[tab.workspaceId] === tab.id,
  )
  const agent = !state.agentConnectionLost ? tab?.agent : undefined
  const shellCompleted = !!tab && !tab.agent && terminalIndicatorState(tab) === 'completed'
  const completed =
    (agent?.runtimeState === 'running' && agent.activityState === 'completed') || shellCompleted
  const unread = agent?.unread || shellCompleted
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
      const current = useWorkspace.getState().tabs.find((item) => item.id === tab.id)
      if (current?.agent?.unread) markAgentRead(current.agent)
      else if (current && terminalIndicatorState(current) === 'completed')
        useWorkspace.getState().updateTab(current.id, { shellUnread: false })
    }, 2000),
  }
}

const scanRequests = new Map<string, number>()
let openersRequest = 0

export const useWorkspace = create<Workspace>((set, get) => ({
  ready: false,
  layoutLoaded: false,
  projects: [],
  workspaces: [],
  selectedWorkspaces: {},
  preferences: DEFAULT_CONFIG.preferences,
  workspaceOpeners: [],
  async refreshWorkspaceOpeners() {
    const request = ++openersRequest
    const openers = unwrap(await window.desktop.listWorkspaceOpeners())
    if (request === openersRequest) set({ workspaceOpeners: openers })
  },
  tabs: [],
  terminalLayouts: [],
  closingTerminalTabs: [],
  pendingAgentUpdates: {},
  agentConnectionLost: false,
  activeTabs: {},
  focusVersion: 0,
  worktreeRecords: [],
  worktreeScans: {},
  orphanSessions: [],
  creatingWorktree: false,
  async bootstrap() {
    try {
      const { config, sessions, warning, worktreeScans } = unwrap(await window.desktop.bootstrap())
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
            (bound.projectPath !== session.projectPath || bound.kind !== session.workspaceKind)) ||
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
  async createGitWorktree(input) {
    if (get().creatingWorktree || get().removingWorkspace)
      throw new Error('正在处理另一个 Worktree 操作。')
    set({ creatingWorktree: true, worktreeError: undefined })
    try {
      unwrap(await window.desktop.selectProject(input.projectPath))
      const result = unwrap(await window.desktop.createGitWorktree(input))
      adoptWorktree(result)
      await get()
        .refreshWorktrees(input.projectPath)
        .catch((error) => set({ worktreeError: error.message }))
      return result
    } finally {
      set({ creatingWorktree: false })
    }
  },
  async refreshWorktrees(path) {
    const request = (scanRequests.get(path) || 0) + 1
    scanRequests.set(path, request)
    const result = await window.desktop.scanWorktrees(path)
    if (scanRequests.get(path) !== request) return
    if (!result.ok) {
      set({ worktreeError: result.error })
      return
    }
    set((state) => {
      const previous = state.worktreeScans[path]
      const scan = {
        ...result.value,
        external:
          result.value.error || result.value.repository.status !== 'ready'
            ? previous?.external || result.value.external
            : result.value.external,
        entries: result.value.entries.map((entry) => ({
          ...entry,
          worktree:
            entry.worktree ||
            previous?.entries.find((old) => old.record.id === entry.record.id)?.worktree,
        })),
      }
      return { worktreeScans: { ...state.worktreeScans, [path]: scan } }
    })
  },
  async removeWorktree(id, deleteBranch = true, unlink = false) {
    if (get().removingWorkspace || get().creatingWorktree) return
    set({ removingWorkspace: id, worktreeError: undefined })
    const record = get().worktreeRecords.find((entry) => entry.id === id)
    try {
      const result = unlink
        ? { removed: unwrap(await window.desktop.unlinkGitWorktree(id)) }
        : unwrap(await window.desktop.removeGitWorktree(id, deleteBranch))
      if (!result.removed) return
      set((state) => {
        const removed = new Set(
          state.workspaces
            .filter((entry) => entry.kind === 'git-worktree' && entry.worktreeId === id)
            .map((entry) => entry.id),
        )
        return {
          selectedProject: removed.has(currentWorkspace(state)?.id || '')
            ? undefined
            : state.selectedProject,
          worktreeRecords: state.worktreeRecords.filter((entry) => entry.id !== id),
          workspaces: state.workspaces.filter((entry) => !removed.has(entry.id)),
          tabs: state.tabs.filter((entry) => !removed.has(entry.workspaceId)),
          terminalLayouts: removeTerminalPanes(
            state.terminalLayouts,
            new Set(state.tabs.filter((tab) => removed.has(tab.workspaceId)).map((tab) => tab.id)),
          ),
          selectedWorkspaces: Object.fromEntries(
            Object.entries(state.selectedWorkspaces).filter(
              ([, workspaceId]) => !removed.has(workspaceId),
            ),
          ),
          activeTabs: Object.fromEntries(
            Object.entries(state.activeTabs).filter(([workspaceId]) => !removed.has(workspaceId)),
          ),
          worktreeError: 'warning' in result ? result.warning : undefined,
        }
      })
    } catch (error) {
      set({ worktreeError: (error as Error).message })
      throw error
    } finally {
      set({ removingWorkspace: undefined })
      if (record) await get().refreshWorktrees(record.projectPath).catch(console.error)
    }
  },
  async openProject() {
    if (get().removingWorkspace || get().creatingWorktree) return
    try {
      const path = unwrap(await window.desktop.openProject())
      if (!path || get().removingWorkspace || get().creatingWorktree) return
      set((state) => ({
        projects: state.projects.includes(path) ? state.projects : [...state.projects, path],
        workspaces: projectWorkspaces(path, state),
        selectedProject: path,
        focusVersion: state.focusVersion + 1,
      }))
      const workspace = currentWorkspace(get())
      if (workspace && !get().tabs.some((tab) => tab.workspaceId === workspace.id))
        get().newTerminal()
    } catch (error) {
      console.error(error)
    }
  },
  async selectProject(path, workspaceId) {
    if (get().removingWorkspace) return false
    const existed = get().workspaces.some((workspace) => workspace.projectPath === path)
    if (
      workspaceId &&
      !get().workspaces.some(
        (workspace) => workspace.id === workspaceId && workspace.projectPath === path,
      )
    )
      return false
    try {
      unwrap(await window.desktop.selectProject(path))
      if (
        get().removingWorkspace ||
        (existed && !get().workspaces.some((workspace) => workspace.projectPath === path)) ||
        (workspaceId &&
          !get().workspaces.some(
            (workspace) => workspace.id === workspaceId && workspace.projectPath === path,
          ))
      )
        return false
      set((state) => ({
        projects: state.projects.includes(path) ? state.projects : [...state.projects, path],
        workspaces: projectWorkspaces(path, state),
        selectedProject: path,
        selectedWorkspaces: workspaceId
          ? { ...state.selectedWorkspaces, [path]: workspaceId }
          : state.selectedWorkspaces,
        focusVersion: state.focusVersion + 1,
      }))
      if (workspaceId && !get().tabs.some((tab) => tab.workspaceId === workspaceId))
        get().newTerminal()
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  },
  async newWorkspace(path, name) {
    const workspaceName =
      name === undefined ? nextWorkspaceName(path, get().workspaces) : name.trim()
    if (!workspaceName || workspaceName.length > 1024) {
      console.error('请输入工作区名称（上限 1024 字符）')
      return false
    }
    if (!(await get().selectProject(path)) || get().removingWorkspace) return false
    if (get().workspaces.length >= 1000) {
      console.error('最多保留 1,000 个工作区，请先删除一个。')
      return false
    }
    set((state) => {
      const workspace = createWorkspace(path, workspaceName)
      return {
        workspaces: [...state.workspaces, workspace],
        selectedProject: path,
        selectedWorkspaces: { ...state.selectedWorkspaces, [path]: workspace.id },
        focusVersion: state.focusVersion + 1,
      }
    })
    get().newTerminal()
    return true
  },
  renameWorkspace(id, name) {
    if (get().removingWorkspace) return false
    if (!get().workspaces.some((workspace) => workspace.id === id)) {
      console.error('工作区不存在，可能已被删除')
      return false
    }
    const workspaceName = name.trim()
    if (!workspaceName || workspaceName.length > 1024) {
      console.error('请输入工作区名称（上限 1024 字符）')
      return false
    }
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, name: workspaceName } : workspace,
      ),
    }))
    return true
  },
  async removeWorkspace(id) {
    const workspace = get().workspaces.find((item) => item.id === id)
    if (!workspace || get().removingWorkspace || get().creatingWorktree) return false
    if (workspace.kind === 'git-worktree') {
      try {
        await get().removeWorktree(workspace.worktreeId)
        return !get().workspaces.some((item) => item.id === id)
      } catch {
        return false
      }
    }
    const removeProject = !get().workspaces.some(
      (item) => item.projectPath === workspace.projectPath && item.id !== id,
    )
    set({ removingWorkspace: id })
    try {
      if (
        !unwrap(
          await window.desktop.removeWorkspace({
            projectPath: workspace.projectPath,
            workspaceId: id,
            removeProject,
          }),
        )
      )
        return false
      set((state) => {
        const workspaces = state.workspaces.filter((item) => item.id !== id)
        const activeTabs = { ...state.activeTabs }
        delete activeTabs[id]
        const selectedWorkspaces = { ...state.selectedWorkspaces }
        const path = workspace.projectPath
        if (selectedWorkspaces[path] === id || removeProject) {
          const next = workspaces.find((item) => item.projectPath === path)
          if (next) selectedWorkspaces[path] = next.id
          else delete selectedWorkspaces[path]
        }
        const projects = removeProject
          ? state.projects.filter((project) => project !== path)
          : state.projects
        return {
          projects,
          selectedProject:
            removeProject && state.selectedProject === path
              ? projects[0] || workspaces[0]?.projectPath
              : state.selectedProject,
          tabs: state.tabs.filter((tab) => tab.workspaceId !== id),
          terminalLayouts: removeTerminalPanes(
            state.terminalLayouts,
            new Set(state.tabs.filter((tab) => tab.workspaceId === id).map((tab) => tab.id)),
          ),
          activeTabs,
          workspaces,
          selectedWorkspaces,
        }
      })
      return true
    } catch (error) {
      console.error(error)
      return false
    } finally {
      set((state) => ({ removingWorkspace: undefined, focusVersion: state.focusVersion + 1 }))
    }
  },
  async removeProject(path) {
    if (
      get().removingWorkspace ||
      !get().workspaces.some((workspace) => workspace.projectPath === path)
    )
      return false
    set({ removingWorkspace: path })
    try {
      if (!unwrap(await window.desktop.removeProject(path))) return false
      set((state) => {
        const removed = new Set(
          state.workspaces
            .filter((workspace) => workspace.projectPath === path)
            .map((workspace) => workspace.id),
        )
        const workspaces = state.workspaces.filter((workspace) => workspace.projectPath !== path)
        const projects = state.projects.filter((project) => project !== path)
        const selectedWorkspaces = { ...state.selectedWorkspaces }
        delete selectedWorkspaces[path]
        return {
          projects,
          workspaces,
          selectedProject:
            state.selectedProject === path
              ? projects[0] || workspaces[0]?.projectPath
              : state.selectedProject,
          selectedWorkspaces,
          tabs: state.tabs.filter((tab) => tab.projectPath !== path),
          terminalLayouts: removeTerminalPanes(
            state.terminalLayouts,
            new Set(state.tabs.filter((tab) => tab.projectPath === path).map((tab) => tab.id)),
          ),
          activeTabs: Object.fromEntries(
            Object.entries(state.activeTabs).filter(([id]) => !removed.has(id)),
          ),
        }
      })
      return true
    } catch (error) {
      console.error(error)
      return false
    } finally {
      set((state) => ({ removingWorkspace: undefined, focusVersion: state.focusVersion + 1 }))
    }
  },
  recentQuickCommands: {},
  runQuickCommand(id, workspaceId) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
    const command = get().preferences.quickCommands.find((entry) => entry.id === id)
    if (
      !workspace ||
      !command ||
      (command.scope.type === 'project' && command.scope.projectPath !== workspace.projectPath)
    )
      throw new Error('快捷命令不存在或不属于当前项目。')
    if (command.mode === 'service') {
      const existing = get().tabs.find(
        (tab) =>
          tab.workspaceId === workspaceId &&
          tab.service?.commandId === id &&
          (tab.status === 'starting' || tab.status === 'running'),
      )
      if (existing) {
        get().selectTab(existing.id)
        return
      }
    }
    if (get().tabs.length >= MAX_TERMINALS)
      throw new Error(`最多保留 ${MAX_TERMINALS} 个终端，请先关闭一个标签。`)
    if (!get().newTerminal(undefined, workspaceId, command))
      throw new Error('当前工作区不可用或正在关闭，请稍后重试。')
    set((state) => ({ recentQuickCommands: { ...state.recentQuickCommands, [workspaceId]: id } }))
  },
  newTerminal(provider, targetId, command) {
    const { tabs, removingWorkspace } = get()
    if (removingWorkspace || (provider && (!Object.hasOwn(AGENT_PROVIDERS, provider) || command)))
      return
    const workspace = targetId
      ? get().workspaces.find((entry) => entry.id === targetId)
      : currentWorkspace(get())
    if (!workspace || get().creatingWorktree) return
    const selectedProject = workspace.projectPath
    const workspaceId = workspace.id
    const worktree =
      workspace.kind === 'git-worktree'
        ? get().worktreeScans[selectedProject]?.entries.find(
            (entry) => entry.record.id === workspace.worktreeId,
          )
        : undefined
    if (workspace.kind === 'git-worktree' && worktree?.status !== 'ready') {
      set({
        worktreeError: 'Worktree 不可用，请在“编辑”中重新检查或在终端中修复；不会回退到项目目录。',
      })
      return
    }
    if (tabs.length >= MAX_TERMINALS) {
      console.error(`最多保留 ${MAX_TERMINALS} 个终端，请先关闭一个标签。`)
      return
    }
    useSourceControl.getState().showTerminal(workspaceId)
    const id = crypto.randomUUID()
    const number =
      Math.max(
        0,
        ...tabs
          .filter((tab) => tab.workspaceId === workspaceId && tab.provider === provider)
          .map((tab) => Number(/(?:Terminal | · )(\d+)$/.exec(tab.title)?.[1] || 0)),
      ) + 1
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id,
          projectPath: selectedProject,
          workspaceId,
          title:
            command?.name ||
            (provider ? `${AGENT_PROVIDERS[provider].name} · ${number}` : `Terminal ${number}`),
          ...(command ? { startupCommand: command.command } : {}),
          ...(command?.mode === 'service'
            ? { service: { commandId: command.id, name: command.name } }
            : {}),
          cwd: worktree?.record.path || selectedProject,
          ...(provider ? { kind: 'agent' as const, provider, launchId: crypto.randomUUID() } : {}),
          status: 'starting',
        },
      ],
      selectedProject,
      selectedWorkspaces: { ...state.selectedWorkspaces, [selectedProject]: workspaceId },
      activeTabs: { ...state.activeTabs, [workspaceId]: id },
      focusVersion: state.focusVersion + 1,
    }))
    return id
  },
  splitTerminal(id, direction = 'horizontal') {
    const tab = get().tabs.find((tab) => tab.id === id)
    if (
      !tab ||
      tab.closingStatus ||
      tab.status === 'starting' ||
      get().closingTerminalTabs.includes(terminalTabId(get(), id))
    )
      return
    const next = get().newTerminal(undefined, tab.workspaceId)
    if (!next) return
    const split: TerminalPane = {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      ratio: 0.5,
      children: [
        { type: 'terminal', id },
        { type: 'terminal', id: next },
      ],
    }
    set((state) => {
      const group = state.terminalLayouts.find((group) => terminalPaneIds(group.root).includes(id))
      return {
        terminalLayouts: group
          ? state.terminalLayouts.map((node) =>
              node === group
                ? { ...node, root: mapTerminalPane(node.root, id, () => split), activePaneId: next }
                : node,
            )
          : [...state.terminalLayouts, { id, root: split, activePaneId: next }],
      }
    })
  },
  resizeTerminalSplit(id, ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1 || get().removingWorkspace) return
    set((state) => ({
      terminalLayouts: state.terminalLayouts.map((group) => ({
        ...group,
        root: mapTerminalPane(group.root, id, (node) =>
          node.type === 'split' ? { ...node, ratio } : node,
        ),
      })),
    }))
  },
  reopenTab() {
    const state = get()
    if (state.removingWorkspace || state.creatingWorktree) return
    const workspace =
      currentWorkspace(state) ||
      (!state.selectedProject
        ? state.workspaces.find((entry) => entry.id === state.lastClosedWorkspaceId)
        : undefined)
    if (!workspace) return
    const sourceControl = useSourceControl.getState()
    const session = sourceControl.sessions[workspace.id]
    const tab = session?.closedTabs.at(-1)
    if (!tab) return
    switch (tab.kind) {
      case 'terminal': {
        const id = get().newTerminal(tab.provider, workspace.id)
        if (!id) return
        get().updateTab(id, { title: tab.title })
        break
      }
      case 'terminal-group': {
        if (state.tabs.length + tab.panes.length > MAX_TERMINALS) {
          console.error(`最多可同时打开 ${MAX_TERMINALS} 个终端，请先关闭其他标签。`)
          return
        }
        const ids = new Map<string, string>()
        for (const pane of tab.panes) {
          const id = get().newTerminal(pane.provider, workspace.id)
          if (!id) return
          ids.set(pane.id, id)
          get().updateTab(id, { title: pane.title })
        }
        const remap = (node: TerminalPane): TerminalPane =>
          node.type === 'terminal'
            ? { ...node, id: ids.get(node.id)! }
            : {
                ...node,
                id: crypto.randomUUID(),
                children: [remap(node.children[0]), remap(node.children[1])],
              }
        const activePaneId = ids.get(tab.layout.activePaneId)!
        set((state) => ({
          terminalLayouts: [
            ...state.terminalLayouts,
            {
              id: ids.get(tab.panes[0].id)!,
              root: remap(tab.layout.root),
              activePaneId,
            },
          ],
        }))
        get().selectTab(activePaneId)
        break
      }
      case 'changes':
        sourceControl.openChanges(workspace.id)
        break
      case 'diff': {
        const key = gitFileKey(tab.selection)
        if (!session.pinnedDiffs.some((selection) => gitFileKey(selection) === key))
          sourceControl.update(workspace.id, {
            pinnedDiffs: [...session.pinnedDiffs, tab.selection],
          })
        sourceControl.selectPinnedDiff(workspace.id, key)
        break
      }
      case 'file':
        if (!session.pinnedFiles.includes(tab.path))
          sourceControl.update(workspace.id, { pinnedFiles: [...session.pinnedFiles, tab.path] })
        sourceControl.selectPinnedFile(workspace.id, tab.path)
        break
      case 'preview':
        if (tab.selection) sourceControl.openDiff(workspace.id, tab.selection)
        else if (tab.file) sourceControl.openFile(workspace.id, tab.file)
        break
    }
    sourceControl.update(workspace.id, { closedTabs: session.closedTabs.slice(0, -1) })
    set((state) => ({
      selectedProject: workspace.projectPath,
      selectedWorkspaces: { ...state.selectedWorkspaces, [workspace.projectPath]: workspace.id },
      focusVersion: state.focusVersion + 1,
    }))
  },
  selectTab(id) {
    const tab = get().tabs.find((item) => item.id === id)
    if (tab) {
      useSourceControl.getState().showTerminal(tab.workspaceId)
      set((state) => ({
        activeTabs: { ...state.activeTabs, [tab.workspaceId]: id },
        terminalLayouts: state.terminalLayouts.map((group) =>
          terminalPaneIds(group.root).includes(id) ? { ...group, activePaneId: id } : group,
        ),
        focusVersion: state.focusVersion + 1,
      }))
    }
  },
  selectWorkspaceTab(workspaceId, key) {
    const sourceControl = useSourceControl.getState()
    if (!sourceControl.sessions[workspaceId]?.tabOrder.includes(key)) return
    if (key.startsWith('terminal:')) {
      const id = key.slice('terminal:'.length)
      const group = get().terminalLayouts.find((group) => group.id === id)
      const panes = group
        ? terminalPaneIds(group.root).filter((paneId) =>
            get().tabs.some((tab) => tab.id === paneId),
          )
        : []
      get().selectTab(
        group && panes.includes(group.activePaneId) ? group.activePaneId : panes[0] || id,
      )
      return
    }
    if (key === 'changes') sourceControl.openChanges(workspaceId)
    else if (key.startsWith('diff:'))
      sourceControl.selectPinnedDiff(workspaceId, key.slice('diff:'.length))
    else if (key.startsWith('file:'))
      sourceControl.selectPinnedFile(workspaceId, key.slice('file:'.length))
    else if (key === 'preview') sourceControl.update(workspaceId, { preview: true })
    set((state) => ({ focusVersion: state.focusVersion + 1 }))
  },
  closeWorkspaceTab(workspaceId, key) {
    if (get().removingWorkspace) return
    const sourceControl = useSourceControl.getState()
    if (!sourceControl.sessions[workspaceId]?.tabOrder.includes(key)) return
    if (key.startsWith('terminal:')) {
      void get().closeTab(key.slice('terminal:'.length))
      return
    }
    const active = activeWorkspaceTab(workspaceId) === key
    const next = adjacentWorkspaceTab(workspaceId, key)
    if (key === 'changes') sourceControl.closeChanges(workspaceId)
    else if (key.startsWith('diff:'))
      sourceControl.closePinnedDiff(workspaceId, key.slice('diff:'.length))
    else if (key.startsWith('file:'))
      sourceControl.closePinnedFile(workspaceId, key.slice('file:'.length))
    else if (key === 'preview') sourceControl.closePreview(workspaceId)
    if (!active) return
    if (next) get().selectWorkspaceTab(workspaceId, next)
    else if (currentWorkspace(get())?.id === workspaceId)
      set((state) => ({
        selectedProject: undefined,
        lastClosedWorkspaceId: workspaceId,
        focusVersion: state.focusVersion + 1,
      }))
  },
  reorderTab(workspaceId, id, toIndex) {
    const state = get()
    if (state.removingWorkspace || currentWorkspace(state)?.id !== workspaceId) return
    const sourceControl = useSourceControl.getState()
    const order = [...(sourceControl.sessions[workspaceId]?.tabOrder || [])]
    const fromIndex = order.indexOf(`terminal:${id}`)
    const tab = terminalTabs(state).find((tab) => tab.workspaceId === workspaceId && tab.id === id)
    if (
      !tab ||
      fromIndex < 0 ||
      fromIndex === toIndex ||
      !Number.isInteger(toIndex) ||
      toIndex < 0 ||
      toIndex >= order.length ||
      tab.closingStatus
    )
      return
    const [key] = order.splice(fromIndex, 1)
    order.splice(toIndex, 0, key)
    sourceControl.update(workspaceId, { tabOrder: order })
    const ordered = state.tabs
      .filter((tab) => tab.workspaceId === workspaceId)
      .sort(
        (a, b) =>
          order.indexOf(`terminal:${terminalTabId(state, a.id)}`) -
          order.indexOf(`terminal:${terminalTabId(state, b.id)}`),
      )
    let index = 0
    set({
      tabs: state.tabs.map((item) => (item.workspaceId === workspaceId ? ordered[index++] : item)),
    })
  },
  updateTab(id, value) {
    const { agent, agentRevision, ...fields } = value
    const rest: Partial<TerminalTab> = agent
      ? fields
      : { ...fields, ...(agentRevision ? { agentRevision } : {}) }
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab
        const currentRevision = tab.agentRevision ?? tab.agent?.revision ?? 0
        const incomingRevision = agent?.revision ?? value.agentRevision ?? 0
        if (incomingRevision && currentRevision >= incomingRevision) {
          const { agentRevision: _revision, ...other } = rest
          return { ...tab, ...other, status: tab.status, exitCode: tab.exitCode }
        }
        return {
          ...tab,
          ...rest,
          ...(fields.shellActivity && fields.shellActivity !== tab.shellActivity
            ? {
                shellUnread:
                  fields.shellActivity === 'idle' &&
                  tab.shellActivity === 'running' &&
                  !tab.agent &&
                  !agent,
              }
            : {}),
          ...(value.agentRevision && !agent ? { agent: undefined } : {}),
        }
      }),
    }))
    if (agent) get().receiveAgent({ type: 'state', session: agent })
  },
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
            ...Object.fromEntries(Object.entries(state.pendingAgentUpdates).slice(-MAX_TERMINALS)),
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
  async closeTab(id) {
    if (get().removingWorkspace) return
    if (!id) {
      window.desktop.closeWindow()
      return
    }
    const group = get().terminalLayouts.find(
      (group) => group.id === id || terminalPaneIds(group.root).includes(id),
    )
    if (!group) return get().closePane(id)
    const panes = terminalPaneIds(group.root).map((paneId) =>
      get().tabs.find((tab) => tab.id === paneId),
    )
    if (
      get().closingTerminalTabs.includes(group.id) ||
      panes.some((tab) => !tab || tab.status === 'starting' || tab.closingStatus)
    )
      return
    const live = panes.filter((tab): tab is TerminalTab => !!tab)
    if (live.length === 1) return get().closePane(live[0].id)
    set((state) => ({ closingTerminalTabs: [...state.closingTerminalTabs, group.id] }))
    try {
      for (const tab of live) {
        await get().closePane(tab.id, false)
        if (get().tabs.some((pane) => pane.id === tab.id)) return
      }
      if (get().workspaces.some((workspace) => workspace.id === live[0].workspaceId))
        useSourceControl.getState().rememberClosedTab(live[0].workspaceId, {
          kind: 'terminal-group',
          layout: group,
          panes: live.map((tab) => ({
            id: tab.id,
            title: tab.title,
            provider: tab.kind === 'agent' ? tab.provider : undefined,
          })),
        })
    } finally {
      set((state) => ({
        closingTerminalTabs: state.closingTerminalTabs.filter((id) => id !== group.id),
      }))
    }
  },
  async closePane(id, remember = true) {
    if (get().removingWorkspace) return
    const tab = get().tabs.find((item) => item.id === id)
    if (!tab || tab.status === 'starting' || tab.closingStatus) return
    const group = get().terminalLayouts.find((group) => terminalPaneIds(group.root).includes(id))
    if (remember && group && get().closingTerminalTabs.includes(group.id)) return
    const tabKey = `terminal:${group?.id || id}`
    // Keep the pre-close presentation while exit events continue updating the actual status.
    get().updateTab(id, { closingStatus: tab.status })
    let removed = false
    let recovery = tab
    let position = 0
    let tabPosition = 0
    let removedFocusVersion = 0
    let wasActive = false
    let nextTab: string | undefined
    const agentUpdates: AgentUpdate[] = []
    const remove = () => {
      if (removed) return
      const current = get().tabs.find((item) => item.id === id)
      if (!current) return
      recovery = current
      position = get().tabs.indexOf(current)
      tabPosition = useSourceControl.getState().sessions[tab.workspaceId].tabOrder.indexOf(tabKey)
      wasActive =
        activeWorkspaceTab(tab.workspaceId) === tabKey && get().activeTabs[tab.workspaceId] === id
      const paneIds = group
        ? terminalPaneIds(group.root).filter(
            (paneId) =>
              paneId === id || get().tabs.some((tab) => tab.id === paneId && !tab.closingStatus),
          )
        : []
      const paneIndex = paneIds.indexOf(id)
      const nextPane = paneIds[paneIndex + 1] || paneIds[paneIndex - 1]
      nextTab = nextPane ? tabKey : adjacentWorkspaceTab(tab.workspaceId, tabKey)
      const hasOtherTabs =
        useSourceControl
          .getState()
          .sessions[tab.workspaceId].tabOrder.some((key) => key !== tabKey) || !!nextPane
      removed = true
      set((state) => {
        const tabs = state.tabs.filter((item) => item.id !== id)
        const remaining = tabs.filter((item) => item.workspaceId === tab.workspaceId)
        const activeTabs = { ...state.activeTabs }
        if (activeTabs[tab.workspaceId] === id) {
          if (remaining.length) activeTabs[tab.workspaceId] = remaining[remaining.length - 1].id
          else delete activeTabs[tab.workspaceId]
        }
        return {
          tabs,
          activeTabs,
          selectedProject:
            !hasOtherTabs && currentWorkspace(state)?.id === tab.workspaceId
              ? undefined
              : state.selectedProject,
          lastClosedWorkspaceId:
            !hasOtherTabs && currentWorkspace(state)?.id === tab.workspaceId
              ? tab.workspaceId
              : state.lastClosedWorkspaceId,
          focusVersion: state.focusVersion + 1,
        }
      })
      if (wasActive && nextPane) get().selectTab(nextPane)
      else if (wasActive && nextTab) get().selectWorkspaceTab(tab.workspaceId, nextTab)
      removedFocusVersion = get().focusVersion
    }
    const restore = () => {
      if (!removed) return
      const restoreActive =
        wasActive &&
        get().focusVersion === removedFocusVersion &&
        activeWorkspaceTab(tab.workspaceId) === nextTab
      const hadTab = useSourceControl.getState().sessions[tab.workspaceId].tabOrder.includes(tabKey)
      removed = false
      set((state) => {
        if (
          state.tabs.some((item) => item.id === id) ||
          !state.workspaces.some((item) => item.id === tab.workspaceId)
        )
          return state
        const tabs = [...state.tabs]
        tabs.splice(position, 0, { ...recovery, closingStatus: undefined })
        const active = state.activeTabs[tab.workspaceId]
        return {
          tabs,
          activeTabs: tabs.some((item) => item.id === active)
            ? state.activeTabs
            : { ...state.activeTabs, [tab.workspaceId]: id },
          selectedProject:
            !state.selectedProject && state.focusVersion === removedFocusVersion
              ? tab.projectPath
              : state.selectedProject,
          focusVersion: state.focusVersion + 1,
        }
      })
      if (get().tabs.some((item) => item.id === id)) {
        const sourceControl = useSourceControl.getState()
        if (!hadTab) {
          const tabOrder = sourceControl.sessions[tab.workspaceId].tabOrder.filter(
            (key) => key !== tabKey,
          )
          tabOrder.splice(Math.max(0, tabPosition), 0, tabKey)
          sourceControl.update(tab.workspaceId, { tabOrder })
        }
        if (restoreActive) get().selectTab(id)
      }
      // Reuse the normal revision/launch checks for updates received during background teardown.
      for (const event of agentUpdates) get().receiveAgent(event)
    }
    const stopTerminal = window.desktop.onTerminal((event) => {
      if (event.id !== id) return
      // The Host client emits this only after Main's required confirmation has completed.
      if (event.type === 'closing' && event.closing) remove()
      else if (removed && event.type === 'exit')
        recovery = { ...recovery, status: 'exited', exitCode: event.exitCode }
      else if (removed && event.type === 'error')
        recovery = { ...recovery, status: 'error', error: event.error }
    })
    const stopAgents = window.desktop.onAgent((event) => {
      if (
        removed &&
        (event.type === 'disconnected' ||
          (event.type === 'state' ? event.session.terminalId : event.terminalId) === id)
      )
        agentUpdates.push(event)
    })
    try {
      if (!unwrap(await window.desktop.closeTerminal(id))) {
        restore()
        return
      }
      remove()
      set((state) => ({
        terminalLayouts: removeTerminalPanes(state.terminalLayouts, new Set([id])),
      }))
      if (
        remember &&
        get().workspaces.some((workspace) => workspace.id === tab.workspaceId) &&
        (!group ||
          !terminalPaneIds(group.root).some((paneId) =>
            get().tabs.some((tab) => tab.id === paneId),
          ))
      )
        useSourceControl.getState().rememberClosedTab(tab.workspaceId, {
          kind: 'terminal',
          title: tab.title,
          provider: tab.kind === 'agent' ? tab.provider : undefined,
        })
    } catch (error) {
      restore()
      get().updateTab(id, {
        error: `关闭失败：${error instanceof Error ? error.message : String(error)}`,
      })
      console.error(error)
    } finally {
      stopTerminal()
      stopAgents()
      if (get().tabs.some((item) => item.id === id))
        get().updateTab(id, { closingStatus: undefined })
    }
  },
  async savePreferences(value) {
    const saved = unwrap(await window.desktop.savePreferences(value))
    const openersChanged =
      JSON.stringify(saved.openWith) !== JSON.stringify(get().preferences.openWith)
    set({ preferences: saved })
    if (openersChanged) void get().refreshWorkspaceOpeners().catch(console.warn)
  },
  shortcut(value) {
    if (get().removingWorkspace) return
    const workspaceId = currentWorkspace(get())?.id || ''
    const sourceControl = useSourceControl.getState()
    const session = sourceControl.sessions[workspaceId]
    switch (value) {
      case 'toggle-right-panel':
        useRightPanel.setState((state) => ({ open: !state.open }))
        break
      case 'open-folder':
        void get().openProject()
        break
      case 'new-terminal':
        get().newTerminal()
        break
      case 'split-terminal':
      case 'split-terminal-down': {
        const id = get().activeTabs[workspaceId]
        if (id && activeWorkspaceTab(workspaceId)?.startsWith('terminal:'))
          get().splitTerminal(id, value === 'split-terminal-down' ? 'vertical' : 'horizontal')
        break
      }
      case 'reopen-tab':
        get().reopenTab()
        break
      case 'close-terminal': {
        const key = activeWorkspaceTab(workspaceId)
        if (key?.startsWith('terminal:')) void get().closePane(get().activeTabs[workspaceId])
        else if (key) get().closeWorkspaceTab(workspaceId, key)
        else void get().closeTab()
        break
      }
      default: {
        const key = session?.tabOrder[Number(value.slice(4)) - 1]
        if (key) get().selectWorkspaceTab(workspaceId, key)
      }
    }
  },
}))

function adoptWorktree({ record, workspace, worktree }: CreateWorktreeResult): void {
  useWorkspace.setState((state) => {
    const scan = state.worktreeScans[record.projectPath]
    const existing = state.tabs.find((tab) => tab.workspaceId === workspace.id)
    const tab: TerminalTab | undefined =
      !existing && state.tabs.length < MAX_TERMINALS
        ? {
            id: crypto.randomUUID(),
            projectPath: record.projectPath,
            workspaceId: workspace.id,
            title: 'Terminal 1',
            cwd: record.path,
            status: 'starting',
          }
        : undefined
    return {
      projects: state.projects.includes(record.projectPath)
        ? state.projects
        : [...state.projects, record.projectPath],
      worktreeRecords: [...state.worktreeRecords.filter((entry) => entry.id !== record.id), record],
      workspaces: [...state.workspaces.filter((entry) => entry.id !== workspace.id), workspace],
      selectedProject: record.projectPath,
      selectedWorkspaces: { ...state.selectedWorkspaces, [record.projectPath]: workspace.id },
      tabs: tab ? [...state.tabs, tab] : state.tabs,
      activeTabs: tab ? { ...state.activeTabs, [workspace.id]: tab.id } : state.activeTabs,
      focusVersion: state.focusVersion + 1,
      worktreeError:
        !existing && !tab ? 'Worktree 已就绪；终端已达上限，请关闭一个标签后新建终端。' : undefined,
      worktreeScans: {
        ...state.worktreeScans,
        [record.projectPath]: {
          repository: scan?.repository || {
            status: 'ready',
            projectPath: record.projectPath,
            rootPath: record.projectPath,
            repoCommonDir: record.repoCommonDir,
            isBare: false,
          },
          external: scan?.external.filter((entry) => entry.path !== record.path) || [],
          entries: [
            ...(scan?.entries.filter((entry) => entry.record.id !== record.id) || []),
            { record, worktree, status: 'ready' },
          ],
        },
      },
    }
  })
}

function savedLayout(state: Workspace): WorkspaceLayout {
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

const unsubscribeLayout = useWorkspace.subscribe((state, previous) => {
  if (!state.layoutLoaded) return
  const layout = savedLayout(state)
  if (previous.layoutLoaded && JSON.stringify(layout) === JSON.stringify(savedLayout(previous)))
    return
  void window.desktop
    .saveLayout(layout)
    .then(unwrap)
    .catch((error) => console.error(error))
})
const unsubscribeTabOrder = useWorkspace.subscribe((state, previous) => {
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
const unsubscribeTerminalRead = useWorkspace.subscribe(readVisibleTerminal)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribeLayout()
    unsubscribeTabOrder()
    unsubscribeTerminalRead()
    if (completionRead) clearTimeout(completionRead.timer)
  })
