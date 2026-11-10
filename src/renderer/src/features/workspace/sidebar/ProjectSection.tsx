import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Folder, FolderOpen, GitFork, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { currentWorkspace, useWorkspace } from '@/state/workspace'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { abbreviateHomePath, cn, folderName } from '@/lib/utils'
import type { RefObject } from 'react'
import type { ProjectSidebarActions } from './project-sidebar-actions'
import { WorkspaceItem } from './WorkspaceItem'

export const ProjectSection = memo(function ProjectSection({
  path,
  open,
  onOpenChange,
  projectBranch,
  homeActive,
  actions,
  menuTrigger,
}: {
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  projectBranch?: string | null
  homeActive: boolean
  actions: ProjectSidebarActions
  menuTrigger: RefObject<HTMLElement | null>
}) {
  const state = useWorkspace(
    useShallow((currentState) => ({
      workspaces: currentState.workspaces,
      selectedProject: currentState.selectedProject,
      selectedWorkspaces: currentState.selectedWorkspaces,
      removingWorkspace: currentState.removingWorkspace,
      worktreeScans: currentState.worktreeScans,
      ready: currentState.ready,
      projectGroups: currentState.projectGrouping.groups,
      updatingProjectGrouping: currentState.updatingProjectGrouping,
      creatingWorktree: currentState.creatingWorktree,
    })),
  )
  const activeWorkspace = currentWorkspace(state)
  const workspaces = state.workspaces.filter((workspace) => workspace.projectPath === path)
  return (
    <Collapsible
      key={path}
      open={open}
      onOpenChange={onOpenChange}
      render={<section />}
      aria-label={`${folderName(path)} 项目`}
      data-project-path={path}
      aria-busy={
        state.removingWorkspace === path ||
        workspaces.some((workspace) => workspace.id === state.removingWorkspace)
      }
      className="project-section flex shrink-0 flex-col gap-1"
    >
      <div className="project-folder-row group/folder flex items-center pr-1 transition-colors">
        <h3 className="project-folder-heading min-w-0 flex-1">
          <CollapsibleTrigger
            render={(props, { open: nextOpen }) => (
              <Button {...props} variant="project">
                {nextOpen ? (
                  <FolderOpen className="project-folder-icon" />
                ) : (
                  <Folder className="project-folder-icon" />
                )}
                <span className="project-folder-name truncate">{folderName(path)}</span>
              </Button>
            )}
            className="project-folder-trigger w-full min-w-0 justify-start gap-2 px-2 bg-transparent text-inherit hover:bg-transparent hover:text-inherit"
            title={abbreviateHomePath(path)}
            disabled={!!state.removingWorkspace}
          />
        </h3>
        {state.worktreeScans[path]?.repository.status === 'ready' && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="project" size="icon-sm" />}
              className={cn(
                'project-worktree-add-button bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent',
                activeWorkspace?.projectPath !== path &&
                  'invisible focus-visible:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
              )}
              aria-label={`${folderName(path)} 新建工作树`}
              aria-haspopup="dialog"
              disabled={!state.ready || !!state.removingWorkspace || state.creatingWorktree}
              onClick={() => actions.createWorktree(path)}
            >
              <GitFork className="project-worktree-add-icon" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="project-worktree-add-tooltip">
              新建工作树
            </TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="project" size="icon-sm" />}
                  className={cn(
                    'project-folder-menu-trigger shrink-0 bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent',
                    activeWorkspace?.projectPath !== path &&
                      'invisible focus-visible:visible group-hover/folder:visible group-has-data-popup-open/folder:visible',
                  )}
                  disabled={!!state.removingWorkspace}
                  aria-label={`${folderName(path)} 更多操作`}
                  onFocus={(event) => {
                    actions.rememberMenuTrigger(event.currentTarget)
                  }}
                />
              }
            >
              <MoreHorizontal className="project-folder-menu-icon size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="project-folder-menu-tooltip">
              更多操作
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            aria-label={`${folderName(path)} 项目操作菜单`}
            className="project-folder-dropdown-menu"
          >
            <DropdownMenuGroup className="project-folder-menu-actions">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className="project-move-group-trigger"
                  disabled={state.updatingProjectGrouping || !!state.removingWorkspace}
                >
                  移动到分组
                </DropdownMenuSubTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="project-move-group-menu"
                  aria-label="移动到分组"
                >
                  {state.projectGroups.length > 0 && (
                    <>
                      <DropdownMenuRadioGroup
                        className="project-move-group-options"
                        value={
                          state.projectGroups.find((group) => group.projects.includes(path))?.id ||
                          ''
                        }
                        onValueChange={(groupId) => actions.moveProject(path, groupId || null)}
                      >
                        {state.projectGroups.map((group) => (
                          <DropdownMenuRadioItem
                            key={group.id}
                            value={group.id}
                            className="project-move-group-option"
                          >
                            <span
                              className="project-move-group-name max-w-48 truncate"
                              title={group.name}
                            >
                              {group.name}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                        <DropdownMenuRadioItem value="" className="project-move-ungrouped-option">
                          未分组
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator className="project-move-group-separator" />
                    </>
                  )}
                  <DropdownMenuGroup className="project-move-group-create-actions">
                    <DropdownMenuItem
                      className="project-move-create-group-item"
                      onClick={() => actions.createGroup(path, menuTrigger.current)}
                    >
                      <Plus className="project-move-create-group-icon" aria-hidden="true" />
                      <span className="project-move-create-group-label">新建分组</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                className="project-new-local-workspace-item"
                disabled={!state.ready || !!state.removingWorkspace}
                onClick={() => actions.createWorkspace(path, menuTrigger.current)}
              >
                新建工作区
              </DropdownMenuItem>
              {state.worktreeScans[path]?.repository.status === 'ready' && (
                <DropdownMenuItem
                  className="project-worktree-setup-item"
                  disabled={!state.ready || !!state.removingWorkspace}
                  onClick={() => actions.configureWorktree(path)}
                >
                  工作树初始化配置
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                className="project-delete-item"
                disabled={!!state.removingWorkspace}
                onClick={() => actions.removeProject(path)}
              >
                <Trash2 className="project-delete-icon" />
                <span className="project-delete-label">删除项目</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CollapsibleContent className="project-workspaces flex flex-col gap-1">
        {workspaces.map((workspace) => (
          <WorkspaceItem
            key={workspace.id}
            workspace={workspace}
            projectBranch={projectBranch}
            homeActive={homeActive}
            actions={actions}
            menuTrigger={menuTrigger}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
})
