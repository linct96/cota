import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Pencil, Trash2 } from 'lucide-react'
import { currentWorkspace, useWorkspace } from '@/state/workspace'
import { useLeftPanel } from '@/state/left-panel-store'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import { AgentMenu } from '@/features/agents/components/AgentMenu'
import { DotStatus } from '@/components/DotStatus'
import { workspaceTerminalSummary } from '@/features/agents/lib/agent-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn, folderName } from '@/lib/utils'
import type { RefObject } from 'react'
import type { ProjectSidebarActions } from './project-sidebar-actions'
import { WorkspaceAgentActions } from './WorkspaceAgentActions'

export const WorkspaceItem = memo(function WorkspaceItem({
  workspace,
  projectBranch,
  homeActive,
  actions,
  menuTrigger,
}: {
  workspace: ProjectWorkspace
  projectBranch?: string | null
  homeActive: boolean
  actions: ProjectSidebarActions
  menuTrigger: RefObject<HTMLElement | null>
}) {
  const state = useWorkspace(
    useShallow((currentState) => ({
      selectedProject: currentState.selectedProject,
      workspaceId: currentWorkspace(currentState)?.id,
      scanEntry:
        workspace.kind === 'git-worktree'
          ? currentState.worktreeScans[workspace.projectPath]?.entries.find(
              (entry) => entry.record.id === workspace.worktreeId,
            )
          : undefined,
      removingWorkspace: currentState.removingWorkspace,
      ready: currentState.ready,
      creatingWorktree: currentState.creatingWorktree,
      selectProject: currentState.selectProject,
    })),
  )
  const agentsOpen = useLeftPanel((currentState) => currentState.agentsOpen)
  const path = workspace.projectPath
  const workspaceId = state.workspaceId
  const isSelected = path === state.selectedProject && workspace.id === workspaceId
  const scanEntry = state.scanEntry
  const worktree = scanEntry?.worktree
  const branch =
    workspace.kind === 'local'
      ? projectBranch
      : worktree?.branch || (worktree?.head ? `detached ${worktree.head.slice(0, 8)}` : undefined)
  const workspaceTabs = useWorkspace(
    useShallow((currentState) =>
      currentState.tabs.filter((tab) => tab.workspaceId === workspace.id),
    ),
  )
  const hasTerminals = workspaceTabs.length > 0

  const terminalSummary = workspaceTerminalSummary(workspaceTabs)
  return (
    <ContextMenu key={workspace.id} disabled={!!state.removingWorkspace}>
      <ContextMenuTrigger
        className={cn(
          'project-item group relative isolate ml-2 flex flex-col items-stretch rounded-md transition-colors',
          isSelected
            ? 'project-item-active bg-sidebar-accent text-sidebar-accent-foreground'
            : 'project-item-inactive text-app-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
        onContextMenu={(event) => {
          actions.rememberMenuTrigger(
            event.currentTarget.querySelector<HTMLButtonElement>('.project-item-button'),
          )
        }}
      >
        <Button
          variant="ghost"
          disabled={!!state.removingWorkspace}
          data-active={isSelected}
          aria-label={`${folderName(path)} ${workspace.name}${workspace.kind === 'git-worktree' ? '，Git Worktree' : ''}，${hasTerminals ? '有终端' : '无终端'}${terminalSummary ? `，${terminalSummary.description}` : ''}${branch ? `，分支 ${branch}` : ''}`}
          aria-current={isSelected ? 'page' : undefined}
          aria-haspopup="menu"
          className="project-item-button grid h-auto min-h-9 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-2 gap-y-0 border-0 px-2 py-2 text-left text-inherit hover:bg-transparent hover:text-inherit focus-visible:ring-0 dark:hover:bg-transparent"
          onClick={() => {
            void state.selectProject(path, workspace.id)
          }}
        >
          <span
            className="project-item-status flex size-3.5 items-center justify-center"
            aria-hidden="true"
          >
            <DotStatus
              state={
                terminalSummary && terminalSummary.state !== 'other'
                  ? terminalSummary.state
                  : hasTerminals
                    ? 'idle'
                    : 'empty'
              }
            />
          </span>
          <span className="project-item-name truncate">{workspace.name}</span>
          {workspace.kind === 'git-worktree' &&
            scanEntry &&
            (scanEntry.status !== 'ready' || worktree?.locked) && (
              <div className="project-item-worktree-alert col-start-2 mt-0.5 flex items-center">
                <Badge
                  variant={scanEntry.status === 'ready' ? 'secondary' : 'destructive'}
                  className="project-item-worktree-status h-4 px-1.5 text-[10px] font-normal"
                  title={scanEntry.error}
                >
                  {scanEntry.status === 'ready'
                    ? 'Worktree · 已锁定'
                    : `Worktree · ${scanEntry.status}`}
                </Badge>
              </div>
            )}
          {branch && (
            <span
              className="project-item-branch col-start-2 truncate text-xs leading-4 font-normal text-app-muted-foreground"
              title={branch}
            >
              {branch}
            </span>
          )}
        </Button>
        {!agentsOpen && (
          <WorkspaceAgentActions
            workspace={workspace}
            isSelected={isSelected}
            homeActive={homeActive}
          />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent
        finalFocus={() => menuTrigger.current}
        aria-label={`${folderName(path)} ${workspace.name} 操作菜单`}
        className="project-dropdown-menu"
      >
        <ContextMenuGroup className="project-menu-actions">
          <AgentMenu
            workspaceId={workspace.id}
            disabled={
              !state.ready ||
              state.creatingWorktree ||
              !!state.removingWorkspace ||
              (workspace.kind === 'git-worktree' && scanEntry?.status !== 'ready')
            }
          />
          {workspace.kind === 'git-worktree' && (
            <ContextMenuItem
              className="workspace-initialize-item"
              disabled={!state.ready || !!state.removingWorkspace || scanEntry?.status !== 'ready'}
              onClick={() =>
                actions.initializeWorktree({ projectPath: path, workspaceId: workspace.id })
              }
            >
              初始化环境 / 查看日志
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={!!state.removingWorkspace}
            className="workspace-edit-item"
            onClick={() => actions.editWorkspace(workspace, scanEntry, menuTrigger.current)}
          >
            <Pencil className="workspace-edit-icon" />
            <span className="workspace-edit-label">编辑</span>
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            title={
              workspace.kind === 'git-worktree'
                ? '检查并确认后删除工作树及本地分支；存在未提交内容或未合并分支时需确认强制删除'
                : '仅删除此工作区并结束其终端，不影响其他工作区或本地文件'
            }
            disabled={!!state.removingWorkspace || state.creatingWorktree}
            className="workspace-delete-item"
            onClick={() => actions.removeWorkspace(workspace)}
          >
            <Trash2 className="workspace-delete-icon" />
            <span className="workspace-delete-label">
              {workspace.kind === 'git-worktree' ? '删除工作树' : '删除工作区'}
            </span>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
})
