import {
  type ProjectWorkspace,
  type WorkspaceTarget,
  type WorktreeState,
} from '../../../../../shared/contracts'

export interface ProjectSidebarActions {
  rememberMenuTrigger(trigger: HTMLElement | null): void
  createWorkspace(projectPath: string, trigger: HTMLElement | null): void
  editWorkspace(
    workspace: ProjectWorkspace,
    scan: WorktreeState | undefined,
    trigger: HTMLElement | null,
  ): void
  removeProject(projectPath: string): void
  removeWorkspace(workspace: ProjectWorkspace): void
  createWorktree(projectPath: string): void
  configureWorktree(projectPath: string): void
  initializeWorktree(target: WorkspaceTarget): void
}
