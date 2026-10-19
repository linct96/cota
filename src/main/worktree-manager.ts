import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, relative, isAbsolute, sep } from 'node:path'
import type {
  CreateWorktreeResult,
  GitRepositoryInfo,
  GitWorktreeInfo,
  WorktreeRecord,
  WorkspaceTarget,
  TerminalBinding,
  TerminalSession,
  ProjectWorkspace,
  WorktreePlan,
  WorktreeNameSuggestion,
  WorktreeScan,
  WorktreeRemovalCheck,
  RemoveWorktreeResult,
} from '../shared/contracts'
import { REMOVAL_BLOCKER_LABELS } from '../shared/contracts'
import { suggestWorktreeName } from '../shared/worktree-names'
import { ConfigStore } from './config'
import { GitService, WorktreeError } from './git-worktrees'
import {
  absolutePath,
  createWorktreeInput,
  projectDirectory,
  workspaceTarget,
  terminalId,
} from './validation'
import { validateTerminalBinding } from './terminal-binding'

export class WorktreeManager {
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly plans = new Map<
    string,
    { plan: WorktreePlan; commonDir: string; expires: number }
  >()
  private removalCount = 0
  get removing(): boolean {
    return this.removalCount > 0
  }

  constructor(
    private readonly config: ConfigStore,
    private readonly directory: string,
    private readonly git = new GitService(),
  ) {
    absolutePath(directory)
  }

  // Terminal creation and destructive operations share one repository gate.
  async withRepositoryLock<T>(repoCommonDir: string, action: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(repoCommonDir) || Promise.resolve()
    const operation = previous.catch(() => {}).then(action)
    this.operations.set(repoCommonDir, operation)
    try {
      return await operation
    } finally {
      if (this.operations.get(repoCommonDir) === operation) this.operations.delete(repoCommonDir)
    }
  }

  private authorizeProject(value: string): string {
    const path = absolutePath(value)
    if (!this.config.snapshot().recentProjects.includes(path))
      throw new WorktreeError('INVALID_INPUT', '请先打开项目目录。')
    return path
  }

