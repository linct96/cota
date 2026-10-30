import { useShallow } from 'zustand/react/shallow'
import { FileDiff, Plus } from 'lucide-react'
import { terminalTabId, useWorkspace } from '@/state/workspace'
import { gitFileKey } from '../../../../shared/source-control'
import { TerminalTabList } from './TerminalTabList'
import { TerminalTab } from './TerminalTab'
import { WorkspaceTab } from './WorkspaceTab'
import { OpenWorkspaceButton } from '@/features/workspace/open-with/OpenWorkspaceButton'
import { QuickCommandsButton } from '@/features/workspace/quick-commands/QuickCommandsButton'
import { WorkspaceServicesButton } from '@/features/workspace/services/WorkspaceServicesButton'
import { WorkspacePortsButton } from '@/features/workspace/services/WorkspacePortsButton'
import { FileTypeIcon } from '@/features/files/components/FileTypeIcon'
import { useSourceControl } from '@/state/source-control-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { abbreviateHomePath, folderName } from '@/lib/utils'
import type { WorkspaceView } from './use-workspace-view'

export function WorkspaceHeader({ view }: { view: WorkspaceView }) {
  const state = useWorkspace(
    useShallow((state) => ({
      removingWorkspace: state.removingWorkspace,
      closeWorkspaceTab: state.closeWorkspaceTab,
      selectedProject: state.selectedProject,
      selectWorkspaceTab: state.selectWorkspaceTab,
      closeTab: state.closeTab,
      creatingWorktree: state.creatingWorktree,
      worktreeScans: state.worktreeScans,
      newTerminal: state.newTerminal,
      terminalLayouts: state.terminalLayouts,
    })),
  )
  const {
    activeWorkspace,
    workspaceId,
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
    showingDiff,
  } = view
  function focusActiveTab() {
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(
          '.terminal-tab-list [role="tab"][aria-selected="true"]',
        ) || document.getElementById('right-panel-toggle')
      )?.focus(),
    )
  }
  function pinPreview() {
    if (!workspaceId || !hasPreview || state.removingWorkspace) return
    const sourceControl = useSourceControl.getState()
    if (previewSelection) sourceControl.pinDiff(workspaceId)
    else sourceControl.pinFile(workspaceId)
    requestAnimationFrame(() =>
      document
        .getElementById(
          previewSelection
            ? `source-control-pinned-tab-${workspaceId}-${encodeURIComponent(gitFileKey(previewSelection))}`
            : `file-pinned-tab-${workspaceId}-${encodeURIComponent(previewPath)}`,
        )
        ?.focus(),
    )
  }
  function closeWorkspaceTab(key: string, active: boolean) {
    if (!workspaceId) return
    state.closeWorkspaceTab(workspaceId, key)
    if (active) focusActiveTab()
  }
  return (
    <div className="terminal-tabs-region flex h-full min-w-0 flex-1 items-center gap-1">
      <Separator
        aria-hidden="true"
        orientation="vertical"
        className="terminal-tabs-separator bg-titlebar-separator data-vertical:h-4 data-vertical:self-center"
      />
      {state.selectedProject && (
        <>
          {workspaceId &&
            (currentTabs.length > 0 ||
              hasPreview ||
              sourceControl.changesOpen ||
              sourceControl.pinnedDiffs.length > 0 ||
              sourceControl.pinnedFiles.length > 0) && (
              <TerminalTabList
                key={workspaceId}
                workspaceId={workspaceId}
                tabs={currentTabs}
                order={sourceControl.tabOrder}
                disabled={!!state.removingWorkspace}
              >
                {sourceControl.tabOrder.map((key, index) => {
                  const tab = currentTabs.find((tab) => key === `terminal:${tab.id}`)
                  if (tab)
                    return (
                      <TerminalTab
                        key={key}
                        tab={tab}
                        indicatorTab={tab.indicatorTab}
                        index={index}
                        active={!showingDiff && tab.id === terminalTabId(state, activeId || '')}
                        closeDisabled={
                          tab.status === 'starting' ||
                          !!tab.closingStatus ||
                          !!state.removingWorkspace
                        }
                        onSelect={() =>
                          state.selectWorkspaceTab(tab.workspaceId, `terminal:${tab.id}`)
                        }
                        onClose={() => void state.closeTab(tab.id)}
                      />
                    )
                  if (key === 'changes')
                    return (
                      <WorkspaceTab
                        key={key}
                        id={`source-control-changes-tab-${workspaceId}`}
                        aria-controls={`source-control-changes-panel-${workspaceId}`}
                        title="全部变更"
                        label="全部变更"
                        active={showingChanges}
                        width={112}
                        className="source-control-changes-workspace-tab"
                        onSelect={() => useSourceControl.getState().openChanges(workspaceId)}
                        onClose={() => closeWorkspaceTab(key, showingChanges)}
                        closeDisabled={!!state.removingWorkspace}
                        icon={
                          <FileDiff
                            className="source-control-changes-tab-icon size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        }
                      />
                    )
                  const selection = sourceControl.pinnedDiffs.find(
                    (selection) => key === `diff:${gitFileKey(selection)}`,
                  )
                  if (selection) {
                    const diffKey = gitFileKey(selection)
                    const label = `${folderName(selection.path)}（Diff）`
                    const active = !!activePinnedDiff && gitFileKey(activePinnedDiff) === diffKey
                    return (
                      <WorkspaceTab
                        key={key}
                        id={`source-control-pinned-tab-${workspaceId}-${encodeURIComponent(diffKey)}`}
                        aria-controls={`source-control-pinned-panel-${workspaceId}-${encodeURIComponent(diffKey)}`}
                        aria-label={`${selection.path}（Diff）`}
                        title={`${selection.path}（Diff）`}
                        label={label}
                        active={active}
                        className="source-control-pinned-tab"
                        onSelect={() =>
                          useSourceControl.getState().selectPinnedDiff(workspaceId, diffKey)
                        }
                        onClose={() => closeWorkspaceTab(key, active)}
                        closeDisabled={!!state.removingWorkspace}
                        closeLabel={`关闭 ${selection.path}（Diff）`}
                        icon={<FileTypeIcon path={selection.path} />}
                      />
                    )
                  }
                  const file = sourceControl.pinnedFiles.find((path) => key === `file:${path}`)
                  if (file) {
                    const active = activePinnedFile === file
                    return (
                      <WorkspaceTab
                        key={key}
                        id={`file-pinned-tab-${workspaceId}-${encodeURIComponent(file)}`}
                        aria-controls={`file-pinned-panel-${workspaceId}-${encodeURIComponent(file)}`}
                        aria-label={abbreviateHomePath(file)}
                        title={abbreviateHomePath(file)}
                        label={folderName(file)}
                        active={active}
                        className="file-pinned-tab"
                        onSelect={() =>
                          useSourceControl.getState().selectPinnedFile(workspaceId, file)
                        }
                        onClose={() => closeWorkspaceTab(key, active)}
                        closeDisabled={!!state.removingWorkspace}
                        closeLabel={`关闭 ${abbreviateHomePath(file)}`}
                        icon={<FileTypeIcon path={file} />}
                      />
                    )
                  }
                  if (key === 'preview' && hasPreview)
                    return (
                      <WorkspaceTab
                        key={key}
                        id={`source-control-tab-${workspaceId}`}
                        aria-controls={`source-control-panel-${workspaceId}`}
                        aria-label={`${abbreviateHomePath(previewPath)}${previewSelection ? '（Diff）' : ''} 预览`}
                        title={`${abbreviateHomePath(previewPath)}${previewSelection ? '（Diff）' : ''} · 双击或 Enter 固定`}
                        label={previewTitle}
                        active={showingPreview}
                        className="source-control-preview-tab"
                        data-diff={!!previewSelection}
                        onDoubleClick={(event) => {
                          if (
                            !state.removingWorkspace &&
                            event.target instanceof Element &&
                            !event.target.closest('button')
                          )
                            pinPreview()
                        }}
                        onKeyDownCapture={(event) => {
                          if (
                            showingPreview &&
                            event.target === event.currentTarget &&
                            event.key === 'Enter' &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.altKey &&
                            !event.shiftKey
                          ) {
                            event.preventDefault()
                            pinPreview()
                          }
                        }}
                        onSelect={() => {
                          if (workspaceId)
                            useSourceControl.getState().update(workspaceId, { preview: true })
                        }}
                        onClose={() => closeWorkspaceTab(key, showingPreview)}
                        closeLabel={`关闭 ${abbreviateHomePath(previewPath)}${previewSelection ? '（Diff）' : ''} 预览`}
                        closeDisabled={!!state.removingWorkspace}
                        icon={<FileTypeIcon path={previewPath} />}
                      />
                    )
                  return null
                })}
              </TerminalTabList>
            )}
          <Button
            variant="navigation"
            size="icon"
            className="terminal-tab-new-button shrink-0"
            disabled={
              !activeWorkspace ||
              !!state.removingWorkspace ||
              state.creatingWorktree ||
              (activeWorkspace.kind === 'git-worktree' &&
                state.worktreeScans[activeWorkspace.projectPath]?.entries.find(
                  (entry) => entry.record.id === activeWorkspace.worktreeId,
                )?.status !== 'ready')
            }
            aria-label="新建终端"
            onClick={() => state.newTerminal()}
          >
            <Plus className="terminal-tab-new-icon" />
          </Button>
        </>
      )}
      <div className="workspace-header-spacer min-w-0 flex-1" />
      {activeWorkspace && (
        <div
          className="workspace-toolbar-actions flex shrink-0 items-center gap-1.5 pr-2"
          role="toolbar"
          aria-label="工作区工具"
        >
          <WorkspacePortsButton key={`ports-${activeWorkspace.id}`} workspace={activeWorkspace} />
          <WorkspaceServicesButton
            key={`services-${activeWorkspace.id}`}
            workspaceId={activeWorkspace.id}
          />
          <QuickCommandsButton key={`commands-${activeWorkspace.id}`} workspace={activeWorkspace} />
          <OpenWorkspaceButton key={activeWorkspace.id} workspace={activeWorkspace} />
        </div>
      )}
    </div>
  )
}
