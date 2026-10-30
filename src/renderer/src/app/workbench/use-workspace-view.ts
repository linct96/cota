import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { currentWorkspace, terminalTabs, useWorkspace } from '@/state/workspace'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { folderName } from '@/lib/utils'

export function useWorkspaceView() {
  const state = useWorkspace(
    useShallow((state) => ({
      workspaces: state.workspaces,
      selectedProject: state.selectedProject,
      selectedWorkspaces: state.selectedWorkspaces,
      worktreeScans: state.worktreeScans,
      tabs: state.tabs,
      terminalLayouts: state.terminalLayouts,
      closingTerminalTabs: state.closingTerminalTabs,
      activeTabs: state.activeTabs,
    })),
  )
  const activeWorkspace = currentWorkspace(state)
  const workspaceId = activeWorkspace?.id
  const repository = activeWorkspace && state.worktreeScans[activeWorkspace.projectPath]?.repository
  const gitAvailable = !!repository && repository.status !== 'nonGit'
  const { tabs, terminalLayouts, closingTerminalTabs } = state
  const currentTabs = useMemo(
    () =>
      terminalTabs({ tabs, terminalLayouts, closingTerminalTabs }).filter(
        (tab) => tab.workspaceId === workspaceId,
      ),
    [tabs, terminalLayouts, closingTerminalTabs, workspaceId],
  )
  const activeId = state.activeTabs[workspaceId || '']
  const sourceControl = useSourceControl(
    useShallow((state) => {
      const session = state.sessions[workspaceId || ''] || EMPTY_SOURCE_CONTROL
      return {
        tabOrder: session.tabOrder,
        selection: session.selection,
        file: session.file,
        pinnedDiffs: session.pinnedDiffs,
        activePinnedDiff: session.activePinnedDiff,
        pinnedFiles: session.pinnedFiles,
        activePinnedFile: session.activePinnedFile,
        preview: session.preview,
        changesOpen: session.changesOpen,
        changesActive: session.changesActive,
      }
    }),
  )
  const previewSelection = sourceControl.selection
  const hasPreview = !!sourceControl.file || !!previewSelection
  const previewPath = sourceControl.file || previewSelection?.path || ''
  const previewTitle = `${folderName(previewPath)}${previewSelection ? '（Diff）' : ''}`
  const activePinnedDiff = sourceControl.activePinnedDiff
  const activePinnedFile = sourceControl.activePinnedFile
  const showingPreview = hasPreview && sourceControl.preview
  const showingChanges = sourceControl.changesOpen && sourceControl.changesActive
  const showingFile = activePinnedFile || (showingPreview ? sourceControl.file : undefined)
  const showingDiff = showingPreview || showingChanges || !!activePinnedDiff || !!activePinnedFile
  // Keep projects with workspaces or terminals reachable outside the recent 20.
  const projects = useWorkspace(
    useShallow((state) => [
      ...new Set([
        ...state.projects,
        ...state.workspaces.map((workspace) => workspace.projectPath),
        ...state.tabs.map((tab) => tab.projectPath),
        ...state.worktreeRecords.map((record) => record.projectPath),
        ...state.orphanSessions.map((session) => session.projectPath),
      ]),
    ]),
  )

  return {
    activeWorkspace,
    workspaceId,
    gitAvailable,
    currentTabs,
    activeId,
    sourceControl,
    previewSelection,
    hasPreview,
    previewPath,
    previewTitle,
    activePinnedDiff,
    activePinnedFile,
    showingPreview,
    showingChanges,
    showingFile,
    showingDiff,
    projects,
  }
}

export type WorkspaceView = ReturnType<typeof useWorkspaceView>
