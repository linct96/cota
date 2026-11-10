import type { TerminalBinding, TerminalSession, WorkspaceTarget } from '../../../shared/contracts'
import type { ConfigStore } from '../../settings/config-store'
import { GitService } from './git'
import { WorktreeAccess } from './access'
import { WorktreePaths } from './paths'
import { WorktreeCreation } from './creation'
import { WorktreeRegistry } from './registry'
import { WorktreeRemoval } from './removal'

export class WorktreeManager {
  readonly initializing = new Set<string>()
  private readonly access: WorktreeAccess
  private readonly creation: WorktreeCreation
  private readonly registry: WorktreeRegistry
  private readonly removal: WorktreeRemoval

  constructor(config: ConfigStore, directory: string, git = new GitService()) {
    this.access = new WorktreeAccess(config, directory, git)
    const paths = new WorktreePaths(this.access)
    this.creation = new WorktreeCreation(this.access, paths)
    this.registry = new WorktreeRegistry(this.access)
    this.removal = new WorktreeRemoval(this.access, paths, this.initializing)
  }

  get removing(): boolean {
    return this.removal.removing
  }

  withRepositoryLock<T>(repoCommonDir: string, action: () => T | Promise<T>): Promise<T> {
    return this.access.withRepositoryLock(repoCommonDir, action)
  }

  withProjectTarget<T>(
    value: string,
    action: (binding: { cwd: string; repoCommonDir: string }) => Promise<T>,
  ): Promise<T> {
    return this.access.withProjectTarget(value, action)
  }

  withTerminalTarget<T>(
    value: WorkspaceTarget,
    action: (binding: TerminalBinding) => T | Promise<T>,
  ): Promise<T> {
    return this.access.withTerminalTarget(value, action)
  }

  inspectRepository(value: string) {
    return this.access.git.inspectRepository(this.access.authorizeProject(value))
  }
  listWorktrees(value: string) {
    return this.registry.listWorktrees(value)
  }
  createWorktree(value: unknown) {
    return this.creation.createWorktree(value)
  }
  planWorktree(value: unknown) {
    return this.creation.planWorktree(value)
  }
  suggestName(value: string) {
    return this.creation.suggestName(value)
  }
  scanWorktrees(value: string, sessions: TerminalSession[] = [], includeClosed = false) {
    return this.registry.scanWorktrees(value, sessions, includeClosed)
  }
  linkWorktree(projectPath: string, requestedPath: string) {
    return this.registry.linkWorktree(projectPath, requestedPath)
  }
  inspectRemoval(value: string, sessions: TerminalSession[]) {
    return this.removal.inspectRemoval(value, sessions)
  }
  removeWorktree(value: string, options: Parameters<WorktreeRemoval['removeWorktree']>[1]) {
    return this.removal.removeWorktree(value, options)
  }
  unlinkWorktree(value: string, options: Parameters<WorktreeRemoval['unlinkWorktree']>[1]) {
    return this.removal.unlinkWorktree(value, options)
  }
}
