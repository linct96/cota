import type { TerminalBinding, WorkspaceTarget } from '../../../shared/contracts'
import type { ConfigStore } from '../../settings/config-store'
import { WorktreeError } from './git'
import { absolutePath, projectDirectory, workspaceTarget } from '../../validation'
import { validateTerminalBinding } from '../../terminal/terminal-binding'
import type { GitService } from './git'

export class WorktreeAccess {
  private readonly operations = new Map<string, Promise<unknown>>()
  constructor(
    readonly config: ConfigStore,
    readonly directory: string,
    readonly git: GitService,
  ) {
    absolutePath(directory)
  }

  // Terminal creation and destructive operations share one repository gate.
  async withRepositoryLock<T>(repoCommonDir: string, action: () => T | Promise<T>): Promise<T> {
    const previous = this.operations.get(repoCommonDir) || Promise.resolve()
    const operation = previous.catch(() => {}).then(action)
    this.operations.set(repoCommonDir, operation)
    try {
      return await operation
    } finally {
      if (this.operations.get(repoCommonDir) === operation) this.operations.delete(repoCommonDir)
    }
  }

  authorizeProject(value: string): string {
    const path = absolutePath(value)
    if (!this.config.snapshot().recentProjects.includes(path))
      throw new WorktreeError('INVALID_INPUT', '请先打开项目目录。')
    return path
  }

  async withProjectTarget<T>(
    value: string,
    action: (binding: { cwd: string; repoCommonDir: string }) => Promise<T>,
  ): Promise<T> {
    await this.config.flush()
    const path = this.authorizeProject(value)
    const repository = await this.git.requireRepository(path)
    return this.withRepositoryLock(repository.repoCommonDir, async () => {
      this.authorizeProject(path)
      const current = await this.git.requireRepository(path)
      if (
        current.repoCommonDir !== repository.repoCommonDir ||
        current.rootPath !== repository.rootPath
      )
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新读取。')
      return action({ cwd: current.rootPath, repoCommonDir: current.repoCommonDir })
    })
  }

  async withTerminalTarget<T>(
    value: WorkspaceTarget,
    action: (binding: TerminalBinding) => T | Promise<T>,
  ): Promise<T> {
    const target = workspaceTarget(value)
    await this.config.flush()
    this.authorizeProject(target.projectPath)
    const snapshot = this.config.snapshot()
    const workspace = snapshot.layout?.workspaces.find(
      (entry) => entry.id === target.workspaceId && entry.projectPath === target.projectPath,
    )
    if (!workspace)
      throw new WorktreeError('INVALID_INPUT', '工作区未保存或已变更，请重新选择工作区。')
    const record =
      workspace.kind === 'git-worktree'
        ? snapshot.worktreeRecords.find(
            (entry) =>
              entry.id === workspace.worktreeId && entry.projectPath === target.projectPath,
          )
        : undefined
    if (workspace.kind === 'git-worktree' && !record)
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', 'Worktree 登记缺失，工作目录不可用。')
    const binding: TerminalBinding = record
      ? {
          ...target,
          workspaceKind: 'git-worktree',
          cwd: record.path,
          worktreeId: record.id,
          repoCommonDir: record.repoCommonDir,
        }
      : { ...target, workspaceKind: 'local', cwd: await projectDirectory(target.projectPath) }
    const repository = record
      ? { repoCommonDir: record.repoCommonDir }
      : await this.git.inspectRepository(target.projectPath)
    const key = 'repoCommonDir' in repository ? repository.repoCommonDir : binding.cwd
    return this.withRepositoryLock(key, async () => {
      this.authorizeProject(target.projectPath)
      const current = this.config.snapshot()
      const latest = current.layout?.workspaces.find((entry) => entry.id === workspace.id)
      if (
        !latest ||
        JSON.stringify(latest) !== JSON.stringify(workspace) ||
        (record &&
          !current.worktreeRecords.some(
            (entry) => JSON.stringify(entry) === JSON.stringify(record),
          ))
      )
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '工作区绑定已改变，请重新扫描。')
      await validateTerminalBinding(binding, this.git)
      return action(binding)
    })
  }
}
