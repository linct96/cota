import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  CreateWorktreeResult,
  GitWorktreeInfo,
  ProjectWorkspace,
  TerminalSession,
  WorktreeRecord,
  WorktreeScan,
} from '../../../shared/contracts'
import { absolutePath, projectDirectory } from '../../validation'
import { WorktreeError } from './git'
import type { WorktreeAccess } from './access'

export class WorktreeRegistry {
  constructor(private readonly access: WorktreeAccess) {}

  async listWorktrees(value: string): Promise<GitWorktreeInfo[]> {
    const path = this.access.authorizeProject(value)
    const repository = await this.access.git.requireRepository(path)
    const worktrees = await this.access.git.listWorktrees(path)
    return this.applyRecords(repository.repoCommonDir, worktrees)
  }

  private applyRecords(repoCommonDir: string, worktrees: GitWorktreeInfo[]): GitWorktreeInfo[] {
    const records = this.access.config.snapshot().worktreeRecords
    return worktrees.map((worktree) => {
      const record = records.find(
        (entry) => entry.repoCommonDir === repoCommonDir && entry.path === worktree.path,
      )
      return {
        ...worktree,
        managedByCota: !worktree.isMain && !worktree.isBare && record?.origin === 'created',
        ...(record ? { worktreeId: record.id } : {}),
      }
    })
  }

  async scanWorktrees(
    value: string,
    sessions: TerminalSession[] = [],
    includeClosed = false,
  ): Promise<WorktreeScan> {
    const path =
      includeClosed &&
      this.access.config.snapshot().worktreeRecords.some((record) => record.projectPath === value)
        ? absolutePath(value)
        : this.access.authorizeProject(value)
    const records = this.access.config
      .snapshot()
      .worktreeRecords.filter((entry) => entry.projectPath === path)
    const repository = await this.access.git.inspectRepository(path)
    if (repository.status !== 'ready')
      return {
        repository,
        external: [],
        entries: records.map((record) => ({
          record,
          status: 'unavailable',
          error: repository.error,
        })),
      }
    let worktrees: GitWorktreeInfo[]
    try {
      worktrees = this.applyRecords(
        repository.repoCommonDir,
        await this.access.git.listWorktrees(path),
      )
    } catch (error) {
      return {
        repository,
        error: (error as Error).message,
        external: [],
        entries: records.map((record) => ({
          record,
          status: 'unavailable',
          error: (error as Error).message,
        })),
      }
    }
    const entries: WorktreeScan['entries'] = []
    for (const record of records) {
      const worktree = worktrees.find((entry) => entry.path === record.path)
      let status: WorktreeScan['entries'][number]['status'] = 'ready'
      let error: string | undefined
      if (record.repoCommonDir !== repository.repoCommonDir) {
        status = 'conflict'
        error = '仓库身份与登记不一致。'
      } else if (!worktree || worktree.prunable) {
        status = 'missing'
        error = worktree?.prunable
          ? '需要 Git 元数据修复；不会自动 prune。'
          : 'Git 已不再登记此目录。'
      } else {
        try {
          if ((await projectDirectory(record.path)) !== record.path)
            throw new Error('目录真实路径改变。')
          const identity = await this.access.git.requireRepository(record.path)
          if (
            identity.repoCommonDir !== record.repoCommonDir ||
            identity.rootPath !== record.path
          ) {
            status = 'conflict'
            error = '目标目录的仓库身份已改变。'
          }
        } catch (failure) {
          try {
            await lstat(record.path)
            status = 'unavailable'
          } catch (probe) {
            status = (probe as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'
          }
          error = (failure as Error).message
        }
      }
      if (
        sessions.some(
          (session) =>
            (session.worktreeId === record.id || session.cwd === record.path) &&
            (session.worktreeId !== record.id ||
              session.repoCommonDir !== record.repoCommonDir ||
              session.cwd !== record.path ||
              session.projectPath !== record.projectPath ||
              session.workspaceKind !== 'git-worktree'),
        )
      ) {
        status = 'conflict'
        error = 'Host 会话与 Worktree 登记身份不一致。'
      }
      entries.push({ record, worktree, status, error })
    }
    return {
      repository,
      entries,
      external: worktrees.filter(
        (entry) =>
          !entry.isMain && !entry.isBare && !records.some((record) => record.path === entry.path),
      ),
    }
  }

  async linkWorktree(projectPath: string, requestedPath: string): Promise<CreateWorktreeResult> {
    this.access.authorizeProject(projectPath)
    const repository = await this.access.git.requireRepository(projectPath)
    return this.access.withRepositoryLock(repository.repoCommonDir, async () => {
      this.access.authorizeProject(projectPath)
      if (
        (await this.access.git.requireRepository(projectPath)).repoCommonDir !==
        repository.repoCommonDir
      )
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描。')
      this.access.config.assertWritable()
      const path = await projectDirectory(requestedPath)
      if (path !== absolutePath(requestedPath))
        throw new WorktreeError('PATH_CONFLICT', '目录经过符号链接。')
      const identity = await this.access.git.requireRepository(path)
      const worktree = (await this.access.git.listWorktrees(projectPath)).find(
        (entry) => entry.path === path,
      )
      if (
        identity.repoCommonDir !== repository.repoCommonDir ||
        !worktree ||
        worktree.isMain ||
        worktree.isBare ||
        worktree.prunable
      )
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '目标不是此仓库可用的 linked Worktree。')
      const snapshot = this.access.config.snapshot()
      const existing = snapshot.worktreeRecords.find(
        (entry) => entry.repoCommonDir === repository.repoCommonDir && entry.path === path,
      )
      if (existing && existing.projectPath !== projectPath)
        throw new WorktreeError('PATH_CONFLICT', '此 Worktree 已关联到另一个项目。')
      const record: WorktreeRecord = existing || {
        id: randomUUID(),
        projectPath,
        path,
        repoCommonDir: repository.repoCommonDir,
        repoId: createHash('sha256').update(repository.repoCommonDir).digest('hex').slice(0, 24),
        origin: 'linked',
        registeredAt: new Date().toISOString(),
      }
      const workspace: ProjectWorkspace = snapshot.layout?.workspaces.find(
        (entry) => entry.kind === 'git-worktree' && entry.worktreeId === record.id,
      ) || {
        id: randomUUID(),
        projectPath,
        name: worktree.branch || basename(path),
        kind: 'git-worktree',
        worktreeId: record.id,
      }
      await this.access.config.registerWorktree(record, workspace)
      return {
        record,
        workspace,
        worktree: {
          ...worktree,
          worktreeId: record.id,
          managedByCota: record.origin === 'created',
        },
      }
    })
  }
}
