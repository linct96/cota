import { useSourceControl } from '../source-control-store'
import { useRightPanel } from '../right-panel-store'
import { gitFileKey } from '../../../../shared/source-control'
import { terminalPaneIds } from '../../../../shared/terminal-layout'
import type { TerminalPane } from '../../../../shared/terminal-layout'
import { MAX_TERMINALS } from '../../../../shared/contracts'
import {
  terminalIndicatorState,
  workspaceTerminalSummary,
} from '../../features/agents/lib/agent-status'
import type { StateCreator } from 'zustand'
import type { WorkspaceState } from './types'
import { currentWorkspace, terminalTabId, terminalTabs } from './selectors'

export function activeWorkspaceTab(state: WorkspaceState, workspaceId: string): string | undefined {
  const session = useSourceControl.getState().sessions[workspaceId]
  if (session?.changesActive) return 'changes'
  if (session?.activePinnedDiff) return `diff:${gitFileKey(session.activePinnedDiff)}`
  if (session?.activePinnedFile) return `file:${session.activePinnedFile}`
  if (session?.preview) return 'preview'
  const id = state.activeTabs[workspaceId]
  return id ? `terminal:${terminalTabId(state, id)}` : undefined
}

export function adjacentWorkspaceTab(workspaceId: string, key: string): string | undefined {
  const order = useSourceControl.getState().sessions[workspaceId]?.tabOrder || []
  const index = order.indexOf(key)
  return index < 0 ? undefined : order[index + 1] || order[index - 1]
}

export const createTabActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<
    WorkspaceState,
    | 'reopenTab'
    | 'selectTab'
    | 'selectWorkspaceTab'
    | 'closeWorkspaceTab'
    | 'reorderTab'
    | 'shortcut'
    | 'openDiff'
    | 'openFile'
  >
> = (set, get) => {
  return {
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
      if (!session) return
      const tab = session.closedTabs.at(-1)
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
          set((currentState) => ({
            terminalLayouts: [
              ...currentState.terminalLayouts,
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
          if (tab.selection) get().openDiff(workspace.id, tab.selection)
          else if (tab.file) get().openFile(workspace.id, tab.file)
          break
      }
      sourceControl.update(workspace.id, { closedTabs: session.closedTabs.slice(0, -1) })
      set((currentState) => ({
        selectedProject: workspace.projectPath,
        selectedWorkspaces: {
          ...currentState.selectedWorkspaces,
          [workspace.projectPath]: workspace.id,
        },
        focusVersion: currentState.focusVersion + 1,
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
        const group = get().terminalLayouts.find((candidateGroup) => candidateGroup.id === id)
        const panes = group
          ? terminalPaneIds(group.root).flatMap((paneId) => {
              const tab = get().tabs.find((candidateTab) => candidateTab.id === paneId)
              return tab ? [tab] : []
            })
          : []
        const focused = panes.find((pane) => pane.id === group?.activePaneId) || panes.at(0)
        const indicatorState =
          group && activeWorkspaceTab(get(), workspaceId) !== key
            ? workspaceTerminalSummary(panes)?.state
            : undefined
        const preferred =
          indicatorState &&
          ['error', 'failed', 'succeeded', 'completed', 'needs-input'].includes(indicatorState)
            ? [focused, ...panes].find(
                (pane) => pane && terminalIndicatorState(pane) === indicatorState,
              )
            : undefined
        get().selectTab(preferred?.id || focused?.id || id)
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
      const active = activeWorkspaceTab(get(), workspaceId) === key
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
      const tab = terminalTabs(state).find(
        (candidateTab) => candidateTab.workspaceId === workspaceId && candidateTab.id === id,
      )
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
        .filter((candidateTab) => candidateTab.workspaceId === workspaceId)
        .sort(
          (a, b) =>
            order.indexOf(`terminal:${terminalTabId(state, a.id)}`) -
            order.indexOf(`terminal:${terminalTabId(state, b.id)}`),
        )
      let index = 0
      set({
        tabs: state.tabs.map((item) =>
          item.workspaceId === workspaceId ? ordered[index++] : item,
        ),
      })
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
          if (id && activeWorkspaceTab(get(), workspaceId)?.startsWith('terminal:'))
            get().splitTerminal(id, value === 'split-terminal-down' ? 'vertical' : 'horizontal')
          break
        }
        case 'reopen-tab':
          get().reopenTab()
          break
        case 'close-terminal': {
          const key = activeWorkspaceTab(get(), workspaceId)
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
    openDiff(workspaceId, selection) {
      useSourceControl
        .getState()
        .openDiff(workspaceId, selection, get().preferences.reusePreviewTabs)
    },
    openFile(workspaceId, path) {
      useSourceControl.getState().openFile(workspaceId, path, get().preferences.reusePreviewTabs)
    },
  }
}