  async withTerminalTarget<T>(
    value: WorkspaceTarget,
    action: (binding: TerminalBinding) => Promise<T>,
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

  inspectRepository(value: string): Promise<GitRepositoryInfo> {
    return this.git.inspectRepository(this.authorizeProject(value))
  }

  async listWorktrees(value: string): Promise<GitWorktreeInfo[]> {
    const path = this.authorizeProject(value)
    const repository = await this.git.requireRepository(path)
    const worktrees = await this.git.listWorktrees(path)
    return this.applyRecords(repository.repoCommonDir, worktrees)
  }

  private applyRecords(repoCommonDir: string, worktrees: GitWorktreeInfo[]): GitWorktreeInfo[] {
    const records = this.config.snapshot().worktreeRecords
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

  async createWorktree(value: unknown): Promise<CreateWorktreeResult> {
    let input
    try {
      input = createWorktreeInput(value)
    } catch (error) {
      throw new WorktreeError('INVALID_INPUT', (error as Error).message)
    }
    this.authorizeProject(input.projectPath)
    this.config.assertWritable()
    const repository = await this.git.requireRepository(input.projectPath)
    return this.withRepositoryLock(repository.repoCommonDir, async () => {
      const operationId = randomUUID()
      const started = Date.now()
      let outcome = 'failed'
      try {
        this.authorizeProject(input.projectPath)
        this.config.assertWritable()
        const current = await this.git.requireRepository(input.projectPath)
        if (current.repoCommonDir !== repository.repoCommonDir)
          throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描后再创建。')
        const records = this.config.snapshot().worktreeRecords
        if (records.length >= 10000)
          throw new WorktreeError('INVALID_INPUT', 'Worktree 登记数量已达上限。')
        const before = await this.git.listWorktrees(current.rootPath)
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
        const oid = await this.git.validateNewBranch(
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
        const path = await this.plannedPath(
          repoId,
          current.rootPath,
          input.name,
          before,
          saved?.plan.path,
        )
        if (typeof requestedPlan === 'string') this.plans.delete(requestedPlan)
        // Reserve before Git writes: failed or partial creation must not reuse an Agent cwd.
        await this.config.reserveWorktreeName(repoId, basename(path))
        let writeError: unknown
        try {
          await this.git.addWorktree(current.rootPath, path, input.branchName, oid)
        } catch (error) {
          writeError = error
        }
        let worktrees: GitWorktreeInfo[]
        try {
          const after = await this.git.requireRepository(input.projectPath)
          if (after.repoCommonDir !== current.repoCommonDir) throw new Error('仓库身份改变')
          worktrees = await this.git.listWorktrees(after.rootPath)
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
          await this.config.registerWorktree(record, {
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
        const workspace = this.config
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
    this.authorizeProject(input.projectPath)
    this.config.assertWritable()
    const initial = await this.git.requireRepository(input.projectPath)
    return this.withRepositoryLock(initial.repoCommonDir, async () => {
      this.authorizeProject(input.projectPath)
      this.config.assertWritable()
      const repository = await this.git.requireRepository(input.projectPath)
      if (repository.repoCommonDir !== initial.repoCommonDir)
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描后再创建。')
      await this.git.validateNewBranch(repository.rootPath, input.branchName, input.baseRef)
      for (const [id, entry] of this.plans) if (entry.expires < Date.now()) this.plans.delete(id)
      if (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!)
      const repoId =
        this.config
          .snapshot()
          .worktreeRecords.find((entry) => entry.repoCommonDir === repository.repoCommonDir)
          ?.repoId ||
        createHash('sha256').update(repository.repoCommonDir).digest('hex').slice(0, 24)
      const id = randomUUID()
      const path = await this.plannedPath(
        repoId,
        repository.rootPath,
        input.name,
        await this.git.listWorktrees(repository.rootPath),
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

  localBranches(path: string): Promise<string[]> {
    return this.git.localBranches(this.authorizeProject(path))
  }

  async suggestName(value: string): Promise<WorktreeNameSuggestion> {
    const path = this.authorizeProject(value)
    this.config.assertWritable()
    const repository = await this.git.requireRepository(path)
    return this.withRepositoryLock(repository.repoCommonDir, async () => {
      this.authorizeProject(path)
      const [worktrees, branches, branchPrefix] = await Promise.all([
        this.git.listWorktrees(path),
        this.git.localBranches(path),
        this.git.branchPrefix(path),
      ])
      if (branches.includes(branchPrefix))
        throw new WorktreeError(
          'BRANCH_EXISTS',
          'Git 用户名前缀已被同名分支占用，请先重命名该分支。',
        )
      const snapshot = this.config.snapshot()
      const repoId =
        snapshot.worktreeRecords.find((record) => record.repoCommonDir === repository.repoCommonDir)
          ?.repoId ||
        createHash('sha256').update(repository.repoCommonDir).digest('hex').slice(0, 24)
      const mainPath = worktrees.find((entry) => entry.isMain)?.path || repository.rootPath
      const parent = await this.repositoryDirectory(
        repoId,
        this.directorySlug(basename(mainPath).replace(/\.git$/, '')),
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

  private directorySlug(name: string): string {
    return (
      Array.from(
        name
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}._-]+/gu, '-')
          .replace(/-+/g, '-')
          .replace(/^[.-]+|[.-]+$/g, ''),
      )
        .slice(0, 40)
        .join('') || 'worktree'
    )
  }

  private async plannedPath(
    repoId: string,
    repoPath: string,
    name: string,
    worktrees: GitWorktreeInfo[],
    preferredPath?: string,
  ): Promise<string> {
    const mainPath = worktrees.find((entry) => entry.isMain)?.path || repoPath
    const parent = await this.repositoryDirectory(
      repoId,
      this.directorySlug(basename(mainPath).replace(/\.git$/, '')),
    )
    const occupied = new Set([
      ...worktrees.map((entry) => entry.path),
      ...this.config.snapshot().worktreeRecords.map((entry) => entry.path),
    ])
    const retired = new Set(this.config.snapshot().worktreeNameHistory?.[repoId] || [])
    const slug = this.directorySlug(name)
    for (let suffix = 1; suffix <= 10000; suffix++) {
      const path = preferredPath || join(parent, suffix === 1 ? slug : `${slug}-${suffix}`)
      if (dirname(path) !== parent)
        throw new WorktreeError('PATH_CONFLICT', '目录计划与当前仓库登记不一致，请重新预览。')
      if (!occupied.has(path) && !retired.has(basename(path).toLowerCase())) {
        try {
          await lstat(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
          throw error
        }
      }
      if (preferredPath)
        throw new WorktreeError('PATH_CONFLICT', '预览目录已被占用，请重新预览后再创建。')
    }
    throw new WorktreeError('PATH_CONFLICT', '无法找到可用目录，请使用其他工作区名称。')
  }

  async scanWorktrees(
    value: string,
    sessions: TerminalSession[] = [],
    includeClosed = false,
  ): Promise<WorktreeScan> {
    const path =
      includeClosed &&
      this.config.snapshot().worktreeRecords.some((record) => record.projectPath === value)
        ? absolutePath(value)
        : this.authorizeProject(value)
    const records = this.config
      .snapshot()
      .worktreeRecords.filter((entry) => entry.projectPath === path)
    const repository = await this.git.inspectRepository(path)
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
      worktrees = this.applyRecords(repository.repoCommonDir, await this.git.listWorktrees(path))
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
          const identity = await this.git.requireRepository(record.path)
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
    this.authorizeProject(projectPath)
    const repository = await this.git.requireRepository(projectPath)
    return this.withRepositoryLock(repository.repoCommonDir, async () => {
      this.authorizeProject(projectPath)
      if (
        (await this.git.requireRepository(projectPath)).repoCommonDir !== repository.repoCommonDir
      )
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新扫描。')
      this.config.assertWritable()
      const path = await projectDirectory(requestedPath)
      if (path !== absolutePath(requestedPath))
        throw new WorktreeError('PATH_CONFLICT', '目录经过符号链接。')
      const identity = await this.git.requireRepository(path)
      const worktree = (await this.git.listWorktrees(projectPath)).find(
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
      const snapshot = this.config.snapshot()
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
      await this.config.registerWorktree(record, workspace)
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

  private registered(value: string): WorktreeRecord {
    const id = terminalId(value)
    const record = this.config.snapshot().worktreeRecords.find((entry) => entry.id === id)
    if (!record) throw new WorktreeError('INVALID_INPUT', 'Worktree 登记不存在，请重新扫描。')
    return record
  }

  private relatedSessions(record: WorktreeRecord, sessions: TerminalSession[]): TerminalSession[] {
    return sessions.filter((session) => {
      const child = relative(record.path, session.cwd)
      return (
        session.worktreeId === record.id ||
        child === '' ||
        (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
      )
    })
  }

  async inspectRemoval(value: string, sessions: TerminalSession[]): Promise<WorktreeRemovalCheck> {
    const record = this.registered(value)
    const blockers: WorktreeRemovalCheck['blockers'] = []
    const liveTerminalIds = this.relatedSessions(record, sessions)
      .filter((session) => !session.exited)
      .map((session) => session.id)
    let currentBranch: string | null = null
    if (record.origin !== 'created') blockers.push('UNMANAGED')
    if (liveTerminalIds.length) blockers.push('RUNNING_SESSIONS')
    try {
      const repository = await this.git.requireRepository(record.projectPath)
      if (repository.repoCommonDir !== record.repoCommonDir) blockers.push('OWNERSHIP_MISMATCH')
      const worktree = (await this.git.listWorktrees(record.projectPath)).find(
        (entry) => entry.path === record.path,
      )
      if (!worktree) blockers.push('MISSING_OR_UNKNOWN_PATH')
      else {
        currentBranch = worktree.branch
        if (worktree.isMain || worktree.isBare) blockers.push('MAIN_WORKTREE')
        if (worktree.locked) blockers.push('LOCKED')
        if (worktree.prunable) blockers.push('PRUNABLE')
      }
      const parent = dirname(record.path)
      const ownedParent =
        dirname(parent) === normalize(this.directory) &&
        (await this.ownsRepositoryDirectory(parent, record.repoId))
      const stat = await lstat(record.path)
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !ownedParent ||
        (await realpath(parent)) !== parent ||
        (await projectDirectory(record.path)) !== record.path ||
        this.config.snapshot().recentProjects.includes(record.path) ||
        repository.rootPath === record.path
      )
        blockers.push('OWNERSHIP_MISMATCH')
      const target = await this.git.requireRepository(record.path)
      if (target.repoCommonDir !== record.repoCommonDir || target.rootPath !== record.path)
        blockers.push('OWNERSHIP_MISMATCH')
      if (!blockers.some((entry) => entry !== 'RUNNING_SESSIONS'))
        blockers.push(...(await this.git.removalBlockers(record.path)))
    } catch (error) {
      blockers.push(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'MISSING_OR_UNKNOWN_PATH'
          : 'GIT_UNAVAILABLE',
      )
    }
    return {
      allowed: blockers.length === 0,
      worktreeId: record.id,
      worktreePath: record.path,
      currentBranch,
      blockers: [...new Set(blockers)],
      liveTerminalIds,
    }
  }

  async removeWorktree(
    value: string,
    options: {
      deleteBranch: boolean
      sessions(): Promise<TerminalSession[]>
      close(id: string): Promise<void>
      confirm(check: WorktreeRemovalCheck, force: boolean): Promise<boolean>
    },
  ): Promise<RemoveWorktreeResult> {
    const record = this.registered(value)
    return this.withRepositoryLock(record.repoCommonDir, async () => {
      const operationId = randomUUID()
      const started = Date.now()
      let stage = 'preflight'
      let closedSessions = 0
      let gitState = 'not-removed'
      this.removalCount++
      try {
        this.config.assertWritable()
        if (JSON.stringify(this.registered(record.id)) !== JSON.stringify(record))
          throw new WorktreeError('REPOSITORY_UNAVAILABLE', '登记已改变，请重新扫描。')
        const check = await this.inspectRemoval(record.id, await options.sessions())
        const discardable = new Set(['DIRTY', 'UNTRACKED_FILES', 'IGNORED_CONTENT'])
        if (check.blockers.some((entry) => entry !== 'RUNNING_SESSIONS' && !discardable.has(entry)))
          throw new WorktreeError(
            'REMOVAL_BLOCKED',
            `无法删除：${check.blockers.map((entry) => REMOVAL_BLOCKER_LABELS[entry]).join('、')}。请处理后重试，或仅取消关联。`,
          )
        const branch =
          options.deleteBranch && check.currentBranch
            ? await this.git.inspectBranchDeletion(record.projectPath, check.currentBranch)
            : undefined
        const force =
          check.blockers.some((entry) => discardable.has(entry)) || branch?.merged === false
        stage = 'confirmation'
        if (!(await options.confirm(check, force)))
          return { removed: false, cancelled: true, operationId }
        stage = 'stop-sessions'
        for (const session of this.relatedSessions(record, await options.sessions())) {
          await options.close(session.id)
          closedSessions++
        }
        if (this.relatedSessions(record, await options.sessions()).length)
          throw new WorktreeError(
            'REMOVAL_BLOCKED',
            '无法确认所有关联终端已结束，目录和登记已保留。',
          )
        stage = 'revalidate'
        const final = await this.inspectRemoval(record.id, await options.sessions())
        const finalBranch =
          branch && final.currentBranch
            ? await this.git.inspectBranchDeletion(record.projectPath, final.currentBranch)
            : undefined
        if (
          final.blockers.some((entry) => !(force && discardable.has(entry))) ||
          final.currentBranch !== check.currentBranch ||
          (branch && (finalBranch?.head !== branch.head || (!force && !finalBranch?.merged)))
        )
          throw new WorktreeError(
            'REMOVAL_BLOCKED',
            `确认后工作目录或分支已改变，未执行删除${final.blockers.length ? `：${final.blockers.map((entry) => REMOVAL_BLOCKER_LABELS[entry]).join('、')}` : ''}。`,
          )
        stage = 'git-remove'
        let removalError: unknown
        try {
          await this.git.removeWorktree(record.projectPath, record.path, force)
        } catch (error) {
          removalError = error
        }
        const listed = await this.git.listWorktrees(record.projectPath).catch(() => {
          throw new WorktreeError(
            'GIT_COMMAND_FAILED',
            '删除后无法确认 Git 状态；登记保留，请重新扫描。',
            { operationId, path: record.path, gitState: 'unknown' },
          )
        })
        let exists = true
        try {
          await lstat(record.path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false
          else throw error
        }
        if (exists || listed.some((entry) => entry.path === record.path))
          throw new WorktreeError(
            'GIT_COMMAND_FAILED',
            `Worktree 删除未完成；登记保留。${removalError instanceof Error ? removalError.message : ''}`,
            { operationId, path: record.path, gitState: 'unknown' },
          )
        gitState = 'removed'
        stage = 'persist'
        try {
          await this.config.forgetWorktree(record.id)
        } catch {
          throw new WorktreeError(
            'CONFIG_PERSIST_FAILED',
            '目录已删除，登记待修复；请重新扫描后手动取消关联。',
            { operationId, path: record.path, gitState: 'removed' },
          )
        }
        stage = 'branch'
        if (branch && check.currentBranch) {
          try {
            await this.git.deleteBranch(record.projectPath, check.currentBranch, force, branch.head)
          } catch {
            return {
              removed: true,
              branchRetained: true,
              warning: '目录已删除，但本地分支未能删除，分支已保留。',
              operationId,
            }
          }
        }
        stage = 'removed'
        return {
          removed: true,
          branchRetained: !options.deleteBranch || !check.currentBranch,
          warning: removalError ? 'Git 曾返回错误，但复核确认目录已删除。' : undefined,
          operationId,
        }
      } finally {
        this.removalCount--
        console.info('[worktree]', {
          operation: 'remove',
          operationId,
          path: record.path,
          repoCommonDir: record.repoCommonDir,
          stage,
          closedSessions,
          gitState,
          duration: Date.now() - started,
        })
      }
    })
  }

  async unlinkWorktree(
    value: string,
    options: {
      sessions(): Promise<TerminalSession[]>
      close(id: string): Promise<void>
      confirm(): Promise<boolean>
    },
  ): Promise<boolean> {
    const record = this.registered(value)
    return this.withRepositoryLock(record.repoCommonDir, async () => {
      this.removalCount++
      try {
        this.config.assertWritable()
        if (JSON.stringify(this.registered(record.id)) !== JSON.stringify(record))
          throw new WorktreeError('REPOSITORY_UNAVAILABLE', '登记已改变，请重新扫描。')
        if (!(await options.confirm())) return false
        for (const session of this.relatedSessions(record, await options.sessions()))
          await options.close(session.id)
        if (this.relatedSessions(record, await options.sessions()).length)
          throw new Error('关联终端未能全部结束，登记已保留。')
        await this.config.forgetWorktree(record.id)
        return true
      } finally {
        this.removalCount--
      }
    })
  }

  private async ownsRepositoryDirectory(parent: string, repoId: string): Promise<boolean> {
    const marker = join(parent, '.cota-repository')
    try {
      const info = await lstat(marker)
      return (
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.size === repoId.length &&
        (await readFile(marker, 'utf8')) === repoId
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async repositoryDirectory(repoId: string, repoName: string): Promise<string> {
    const directory = normalize(this.directory)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if ((await realpath(directory)) !== directory)
      throw new WorktreeError('PATH_CONFLICT', 'Worktree 根目录经过符号链接，无法确认环境隔离。')
    for (const name of [repoName, `${repoName}-${repoId.slice(0, 8)}`]) {
      const parent = join(directory, name)
      let created = false
      try {
        await mkdir(parent, { mode: 0o700 })
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(parent)) !== parent)
        throw new WorktreeError('PATH_CONFLICT', 'Worktree 仓库目录无效或经过符号链接。')
      // Persist ownership even when creation fails before the config record is saved.
      if (created)
        await writeFile(join(parent, '.cota-repository'), repoId, { flag: 'wx', mode: 0o600 })
      if (await this.ownsRepositoryDirectory(parent, repoId)) return parent
    }
    throw new WorktreeError('PATH_CONFLICT', 'Worktree 仓库目录已被占用，无法确认归属。')
  }
}
