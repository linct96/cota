import { randomUUID } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, normalize, relative, isAbsolute, sep } from 'node:path'
import {
  REMOVAL_BLOCKER_LABELS,
  type WorktreeRecord,
  type TerminalSession,
  type WorktreeRemovalCheck,
  type RemoveWorktreeResult,
} from '../../../shared/contracts'
import { terminalId, projectDirectory } from '../../validation'
import { WorktreeError } from './git'
import type { WorktreeAccess } from './access'
import type { WorktreePaths } from './paths'

export class WorktreeRemoval {
  private removalCount = 0
  get removing(): boolean {
    return this.removalCount > 0
  }
  constructor(
    private readonly access: WorktreeAccess,
    private readonly paths: WorktreePaths,
    private readonly initializing: Set<string>,
  ) {}

  private registered(value: string): WorktreeRecord {
    const id = terminalId(value)
    const record = this.access.config.snapshot().worktreeRecords.find((entry) => entry.id === id)
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
    if (this.initializing.has(record.id)) blockers.push('INITIALIZING')
    if (liveTerminalIds.length) blockers.push('RUNNING_SESSIONS')
    try {
      const repository = await this.access.git.requireRepository(record.projectPath)
      if (repository.repoCommonDir !== record.repoCommonDir) blockers.push('OWNERSHIP_MISMATCH')
      const worktree = (await this.access.git.listWorktrees(record.projectPath)).find(
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
        dirname(parent) === normalize(this.access.directory) &&
        (await this.paths.ownsRepositoryDirectory(parent, record.repoId))
      const stat = await lstat(record.path)
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !ownedParent ||
        (await realpath(parent)) !== parent ||
        (await projectDirectory(record.path)) !== record.path ||
        this.access.config.snapshot().recentProjects.includes(record.path) ||
        repository.rootPath === record.path
      )
        blockers.push('OWNERSHIP_MISMATCH')
      const target = await this.access.git.requireRepository(record.path)
      if (target.repoCommonDir !== record.repoCommonDir || target.rootPath !== record.path)
        blockers.push('OWNERSHIP_MISMATCH')
      if (!blockers.some((entry) => entry !== 'RUNNING_SESSIONS'))
        blockers.push(...(await this.access.git.removalBlockers(record.path)))
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
    return this.access.withRepositoryLock(record.repoCommonDir, async () => {
      const operationId = randomUUID()
      const started = Date.now()
      let stage = 'preflight'
      let closedSessions = 0
      let gitState = 'not-removed'
      this.removalCount++
      try {
        this.access.config.assertWritable()
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
            ? await this.access.git.inspectBranchDeletion(record.projectPath, check.currentBranch)
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
            ? await this.access.git.inspectBranchDeletion(record.projectPath, final.currentBranch)
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
          await this.access.git.removeWorktree(record.projectPath, record.path, force)
        } catch (error) {
          removalError = error
        }
        const listed = await this.access.git.listWorktrees(record.projectPath).catch(() => {
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
          await this.access.config.forgetWorktree(record.id)
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
            await this.access.git.deleteBranch(
              record.projectPath,
              check.currentBranch,
              force,
              branch.head,
            )
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
    return this.access.withRepositoryLock(record.repoCommonDir, async () => {
      this.removalCount++
      try {
        this.access.config.assertWritable()
        if (this.initializing.has(record.id)) throw new Error('请先停止工作区初始化，再移除关联。')
        if (JSON.stringify(this.registered(record.id)) !== JSON.stringify(record))
          throw new WorktreeError('REPOSITORY_UNAVAILABLE', '登记已改变，请重新扫描。')
        if (!(await options.confirm())) return false
        for (const session of this.relatedSessions(record, await options.sessions()))
          await options.close(session.id)
        if (this.relatedSessions(record, await options.sessions()).length)
          throw new Error('关联终端未能全部结束，登记已保留。')
        await this.access.config.forgetWorktree(record.id)
        return true
      } finally {
        this.removalCount--
      }
    })
  }
}
