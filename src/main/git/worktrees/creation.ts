import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  CreateWorktreeResult,
  GitWorktreeInfo,
  WorktreeRecord,
  WorktreePlan,
  WorktreeNameSuggestion,
} from '../../../shared/contracts'
import { suggestWorktreeName } from '../../../shared/worktree-names'
import { createWorktreeInput, projectDirectory } from '../../validation'
import { WorktreeError } from './git'
import type { WorktreeAccess } from './access'
import type { WorktreePaths } from './paths'

export class WorktreeCreation {
  private readonly plans = new Map<
    string,
    { plan: WorktreePlan; commonDir: string; expires: number }
  >()
  constructor(
    private readonly access: WorktreeAccess,
    private readonly paths: WorktreePaths,
  ) {}

  async createWorktree(value: unknown): Promise<CreateWorktreeResult> {
    let input
    try {
      input = createWorktreeInput(value)
    } catch (error) {
      throw new WorktreeError('INVALID_INPUT', (error as Error).message)
    }
    this.access.authorizeProject(input.projectPath)
    this.access.config.assertWritable()
    const repository = await this.access.git.requireRepository(input.projectPath)
    return this.access.withRepositoryLock(repository.repoCommonDir, async () => {
      const operationId = randomUUID()
      const started = Date.now()
      let outcome = 'failed'
      try {
        this.access.authorizeProject(input.projectPath)
        this.access.config.assertWritable()
        const current = await this.access.git.requireRepository(input.projectPath)
        if (current.repoCommonDir !== repository.repoCommonDir)
          throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描后再创建。')
        const records = this.access.config.snapshot().worktreeRecords
        if (records.length >= 10000)
          throw new WorktreeError('INVALID_INPUT', 'Worktree 登记数量已达上限。')
        const before = await this.access.git.listWorktrees(current.rootPath)
        if (
          records.some(
            (record) =>
              record.repoCommonDir !== current.repoCommonDir &&
              before.some((entry) => entry.path === record.path),
          )
        )
          throw new WorktreeError(
            'REPOSITORY_UNAVAILABLE',
            '发现仓库移动或登记身份冲突，请先修复登记。',
          )
        const oid = await this.access.git.validateNewBranch(
          current.rootPath,
          input.branchName,
          input.baseRef,
        )
        const repoId =
          records.find((record) => record.repoCommonDir === current.repoCommonDir)?.repoId ||
          createHash('sha256').update(current.repoCommonDir).digest('hex').slice(0, 24)
        const requestedPlan = (value as { planId?: unknown }).planId
        const saved = typeof requestedPlan === 'string' ? this.plans.get(requestedPlan) : undefined
        if (
          requestedPlan !== undefined &&
          (!saved ||
            saved.expires < Date.now() ||
            saved.commonDir !== current.repoCommonDir ||
            Object.entries(input).some(
              ([key, entry]) => saved.plan[key as keyof typeof input] !== entry,
            ))
        )
          throw new WorktreeError('INVALID_INPUT', '目录计划已失效，请重新预览后再创建。')
        const id = saved?.plan.id || randomUUID()
        const path = await this.paths.plannedPath(
          repoId,
          current.rootPath,
          input.name,
          before,
          saved?.plan.path,
        )
        if (typeof requestedPlan === 'string') this.plans.delete(requestedPlan)
        // Reserve before Git writes: failed or partial creation must not reuse an Agent cwd.
        await this.access.config.reserveWorktreeName(repoId, basename(path))
        let writeError: unknown
        try {
          await this.access.git.addWorktree(current.rootPath, path, input.branchName, oid)
        } catch (error) {
          writeError = error
        }
        let worktrees: GitWorktreeInfo[]
        try {
          const after = await this.access.git.requireRepository(input.projectPath)
          if (after.repoCommonDir !== current.repoCommonDir) throw new Error('仓库身份改变')
          worktrees = await this.access.git.listWorktrees(after.rootPath)
        } catch {
          outcome = 'unknown'
          throw new WorktreeError(
            'GIT_COMMAND_FAILED',
            'Git 写入后无法确认最终状态；请重新扫描，勿重复创建或清理目录。',
            { operationId, path, gitState: 'unknown' },
          )
        }
        const worktree = worktrees.find((entry) => entry.path === path)
        if (
          writeError ||
          !worktree ||
          worktree.branch !== input.branchName ||
          worktree.isMain ||
          worktree.isBare ||
          worktree.prunable
        ) {
          outcome = worktree ? 'partial' : 'failed'
          throw new WorktreeError(
            writeError instanceof WorktreeError ? writeError.code : 'GIT_COMMAND_FAILED',
            worktree
              ? 'Git 写入未完整成功，目录已登记到 Git 但尚未纳入 Cota 管理；请检查后重新扫描。'
              : 'Git 创建失败；已重新检查仓库，不会清理任何目录。',
            { operationId, path, gitState: worktree ? 'created' : 'not-created', worktrees },
          )
        }
        // Revalidate the actual directory instead of trusting Git's stored pathname alone.
        try {
          if ((await projectDirectory(path)) !== path) throw new Error('路径不一致')
        } catch {
          outcome = 'partial'
          throw new WorktreeError(
            'PATH_CONFLICT',
            '新工作目录不可访问或真实路径不一致，未登记到 Cota；请检查目录。',
            { operationId, path, gitState: 'created', worktrees },
          )
        }
        const record: WorktreeRecord = {
          id,
          projectPath: input.projectPath,
          repoCommonDir: current.repoCommonDir,
          repoId,
          path,
          origin: 'created',
          initialBranch: input.branchName,
          baseRef: input.baseRef,
          registeredAt: new Date().toISOString(),
        }
        try {
          await this.access.config.registerWorktree(record, {
            id: randomUUID(),
            projectPath: input.projectPath,
            name: input.name,
            kind: 'git-worktree',
            worktreeId: id,
          })
        } catch {
          outcome = 'partial'
          throw new WorktreeError(
            'CONFIG_PERSIST_FAILED',
            'Worktree 已创建，但 Cota 登记保存失败；目录和分支已保留，请重新扫描后恢复。',
            { operationId, path, gitState: 'created', worktrees },
          )
        }
        outcome = 'created'
        const workspace = this.access.config
          .snapshot()
          .layout!.workspaces.find(
            (entry) => entry.kind === 'git-worktree' && entry.worktreeId === record.id,
          )!
        return {
          record,
          workspace,
          worktree: { ...worktree, managedByCota: true, worktreeId: record.id },
        }
      } finally {
        console.info('[worktree]', {
          repoCommonDir: repository.repoCommonDir,
          operationId,
          operation: 'create',
          duration: Date.now() - started,
          outcome,
        })
      }
    })
  }

