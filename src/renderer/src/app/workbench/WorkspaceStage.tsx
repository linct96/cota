import { useShallow } from 'zustand/react/shallow'
import { FolderOpen, Terminal as TerminalIcon } from 'lucide-react'
import { useWorkspace } from '@/state/workspace'
import { TerminalWorkspace } from '@/features/terminal/components/TerminalWorkspace'
import { SourceControlDiff } from '@/features/source-control/components/SourceControlDiff'
import { FilePreview } from '@/features/files/components/FilePreview'
import { SourceControlChanges } from '@/features/source-control/components/SourceControlChanges'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { formatShortcut, shortcutBinding } from '../../../../shared/shortcuts'
import type { WorkspaceView } from './use-workspace-view'

export function WorkspaceStage({
  view,
  secondaryPageOpen,
  activeNavigation,
}: {
  view: WorkspaceView
  secondaryPageOpen: boolean
  activeNavigation: 'home' | 'settings' | 'cortana'
}) {
  const state = useWorkspace(
    useShallow((state) => ({
      worktreeError: state.worktreeError,
      selectedProject: state.selectedProject,
      openProject: state.openProject,
      removingWorkspace: state.removingWorkspace,
      newTerminal: state.newTerminal,
      shortcuts: state.preferences.shortcuts,
    })),
  )
  const {
    activeWorkspace,
    activeId,
    currentTabs,
    sourceControl,
    showingChanges,
    showingFile,
    activePinnedFile,
    activePinnedDiff,
    showingPreview,
    previewSelection,
    showingDiff,
    projects,
  } = view
  const shortcutLabel = (id: string) =>
    formatShortcut(
      shortcutBinding(state.shortcuts, id, window.desktop.platform),
      window.desktop.platform,
    )
  return (
    <main
      className="terminal-workspace flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={showingDiff ? (showingFile ? '文件预览工作区' : '变更审阅工作区') : '终端工作区'}
    >
      {state.worktreeError && (
        <p
          className="workspace-worktree-error px-4 py-2 text-xs text-destructive break-words"
          role="alert"
        >
          {state.worktreeError}
        </p>
      )}
      {sourceControl.changesOpen && activeWorkspace && (
        <div
          className={cn(
            'source-control-changes-stage min-h-0 min-w-0 flex-1 flex-col',
            showingChanges ? 'flex' : 'hidden',
          )}
        >
          <SourceControlChanges
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            active={!secondaryPageOpen && showingChanges}
          />
        </div>
      )}
      {activeWorkspace && showingFile && (
        <FilePreview
          key={`${activeWorkspace.id}:${showingFile}`}
          workspace={activeWorkspace}
          path={showingFile}
          pinned={!!activePinnedFile}
          active={!secondaryPageOpen}
        />
      )}
      {activeWorkspace && (activePinnedDiff || (showingPreview && previewSelection)) && (
        <SourceControlDiff
          key={activeWorkspace.id}
          workspace={activeWorkspace}
          active={!secondaryPageOpen}
        />
      )}
      <div
        className={cn(
          'terminal-stage-container grid grid-cols-1 grid-rows-1 min-h-0 flex-1 overflow-hidden',
          showingDiff && 'hidden',
        )}
      >
        <TerminalWorkspace
          activeId={activeId}
          visible={!secondaryPageOpen && !showingDiff && activeNavigation === 'home'}
        />
        {!state.selectedProject && (
          <Empty className="workspace-empty-state col-start-1 row-start-1 size-full rounded-none p-8">
            <EmptyHeader className="workspace-empty-content">
              <EmptyMedia variant="icon" className="workspace-empty-media">
                <FolderOpen
                  className="workspace-empty-icon text-app-muted-foreground"
                  aria-hidden="true"
                />
              </EmptyMedia>
              <EmptyTitle className="workspace-empty-title">
                {projects.length ? '未选择工作区' : '没有打开的项目'}
              </EmptyTitle>
              <EmptyDescription className="workspace-empty-desc text-app-muted-foreground">
                {projects.length
                  ? `从左侧选择一个工作区，或使用快捷键 ${shortcutLabel('open-folder')} 打开新项目。`
                  : `从左侧选择最近项目，或使用快捷键 ${shortcutLabel('open-folder')} 打开新项目。`}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              size="sm"
              className="workspace-empty-action"
              onClick={() => {
                void state.openProject()
              }}
            >
              打开项目 ({shortcutLabel('open-folder')})
            </Button>
          </Empty>
        )}
        {state.selectedProject && !currentTabs.length && (
          <Empty className="terminal-empty-state col-start-1 row-start-1 size-full rounded-none p-8">
            <EmptyHeader className="terminal-empty-content">
              <EmptyMedia variant="icon" className="terminal-empty-media">
                <TerminalIcon
                  className="terminal-empty-icon text-app-muted-foreground"
                  aria-hidden="true"
                />
              </EmptyMedia>
              <EmptyTitle className="terminal-empty-title">当前工作区没有运行中的终端</EmptyTitle>
              <EmptyDescription className="terminal-empty-desc text-app-muted-foreground">
                点击上方 + 按钮，或使用快捷键 {shortcutLabel('new-terminal')} 新建终端。
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              size="sm"
              className="terminal-empty-action"
              disabled={!!state.removingWorkspace}
              onClick={() => state.newTerminal()}
            >
              新建终端 ({shortcutLabel('new-terminal')})
            </Button>
          </Empty>
        )}
      </div>
    </main>
  )
}
