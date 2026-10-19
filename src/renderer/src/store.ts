import { create } from 'zustand'
import {
  DEFAULT_CONFIG,
  MAX_TERMINALS,
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
  newTerminal(): void
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

const scanRequests = new Map<string, number>()

export const useWorkspace = create<Workspace>((set, get) => ({
  ready: false,
  layoutLoaded: false,
  projects: [],
  workspaces: [],
  selectedWorkspaces: {},
  preferences: DEFAULT_CONFIG.preferences,
  tabs: [],
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
          title: saved?.title || `Terminal ${tabs.length + 1}`,
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
  newTerminal() {
    const { selectedProject, tabs, removingWorkspace } = get()
    if (!selectedProject || removingWorkspace) return
    const workspace = currentWorkspace(get())
    const workspaceId = workspace?.id
    if (!workspaceId || get().creatingWorktree) return
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
    const id = crypto.randomUUID()
    const number =
      Math.max(
        0,
        ...tabs
          .filter((tab) => tab.workspaceId === workspaceId)
          .map((tab) => Number(tab.title.split(' ')[1])),
      ) + 1
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id,
          projectPath: selectedProject,
          workspaceId,
          title: `Terminal ${number}`,
          status: 'starting',
        },
      ],
      activeTabs: { ...state.activeTabs, [workspaceId]: id },
      focusVersion: state.focusVersion + 1,
    }))
  },
  selectTab(id) {
    const tab = get().tabs.find((item) => item.id === id)
    if (tab)
      set((state) => ({
        activeTabs: { ...state.activeTabs, [tab.workspaceId]: id },
        focusVersion: state.focusVersion + 1,
      }))
  },
  updateTab(id, value) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...value } : tab)),
    }))
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
    try {
      if (!unwrap(await window.desktop.closeTerminal(id))) return
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
    } catch (error) {
      console.error(error)
    } finally {
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
      .map(({ id, projectPath, workspaceId, title }) => ({ id, projectPath, workspaceId, title })),
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
if (import.meta.hot) import.meta.hot.dispose(unsubscribeLayout)
