import { pruneProjectGrouping } from '../../../../shared/project-groups'
import { removeTerminalPanes } from '../../../../shared/terminal-layout'
import { unwrap } from '../../../../shared/contracts'
import type { ProjectWorkspace } from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { WorkspaceState } from './types'
import { currentWorkspace, nextWorkspaceName } from './selectors'

export function createWorkspace(path: string, name = '工作区'): ProjectWorkspace {
  return { id: crypto.randomUUID(), projectPath: path, name, kind: 'local' }
}

function projectWorkspaces(path: string, state: WorkspaceState): ProjectWorkspace[] {
  if (state.workspaces.some((workspace) => workspace.projectPath === path)) return state.workspaces
  return [...state.workspaces, createWorkspace(path)]
}

export const createWorkspaceActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<
    WorkspaceState,
    | 'changeProjectGrouping'
    | 'openProject'
    | 'selectProject'
    | 'newWorkspace'
    | 'renameWorkspace'
    | 'removeWorkspace'
    | 'removeProject'
  >
> = (set, get) => {
  return {
    async changeProjectGrouping(change) {
      if (get().removingWorkspace || get().updatingProjectGrouping)
        throw new Error('正在保存，请稍后重试。')
      set({ updatingProjectGrouping: true })
      try {
        const grouping = unwrap(await window.desktop.changeProjectGrouping(change))
        set((state) => ({ projectGrouping: pruneProjectGrouping(grouping, state.projects) }))
      } finally {
        set({ updatingProjectGrouping: false })
      }
    },

    async openProject(groupId) {
      if (get().removingWorkspace || get().creatingWorktree || get().updatingProjectGrouping) return
      set({ projectOpenError: undefined })
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
        if (groupId) {
          try {
            await get().changeProjectGrouping({ type: 'move', projectPath: path, groupId })
          } catch (error) {
            set({
              projectOpenError: `项目已添加，但无法加入分组：${error instanceof Error ? error.message : String(error)}`,
            })
          }
        }
      } catch (error) {
        console.error(error)
        set({ projectOpenError: error instanceof Error ? error.message : String(error) })
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
            projectGrouping: pruneProjectGrouping(state.projectGrouping, projects),
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
            projectGrouping: pruneProjectGrouping(state.projectGrouping, projects),
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
  }
}
