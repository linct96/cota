import { useShallow } from 'zustand/react/shallow'
import { memo, useMemo, useRef, useState } from 'react'
import { CopyMinus, CopyPlus, FolderOpen, FolderPlus } from 'lucide-react'
import { nextWorkspaceName, useWorkspace } from '@/state/workspace'
import { type WorkspaceTarget } from '../../../../../shared/contracts'
import { ShortcutKbd } from '@/components/ShortcutKbd'
import { useLeftPanel } from '@/state/left-panel-store'
import { WorktreeDialog } from '@/features/workspace/worktree/WorktreeDialog'
import { WorktreeSetupConfigDialog } from '@/features/workspace/worktree/WorktreeSetupConfigDialog'
import { WorktreeSetupDialog } from '@/features/workspace/worktree/WorktreeSetupDialog'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useProjectBranches } from '@/features/workspace/hooks/use-project-branches'
import { useDialogState } from '@/hooks/use-dialog-state'
import { formatShortcut, shortcutBinding } from '../../../../../shared/shortcuts'
import type { ProjectSidebarActions } from './project-sidebar-actions'
import { ProjectGroup } from './ProjectGroup'
import {
  WorkspaceNameDialog,
  type WorkspaceNameTarget,
} from '@/features/workspace/dialogs/WorkspaceNameDialog'
import {
  WorkspaceRemovalDialog,
  type WorkspaceRemovalTarget,
} from '@/features/workspace/dialogs/WorkspaceRemovalDialog'

export const ProjectSidebar = memo(function ProjectSidebar({
  projects,
  homeActive,
}: {
  projects: string[]
  homeActive: boolean
}) {
  const state = useWorkspace(
    useShallow((state) => ({
      workspaces: state.workspaces,
      worktreeRecords: state.worktreeRecords,
      removeWorkspace: state.removeWorkspace,
      ready: state.ready,
      removingWorkspace: state.removingWorkspace,
      openProject: state.openProject,
      shortcuts: state.preferences.shortcuts,
    })),
  )
  const leftPanelOpen = useLeftPanel((state) => state.open)
  const projectBranches = useProjectBranches(state.workspaces)
  const [worktreeProject, setWorktreeProject] = useState<string>()
  const [setupProject, setSetupProject] = useState<string>()
  const [setupTarget, setSetupTarget] = useState<{ target: WorkspaceTarget; error?: string }>()
  const menuTrigger = useRef<HTMLElement | null>(null)
  const workspaceDialogTrigger = useRef<HTMLElement | null>(null)
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({})
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
    [workspaces, worktreeRecords, removeWorkspace, setWorkspaceDialog, setRemoval],
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
                    disabled={!state.ready || !!state.removingWorkspace}
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
                  binding={shortcutBinding(state.shortcuts, 'open-folder', window.desktop.platform)}
                />
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <ScrollArea className="project-list-scroll-area min-h-0 min-w-0 flex-1">
          <nav
            className="project-list recent-projects flex min-w-0 flex-col gap-2 p-2"
            aria-label="最近项目"
          >
            {projects.map((path) => (
              <ProjectGroup
                key={path}
                path={path}
                open={openProjects[path] !== false}
                onOpenChange={(open) => setOpenProjects((value) => ({ ...value, [path]: open }))}
                projectBranch={projectBranches[path]}
                homeActive={homeActive}
                actions={actions}
                menuTrigger={menuTrigger}
              />
            ))}
            {!projects.length && (
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
      </aside>
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
