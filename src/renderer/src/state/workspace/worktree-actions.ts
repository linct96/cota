import { removeTerminalPanes } from '../../../../shared/terminal-layout'
import { MAX_TERMINALS, unwrap } from '../../../../shared/contracts'
import type { CreateWorktreeResult } from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { TerminalTab, WorkspaceState } from './types'
import { currentWorkspace } from './selectors'

export const createWorktreeActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<WorkspaceState, 'createGitWorktree' | 'refreshWorktrees' | 'removeWorktree'>
> = (set, get) => {
  const scanRequests = new Map<string, number>()

  function adoptWorktree({ record, workspace, worktree }: CreateWorktreeResult): void {
    set((state) => {
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
        worktreeRecords: [
          ...state.worktreeRecords.filter((entry) => entry.id !== record.id),
          record,
        ],
        workspaces: [...state.workspaces.filter((entry) => entry.id !== workspace.id), workspace],
        selectedProject: record.projectPath,
        selectedWorkspaces: { ...state.selectedWorkspaces, [record.projectPath]: workspace.id },
        tabs: tab ? [...state.tabs, tab] : state.tabs,
        activeTabs: tab ? { ...state.activeTabs, [workspace.id]: tab.id } : state.activeTabs,
        focusVersion: state.focusVersion + 1,
        worktreeError:
          !existing && !tab
            ? 'Worktree 已就绪；终端已达上限，请关闭一个标签后新建终端。'
            : undefined,
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
  return {
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
              new Set(
                state.tabs.filter((tab) => removed.has(tab.workspaceId)).map((tab) => tab.id),
              ),
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
  }
}
