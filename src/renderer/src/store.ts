import { create } from 'zustand'
import { useSourceControl } from './lib/source-control-store'
import {
  DEFAULT_CONFIG,
  MAX_TERMINALS,
  AGENT_PROVIDERS,
  type AgentProvider,
  type AgentSession,
  type AgentUpdate,
  unwrap,
  type Preferences,
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
  exitCode?: number
  error?: string
  closingStatus?: TerminalTab['status']
}

interface Workspace {
  ready: boolean
  layoutLoaded: boolean
  projects: string[]
  selectedProject?: string
  workspaces: ProjectWorkspace[]
  selectedWorkspaces: Record<string, string>
  removingWorkspace?: string
  preferences: Preferences
  tabs: TerminalTab[]
  pendingAgentUpdates: Record<string, Exclude<AgentUpdate, { type: 'disconnected' }>>
  agentConnectionLost: boolean
  visibleTerminal?: string
  receiveAgent(event: AgentUpdate): void
  setVisibleTerminal(id?: string): void
  activeTabs: Record<string, string>
  focusVersion: number
  worktreeRecords: WorktreeRecord[]
  worktreeScans: Record<string, WorktreeScan>
  worktreeError?: string
  orphanSessions: TerminalSession[]
  creatingWorktree: boolean
  createGitWorktree(input: CreateWorktreeInput & { planId: string }): Promise<void>
  refreshWorktrees(path: string): Promise<void>
  removeWorktree(id: string, deleteBranch?: boolean, unlink?: boolean): Promise<void>
  bootstrap(): Promise<void>
  openProject(): Promise<void>
  selectProject(path: string, workspaceId?: string): Promise<boolean>
  newWorkspace(path: string, name?: string): Promise<boolean>
  renameWorkspace(id: string, name: string): boolean
  removeWorkspace(id: string): Promise<boolean>
  removeProject(path: string): Promise<boolean>
  newTerminal(provider?: AgentProvider, workspaceId?: string): void
  selectTab(id: string): void
  updateTab(id: string, value: Partial<TerminalTab>): void
  closeTab(id?: string): Promise<void>
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

let completionRead: { session: AgentSession; timer: ReturnType<typeof setTimeout> } | undefined

function markAgentRead(agent: AgentSession): void {
  void window.desktop
    .readAgent(agent.terminalId, agent.launchId, agent.revision)
    .then(unwrap)
    .catch((error) => console.warn('无法标记 Agent 状态已读。', error))
}

function readVisibleAgent(state: Workspace): void {
  const tab = state.tabs.find((tab) => tab.id === state.visibleTerminal)
  const agent =
    tab &&
    !state.agentConnectionLost &&
    !tab.closingStatus &&
    tab.workspaceId === currentWorkspace(state)?.id &&
    state.activeTabs[tab.workspaceId] === tab.id
      ? tab.agent
      : undefined
  const completed = agent?.runtimeState === 'running' && agent.activityState === 'completed'
  if (
    completionRead &&
    (!completed ||
      !agent?.unread ||
      completionRead.session.terminalId !== agent.terminalId ||
      completionRead.session.launchId !== agent.launchId ||
      completionRead.session.lastTurnId !== agent.lastTurnId)
  ) {
    clearTimeout(completionRead.timer)
    completionRead = undefined
  }
  if (!agent?.unread) return
  if (!completed) {
    markAgentRead(agent)
    return
  }
  if (completionRead) return
  completionRead = {
    session: agent,
    timer: setTimeout(() => {
      completionRead = undefined
      const current = useWorkspace
        .getState()
        .tabs.find((item) => item.id === agent.terminalId)?.agent
      if (current?.unread) markAgentRead(current)
    }, 2000),
  }
}

const scanRequests = new Map<string, number>()

export const useWorkspace = create<Workspace>((set, get) => ({
  ready: false,
  layoutLoaded: false,
  projects: [],
  workspaces: [],
  selectedWorkspaces: {},
  preferences: DEFAULT_CONFIG.preferences,
  tabs: [],
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
          provider: session.provider,
          launchId: session.kind === 'agent' ? session.agent?.launchId : undefined,
          agent: session.agent,
          agentRevision: session.agent?.revision ?? session.agentRevision,
          cwd: session.cwd,
          status: session.exited ? 'exited' : 'running',
          exitCode: session.exitCode,
        })
      }
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
        layoutLoaded: true,
        projects: config.recentProjects,
        workspaces,
        selectedProject: tabs.some((tab) => tab.workspaceId === selectedWorkspace?.id)
          ? layout?.selectedProject
          : undefined,
        selectedWorkspaces,
        tabs,
        activeTabs,
        preferences: config.preferences,
        worktreeRecords: config.worktreeRecords,
        worktreeScans: worktreeScans || {},
        orphanSessions,
      })
      const pending = get().pendingAgentUpdates
      set({ pendingAgentUpdates: {} })
      for (const event of Object.values(pending)) get().receiveAgent(event)
      if (get().agentConnectionLost) get().receiveAgent({ type: 'disconnected' })
    } catch (error) {
      console.error(error)
      set({ ready: true })
    }
  },
  async createGitWorktree(input) {
    if (get().creatingWorktree || get().removingWorkspace)
      throw new Error('正在处理另一个 Worktree 操作。')
    set({ creatingWorktree: true, worktreeError: undefined })
    try {
      unwrap(await window.desktop.selectProject(input.projectPath))
      adoptWorktree(unwrap(await window.desktop.createGitWorktree(input)))
      await get()
        .refreshWorktrees(input.projectPath)
        .catch((error) => set({ worktreeError: error.message }))
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
  newTerminal(provider, targetId) {
    const { tabs, removingWorkspace } = get()
    if (removingWorkspace || (provider && !Object.hasOwn(AGENT_PROVIDERS, provider))) return
    const workspace = targetId
      ? get().workspaces.find((entry) => entry.id === targetId)
      : currentWorkspace(get())
    if (!workspace || get().creatingWorktree) return
    const selectedProject = workspace.projectPath
    const workspaceId = workspace.id
    if (
      workspace.kind === 'git-worktree' &&
      get().worktreeScans[selectedProject]?.entries.find(
        (entry) => entry.record.id === workspace.worktreeId,
      )?.status !== 'ready'
    ) {
      set({
        worktreeError: 'Worktree 不可用，请在“编辑”中重新检查或在终端中修复；不会回退到项目目录。',
      })
      return
    }
    if (tabs.length >= MAX_TERMINALS) {
      console.error('最多保留 10 个终端，请先关闭一个标签。')
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
          title: provider ? `${AGENT_PROVIDERS[provider].name} · ${number}` : `Terminal ${number}`,
          ...(provider ? { kind: 'agent' as const, provider, launchId: crypto.randomUUID() } : {}),
          status: 'starting',
        },
      ],
      selectedProject,
      selectedWorkspaces: { ...state.selectedWorkspaces, [selectedProject]: workspaceId },
      activeTabs: { ...state.activeTabs, [workspaceId]: id },
      focusVersion: state.focusVersion + 1,
    }))
  },
  selectTab(id) {
    const tab = get().tabs.find((item) => item.id === id)
    if (tab) {
      useSourceControl.getState().showTerminal(tab.workspaceId)
      set((state) => ({
        activeTabs: { ...state.activeTabs, [tab.workspaceId]: id },
        focusVersion: state.focusVersion + 1,
      }))
    }
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
        return { ...tab, ...rest, ...(value.agentRevision && !agent ? { agent: undefined } : {}) }
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
    const tab = get().tabs.find((item) => item.id === id)
    if (!tab || tab.status === 'starting' || tab.closingStatus) return
    // Keep the pre-close presentation while exit events continue updating the actual status.
    get().updateTab(id, { closingStatus: tab.status })
    let removed = false
    let recovery = tab
    let position = 0
    let removedFocusVersion = 0
    const agentUpdates: AgentUpdate[] = []
    const remove = () => {
      if (removed) return
      const current = get().tabs.find((item) => item.id === id)
      if (!current) return
      recovery = current
      position = get().tabs.indexOf(current)
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
            !remaining.length && currentWorkspace(state)?.id === tab.workspaceId
              ? undefined
              : state.selectedProject,
          focusVersion: state.focusVersion + 1,
        }
      })
      removedFocusVersion = get().focusVersion
    }
    const restore = () => {
      if (!removed) return
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
    set({ preferences: saved })
  },
  shortcut(value) {
    if (get().removingWorkspace) return
    const workspaceId = currentWorkspace(get())?.id || ''
    switch (value) {
      case 'open-folder':
        void get().openProject()
        break
      case 'new-terminal':
        get().newTerminal()
        break
      case 'close-terminal':
        void get().closeTab(get().activeTabs[workspaceId])
        break
      default: {
        const tab = get().tabs.filter((item) => item.workspaceId === workspaceId)[
          Number(value.slice(4)) - 1
        ]
        if (tab) get().selectTab(tab.id)
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
const unsubscribeAgentRead = useWorkspace.subscribe(readVisibleAgent)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribeLayout()
    unsubscribeAgentRead()
    if (completionRead) clearTimeout(completionRead.timer)
  })
