import { useShallow } from 'zustand/react/shallow'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { CopyMinus, CopyPlus, FolderOpen, FolderPlus, ListPlus } from 'lucide-react'
import { nextWorkspaceName, useWorkspace } from '@/state/workspace'
import type { WorkspaceTarget } from '../../../../../shared/contracts'
import { ShortcutKbd } from '@/components/ShortcutKbd'
import { useLeftPanel } from '@/state/left-panel-store'
import { WorktreeDialog } from '@/features/workspace/worktree/WorktreeDialog'
import { WorktreeSetupConfigDialog } from '@/features/workspace/worktree/WorktreeSetupConfigDialog'
import { WorktreeSetupDialog } from '@/features/workspace/worktree/WorktreeSetupDialog'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SourceControlSectionLayout } from '@/features/source-control/components/SourceControlSection'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useProjectBranches } from '@/features/workspace/hooks/use-project-branches'
import { useDialogState } from '@/hooks/use-dialog-state'
import { formatShortcut, shortcutBinding } from '../../../../../shared/shortcuts'
import type { ProjectSidebarActions } from './project-sidebar-actions'
import { ProjectGroup } from './ProjectGroup'
import { AgentList } from './AgentList'
import { ProjectSection } from './ProjectSection'
import {
  ProjectGroupNameDialog,
  ProjectGroupRemovalDialog,
} from '@/features/workspace/dialogs/ProjectGroupDialogs'
import type { ProjectGroupNameTarget } from '@/features/workspace/dialogs/ProjectGroupDialogs'
import type {
  ProjectGroup as ProjectGroupData,
  ProjectGroupingChange,
} from '../../../../../shared/project-groups'
import { WorkspaceNameDialog } from '@/features/workspace/dialogs/WorkspaceNameDialog'
import type { WorkspaceNameTarget } from '@/features/workspace/dialogs/WorkspaceNameDialog'
import { WorkspaceRemovalDialog } from '@/features/workspace/dialogs/WorkspaceRemovalDialog'
import type { WorkspaceRemovalTarget } from '@/features/workspace/dialogs/WorkspaceRemovalDialog'

