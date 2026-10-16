import { create } from 'zustand'
import {
  DEFAULT_CONFIG,
  MAX_TERMINALS,
  unwrap,
  type AppConfig,
  type Preferences,
  type Shortcut,
} from '../../shared/contracts'

export interface TerminalTab {
  id: string
  projectPath: string
  title: string
  status: 'starting' | 'running' | 'exited' | 'error'
  exitCode?: number
  error?: string
  closingStatus?: TerminalTab['status']
}

interface Workspace {
  ready: boolean
  projects: string[]
  selectedProject?: string
  removingProject?: string
  preferences: Preferences
  tabs: TerminalTab[]
  activeTabs: Record<string, string>
  error?: string
  settingsOpen: boolean
  focusVersion: number
  bootstrap(): Promise<void>
  openProject(): Promise<void>
  selectProject(path: string): Promise<void>
  removeProject(path: string): Promise<void>
  newTerminal(): void
  selectTab(id: string): void
  updateTab(id: string, value: Partial<TerminalTab>): void
  closeTab(id?: string): Promise<void>
  savePreferences(value: Preferences): Promise<void>
  report(error?: unknown): void
  shortcut(value: Shortcut): void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function recent(path: string, projects: string[]): string[] {
  return [path, ...projects.filter((item) => item !== path)].slice(0, 20)
}

export const useWorkspace = create<Workspace>((set, get) => ({
  ready: false,
  projects: [],
  preferences: DEFAULT_CONFIG.preferences,
  tabs: [],
  activeTabs: {},
  settingsOpen: false,
  focusVersion: 0,
  async bootstrap() {
    try {
      const { config, warning }: { config: AppConfig; warning?: string } = unwrap(
        await window.desktop.bootstrap(),
      )
      set({
        ready: true,
        projects: config.recentProjects,
        selectedProject: config.recentProjects[0],
        preferences: config.preferences,
        error: warning,
      })
    } catch (error) {
      set({ ready: true, error: message(error) })
    }
  },
  async openProject() {
    if (get().removingProject) return
    try {
      const path = unwrap(await window.desktop.openProject())
      if (path)
        set((state) => ({
          projects: state.projects.includes(path) ? state.projects : recent(path, state.projects),
          selectedProject: path,
          focusVersion: state.focusVersion + 1,
          error: undefined,
        }))
    } catch (error) {
      get().report(error)
    }
  },
  async selectProject(path) {
    if (get().removingProject) return
    try {
      unwrap(await window.desktop.selectProject(path))
      set((state) => ({
        projects: state.projects.includes(path) ? state.projects : [...state.projects, path],
        selectedProject: path,
        focusVersion: state.focusVersion + 1,
        error: undefined,
      }))
    } catch (error) {
      get().report(error)
    }
  },
  async removeProject(path) {
    if (get().removingProject) return
    set({ removingProject: path })
    try {
      if (!unwrap(await window.desktop.removeProject(path))) return
      set((state) => {
        const projects = state.projects.filter((item) => item !== path)
        const tabs = state.tabs.filter((tab) => tab.projectPath !== path)
        const activeTabs = { ...state.activeTabs }
        delete activeTabs[path]
        const selectedProject =
          state.selectedProject === path
            ? projects[0] || tabs[0]?.projectPath
            : state.selectedProject
        return {
          projects,
          tabs,
          activeTabs,
          selectedProject,
          focusVersion: state.focusVersion + 1,
          error: undefined,
        }
      })
    } catch (error) {
      get().report(error)
    } finally {
      set((state) => ({ removingProject: undefined, focusVersion: state.focusVersion + 1 }))
    }
  },
  newTerminal() {
    const { selectedProject, tabs, removingProject } = get()
    if (!selectedProject || removingProject) return
    if (tabs.length >= MAX_TERMINALS) {
      get().report('最多保留 10 个终端，请先关闭一个标签。')
      return
    }
    const id = crypto.randomUUID()
    const number =
      Math.max(
        0,
        ...tabs
          .filter((tab) => tab.projectPath === selectedProject)
          .map((tab) => Number(tab.title.split(' ')[1])),
      ) + 1
    set((state) => ({
      tabs: [
        ...state.tabs,
        { id, projectPath: selectedProject, title: `Terminal ${number}`, status: 'starting' },
      ],
      activeTabs: { ...state.activeTabs, [selectedProject]: id },
      focusVersion: state.focusVersion + 1,
      error: undefined,
    }))
  },
  selectTab(id) {
    const tab = get().tabs.find((item) => item.id === id)
    if (tab)
      set((state) => ({
        activeTabs: { ...state.activeTabs, [tab.projectPath]: id },
        focusVersion: state.focusVersion + 1,
      }))
  },
  updateTab(id, value) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...value } : tab)),
    }))
  },
  async closeTab(id) {
    if (get().removingProject) return
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
        const activeTabs = { ...state.activeTabs }
        if (activeTabs[tab.projectPath] === id) {
          const remaining = tabs.filter((item) => item.projectPath === tab.projectPath)
          if (remaining.length) activeTabs[tab.projectPath] = remaining[remaining.length - 1].id
          else delete activeTabs[tab.projectPath]
        }
        return { tabs, activeTabs, focusVersion: state.focusVersion + 1 }
      })
    } catch (error) {
      get().report(error)
    } finally {
      if (get().tabs.some((item) => item.id === id))
        get().updateTab(id, { closingStatus: undefined })
    }
  },
  async savePreferences(value) {
    const saved = unwrap(await window.desktop.savePreferences(value))
    set({ preferences: saved, settingsOpen: false })
  },
  report(error) {
    set({ error: error === undefined ? undefined : message(error) })
  },
  shortcut(value) {
    if (get().removingProject || (get().settingsOpen && value !== 'settings')) return
    switch (value) {
      case 'open-folder':
        void get().openProject()
        break
      case 'new-terminal':
        get().newTerminal()
        break
      case 'close-terminal':
        void get().closeTab(get().activeTabs[get().selectedProject || ''])
        break
      case 'settings':
        set({ settingsOpen: true })
        break
      default: {
        const tab = get().tabs.filter((item) => item.projectPath === get().selectedProject)[
          Number(value.slice(4)) - 1
        ]
        if (tab) get().selectTab(tab.id)
      }
    }
  },
}))
