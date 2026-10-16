import { create } from 'zustand'
import {
  DEFAULT_CONFIG,
  MAX_TERMINALS,
  unwrap,
  type Preferences,
  type ProjectWorkspace,
  type WorkspaceLayout,
  type Shortcut,
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
  settingsOpen: boolean
  focusVersion: number
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
  shortcut(value: Shortcut): void
}

function recent(path: string, projects: string[]): string[] {
  return [path, ...projects.filter((item) => item !== path)].slice(0, 20)
}

function createWorkspace(path: string, name = '工作区 1'): ProjectWorkspace {
  return { id: crypto.randomUUID(), projectPath: path, name }
}

export function nextWorkspaceName(path: string, workspaces: ProjectWorkspace[]): string {
  const numbers = workspaces
    .filter((workspace) => workspace.projectPath === path)
    .map((workspace) => Number(/^工作区 (\d+)$/.exec(workspace.name)?.[1] || 0))
    .filter(Number.isSafeInteger)
  return `工作区 ${Math.max(0, ...numbers) + 1}`
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

export const useWorkspace = create<Workspace>((set, get) => ({
  ready: false,
  layoutLoaded: false,
  projects: [],
  workspaces: [],
  selectedWorkspaces: {},
  preferences: DEFAULT_CONFIG.preferences,
  tabs: [],
  activeTabs: {},
  settingsOpen: false,
  focusVersion: 0,
  async bootstrap() {
    try {
      const { config, sessions, warning } = unwrap(await window.desktop.bootstrap())
      if (warning) console.warn(warning)
      const layout = config.layout
      const workspaces = [...(layout?.workspaces || [])]
      const tabs: TerminalTab[] = []
      for (const session of sessions) {
        if (!config.recentProjects.includes(session.projectPath)) continue
        if (!workspaces.some((workspace) => workspace.id === session.workspaceId))
          workspaces.push({
            id: session.workspaceId,
            projectPath: session.projectPath,
            name: nextWorkspaceName(session.projectPath, workspaces),
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
      })
    } catch (error) {
      console.error(error)
      set({ ready: true })
    }
  },
  async openProject() {
    if (get().removingWorkspace) return
    try {
      const path = unwrap(await window.desktop.openProject())
      if (path)
        set((state) => ({
          projects: state.projects.includes(path) ? state.projects : recent(path, state.projects),
          workspaces: projectWorkspaces(path, state),
          selectedProject: path,
          focusVersion: state.focusVersion + 1,
        }))
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
    if (!workspace || get().removingWorkspace) return false
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
    const workspaceId = currentWorkspace(get())?.id
    if (!workspaceId) return
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
    set({ preferences: saved, settingsOpen: false })
  },
  shortcut(value) {
    if (get().removingWorkspace || (get().settingsOpen && value !== 'settings')) return
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
      case 'settings':
        set({ settingsOpen: true })
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