export const ProjectSidebar = memo(function ProjectSidebar({
  projects,
  homeActive,
}: {
  projects: string[]
  homeActive: boolean
}) {
  const state = useWorkspace(
    useShallow((currentState) => ({
      workspaces: currentState.workspaces,
      worktreeRecords: currentState.worktreeRecords,
      removeWorkspace: currentState.removeWorkspace,
      ready: currentState.ready,
      removingWorkspace: currentState.removingWorkspace,
      openProject: currentState.openProject,
      shortcuts: currentState.preferences.shortcuts,
      projectGrouping: currentState.projectGrouping,
      changeProjectGrouping: currentState.changeProjectGrouping,
      updatingProjectGrouping: currentState.updatingProjectGrouping,
      projectOpenError: currentState.projectOpenError,
      creatingWorktree: currentState.creatingWorktree,
    })),
  )
  const leftPanelOpen = useLeftPanel((currentState) => currentState.open)
  const agentsOpen = useLeftPanel((currentState) => currentState.agentsOpen)
  const agentListTrigger = useRef<HTMLButtonElement>(null)
  const projectBranches = useProjectBranches(state.workspaces)
  const [worktreeProject, setWorktreeProject] = useState<string>()
  const [setupProject, setSetupProject] = useState<string>()
  const [setupTarget, setSetupTarget] = useState<{ target: WorkspaceTarget; error?: string }>()
  const menuTrigger = useRef<HTMLElement | null>(null)
  const workspaceDialogTrigger = useRef<HTMLElement | null>(null)
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({})
  const [groupNameTarget, setGroupNameTarget, groupNameDialog] =
    useDialogState<ProjectGroupNameTarget>()
  const [groupRemovalTarget, setGroupRemovalTarget, groupRemovalDialog] =
    useDialogState<ProjectGroupData>()
  const groupMenuTrigger = useRef<HTMLElement | null>(null)
  const [groupingError, setGroupingError] = useState<string>()
  const { groups } = state.projectGrouping
  const groupedProjects = new Set(groups.flatMap((group) => group.projects))
  const ungroupedProjects = projects.filter((path) => !groupedProjects.has(path))
  const groupingDisabled =
    !state.ready ||
    !!state.removingWorkspace ||
    state.updatingProjectGrouping ||
    state.creatingWorktree
  const { changeProjectGrouping } = state
  const runGroupingChange = useCallback(
    async (change: ProjectGroupingChange) => {
      setGroupingError(undefined)
      try {
        await changeProjectGrouping(change)
        return true
      } catch (error) {
        setGroupingError(error instanceof Error ? error.message : String(error))
        return false
      }
    },
    [changeProjectGrouping],
  )
  const hasOpenProject = projects.some((path) => openProjects[path] !== false)
  const toggleProjectsLabel = hasOpenProject ? '折叠全部项目' : '展开全部项目'
  const [removal, setRemoval, removalDialog] = useDialogState<WorkspaceRemovalTarget>()
  const [workspaceDialog, setWorkspaceDialog, workspaceNameDialog] =
    useDialogState<WorkspaceNameTarget>()
  const shortcutLabel = (id: string) =>
    formatShortcut(
      shortcutBinding(state.shortcuts, id, window.desktop.platform),
      window.desktop.platform,
    )
  const { workspaces, worktreeRecords, removeWorkspace } = state
  const actions = useMemo<ProjectSidebarActions>(
    () => ({
      rememberMenuTrigger(trigger) {
        menuTrigger.current = trigger
      },
      createWorkspace(projectPath, trigger) {
        workspaceDialogTrigger.current = trigger
        setWorkspaceDialog({ projectPath, name: nextWorkspaceName(projectPath, workspaces) })
      },
      editWorkspace(workspace, scan, trigger) {
        workspaceDialogTrigger.current = trigger
        setWorkspaceDialog({
          projectPath: workspace.projectPath,
          id: workspace.id,
          name: workspace.name,
          worktree: worktreeRecords.find((entry) => entry.id === workspace.worktreeId),
          scan,
        })
      },
      createGroup(projectPath, trigger) {
        groupMenuTrigger.current = trigger
        setGroupNameTarget({ name: '', projectPath })
      },
      moveProject(projectPath, groupId) {
        void runGroupingChange({ type: 'move', projectPath, groupId }).then((saved) => {
          if (saved)
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLButtonElement>(
                  `[data-project-path="${CSS.escape(projectPath)}"] .project-folder-trigger`,
                )
                ?.focus(),
            )
        })
      },
      removeProject(projectPath) {
        setRemoval({ projectPath })
      },
      removeWorkspace(workspace) {
        if (workspace.kind === 'git-worktree') void removeWorkspace(workspace.id)
        else setRemoval({ projectPath: workspace.projectPath, workspace })
      },
      createWorktree: setWorktreeProject,
      configureWorktree: setSetupProject,
      initializeWorktree: (target) => setSetupTarget({ target }),
    }),
    [
      workspaces,
      worktreeRecords,
      removeWorkspace,
      setWorkspaceDialog,
      setRemoval,
      runGroupingChange,
      setGroupNameTarget,
    ],
  )
  const renderProject = (path: string) => (
    <ProjectSection
      key={path}
      path={path}
      open={openProjects[path] !== false}
      onOpenChange={(open) => setOpenProjects((value) => ({ ...value, [path]: open }))}
      projectBranch={projectBranches[path]}
      homeActive={homeActive}
      actions={actions}
      menuTrigger={menuTrigger}
    />
  )
  return (
    <>
      <aside
        className={cn(
          'project-sidebar min-h-0 flex-1 flex-col bg-muted/40 text-app-muted-foreground',
          leftPanelOpen ? 'flex' : 'hidden',
        )}
        inert={!leftPanelOpen}
        aria-label="项目"
      >
        <SourceControlSectionLayout
          defaultOpen={agentsOpen}
          resizeLabel="调整项目与 Agent 列表高度"
          onOpenChange={(open) => {
            if (useLeftPanel.getState().agentsOpen === open) return
            if (!open && document.activeElement?.closest('#project-agent-list')) {
              agentListTrigger.current?.focus()
            }
            useLeftPanel.setState({ agentsOpen: open })
          }}
          section={(open, onOpenChange) => (
            <AgentList
              homeActive={homeActive}
              projectBranches={projectBranches}
              open={open}
              onOpenChange={onOpenChange}
              triggerRef={agentListTrigger}
            />
          )}
        >
          <div className="project-header group/header flex h-12 shrink-0 items-center justify-between pl-4 pr-3">
            <h2 className="project-title">项目</h2>
            <div className="project-header-actions flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="project"
                      size="icon-sm"
                      className="project-toggle-all-button opacity-0 transition-opacity focus-visible:opacity-100 disabled:opacity-0 group-hover/header:opacity-100"
                      disabled={!projects.length || !state.ready || !!state.removingWorkspace}
                      aria-label={toggleProjectsLabel}
                      onClick={() => {
                        setOpenProjects(
                          Object.fromEntries(projects.map((path) => [path, !hasOpenProject])),
                        )
                      }}
                    />
                  }
                >
                  {hasOpenProject ? (
                    <CopyMinus className="project-toggle-all-icon" aria-hidden="true" />
                  ) : (
                    <CopyPlus className="project-toggle-all-icon" aria-hidden="true" />
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom" className="project-toggle-all-tooltip">
                  {toggleProjectsLabel}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="project"
                      size="icon-sm"
                      className="project-add-button opacity-0 transition-opacity focus-visible:opacity-100 disabled:opacity-0 group-hover/header:opacity-100"
                      disabled={groupingDisabled}
                      aria-label="添加项目"
                      onClick={() => {
                        void state.openProject()
                      }}
                    />
                  }
                >
                  <FolderPlus className="project-add-icon" />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  添加项目
                  <ShortcutKbd
                    binding={shortcutBinding(
                      state.shortcuts,
                      'open-folder',
                      window.desktop.platform,
                    )}
                  />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="project"
                      size="icon-sm"
                      className="project-create-group-button opacity-0 transition-opacity focus-visible:opacity-100 disabled:opacity-0 group-hover/header:opacity-100"
                      disabled={groupingDisabled}
                      aria-label="新建分组"
                      onClick={(event) => {
                        groupMenuTrigger.current = event.currentTarget
                        setGroupNameTarget({ name: '' })
                      }}
                    />
                  }
                >
                  <ListPlus className="project-create-group-icon" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="project-create-group-tooltip">
                  新建分组
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {(groupingError || state.projectOpenError) && (
            <p className="project-grouping-error px-4 pb-2 text-xs text-destructive" role="alert">
              {groupingError || state.projectOpenError}
            </p>
          )}
          <ScrollArea className="project-list-scroll-area min-h-0 min-w-0 flex-1">
            <nav
              className="project-list recent-projects flex min-w-0 flex-col gap-2 p-2"
              aria-label="项目列表"
            >
              {groups.map((group) => {
                const groupProjects = projects.filter((path) => group.projects.includes(path))
                return (
                  <ProjectGroup
                    key={group.id}
                    group={group}
                    disabled={groupingDisabled}
                    onCollapsedChange={(collapsed) => {
                      void runGroupingChange({ type: 'collapse', id: group.id, collapsed })
                    }}
                    onAdd={() => {
                      void state.openProject(group.id)
                    }}
                    onRename={() => setGroupNameTarget({ id: group.id, name: group.name })}
                    onRemove={() => setGroupRemovalTarget(group)}
                    rememberTrigger={(trigger) => {
                      groupMenuTrigger.current = trigger
                    }}
                  >
                    {groupProjects.map(renderProject)}
                  </ProjectGroup>
                )
              })}
              {ungroupedProjects.map(renderProject)}
              {!projects.length && !groups.length && (
                <Empty className="project-empty-state flex-none px-3 py-8">
                  <EmptyHeader className="project-empty-header">
                    <EmptyMedia variant="icon" className="project-empty-media">
                      <FolderOpen className="project-empty-icon" aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle className="project-empty-title">暂无项目</EmptyTitle>
                    <EmptyDescription className="project-empty-description">
                      点击上方 + 或按 {shortcutLabel('open-folder')} 添加
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </nav>
          </ScrollArea>
        </SourceControlSectionLayout>
      </aside>
      <ProjectGroupNameDialog
        target={groupNameTarget}
        dialog={groupNameDialog}
        trigger={groupMenuTrigger}
        onClose={() => setGroupNameTarget(undefined)}
      />
      <ProjectGroupRemovalDialog
        target={groupRemovalTarget}
        dialog={groupRemovalDialog}
        trigger={groupMenuTrigger}
        onClose={() => setGroupRemovalTarget(undefined)}
      />
      {worktreeProject && (
        <WorktreeDialog
          key={worktreeProject}
          projectPath={worktreeProject}
          close={() => setWorktreeProject(undefined)}
          initialized={(target, error) => setSetupTarget({ target, error })}
        />
      )}
      {setupProject && (
        <WorktreeSetupConfigDialog
          key={setupProject}
          projectPath={setupProject}
          close={() => setSetupProject(undefined)}
        />
      )}
      {setupTarget && (
        <WorktreeSetupDialog
          key={setupTarget.target.workspaceId}
          target={setupTarget.target}
          initialError={setupTarget.error}
          close={() => setSetupTarget(undefined)}
          configure={() => {
            setSetupProject(setupTarget.target.projectPath)
            setSetupTarget(undefined)
          }}
        />
      )}
      <WorkspaceNameDialog
        target={workspaceDialog}
        dialog={workspaceNameDialog}
        trigger={workspaceDialogTrigger}
        onClose={() => setWorkspaceDialog(undefined)}
        onCreated={(path) => setOpenProjects((current) => ({ ...current, [path]: true }))}
      />
      <WorkspaceRemovalDialog
        target={removal}
        dialog={removalDialog}
        trigger={menuTrigger}
        onClose={() => setRemoval(undefined)}
      />
    </>
  )
})