  async planWorktree(value: unknown): Promise<WorktreePlan> {
    const input = createWorktreeInput(value)
    this.access.authorizeProject(input.projectPath)
    this.access.config.assertWritable()
    const initial = await this.access.git.requireRepository(input.projectPath)
    return this.access.withRepositoryLock(initial.repoCommonDir, async () => {
      this.access.authorizeProject(input.projectPath)
      this.access.config.assertWritable()
      const repository = await this.access.git.requireRepository(input.projectPath)
      if (repository.repoCommonDir !== initial.repoCommonDir)
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描后再创建。')
      await this.access.git.validateNewBranch(repository.rootPath, input.branchName, input.baseRef)
      for (const [id, entry] of this.plans) if (entry.expires < Date.now()) this.plans.delete(id)
      if (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!)
      const repoId =
        this.access.config
          .snapshot()
          .worktreeRecords.find((entry) => entry.repoCommonDir === repository.repoCommonDir)
          ?.repoId ||
        createHash('sha256').update(repository.repoCommonDir).digest('hex').slice(0, 24)
      const id = randomUUID()
      const path = await this.paths.plannedPath(
        repoId,
        repository.rootPath,
        input.name,
        await this.access.git.listWorktrees(repository.rootPath),
      )
      const plan = { ...input, id, path }
      this.plans.set(id, {
        plan,
        commonDir: repository.repoCommonDir,
        expires: Date.now() + 600000,
      })
      return plan
    })
  }

  async suggestName(value: string): Promise<WorktreeNameSuggestion> {
    const path = this.access.authorizeProject(value)
    this.access.config.assertWritable()
    const repository = await this.access.git.requireRepository(path)
    return this.access.withRepositoryLock(repository.repoCommonDir, async () => {
      this.access.authorizeProject(path)
      const [worktrees, branches, branchPrefix] = await Promise.all([
        this.access.git.listWorktrees(path),
        this.access.git.localBranches(path),
        this.access.git.branchPrefix(path),
      ])
      if (branches.includes(branchPrefix))
        throw new WorktreeError(
          'BRANCH_EXISTS',
          'Git 用户名前缀已被同名分支占用，请先重命名该分支。',
        )
      const snapshot = this.access.config.snapshot()
      const repoId =
        snapshot.worktreeRecords.find((record) => record.repoCommonDir === repository.repoCommonDir)
          ?.repoId ||
        createHash('sha256').update(repository.repoCommonDir).digest('hex').slice(0, 24)
      const mainPath = worktrees.find((entry) => entry.isMain)?.path || repository.rootPath
      const parent = await this.paths.repositoryDirectory(
        repoId,
        this.paths.directorySlug(basename(mainPath).replace(/\.git$/, '')),
      )
      return {
        branchPrefix,
        name: suggestWorktreeName([
          ...snapshot.worktreeRecords.map((record) => basename(record.path)),
          ...worktrees.map((entry) => basename(entry.path)),
          ...(snapshot.layout?.workspaces.map((workspace) => workspace.name) || []),
          ...(snapshot.worktreeNameHistory?.[repoId] || []),
          ...branches.map(
            (branch) =>
              (branch.startsWith(`${branchPrefix}/`)
                ? branch.slice(branchPrefix.length + 1)
                : branch
              ).split('/')[0]!,
          ),
          ...(await readdir(parent)),
        ]),
      }
    })
  }
}
