import { realpath, lstat } from 'node:fs/promises'
import { normalize } from 'node:path'
import type { GitRepositoryInfo, GitWorktreeInfo, RemovalBlocker } from '../../shared/contracts'
import { absolutePath, projectDirectory } from '../validation'
import { worktreeBranchSegment } from '../../shared/worktree-names'

import { runGit, WorktreeError } from './git-runner'
export { gitEnvironment, WorktreeError } from './git-runner'

type CommandError = Error & { code?: string | number; stderr?: Buffer; killed?: boolean }
export type ReadyRepository = Extract<GitRepositoryInfo, { status: 'ready' }>

function exitedWith(error: unknown, code: number): boolean {
  return error instanceof WorktreeError && (error.cause as CommandError | undefined)?.code === code
}

const line = (value: string): string => value.replace(/\n$/, '')

export function parseWorktreeList(output: string): GitWorktreeInfo[] {
  const result: GitWorktreeInfo[] = []
  let current: GitWorktreeInfo | undefined
  let hasHead = false
  let hasCheckout = false
  const invalid = (): never => {
    throw new WorktreeError('GIT_COMMAND_FAILED', 'Git Worktree 列表格式无效。')
  }
  const finish = () => {
    if (!current) return
    if (!current.isBare && (!hasHead || !hasCheckout)) invalid()
    if (result.some((entry) => entry.path === current!.path)) invalid()
    result.push(current)
    current = undefined
  }
  if (!output.endsWith('\0\0')) invalid()
  for (const field of output.split('\0')) {
    if (!field) {
      finish()
      continue
    }
    if (field.startsWith('worktree ')) {
      if (current) invalid()
      let path: string
      try {
        path =
          process.platform === 'win32'
            ? normalize(absolutePath(field.slice(9)))
            : absolutePath(field.slice(9))
      } catch {
        return invalid()
      }
      current = {
        path,
        branch: null,
        head: '',
        isMain: result.length === 0,
        isBare: false,
        locked: false,
        prunable: false,
        managedByCota: false,
      }
      hasHead = false
      hasCheckout = false
      continue
    }
    if (!current) invalid()
    const entry = current!
    if (field.startsWith('HEAD ')) {
      if (hasHead || !/^[\da-f]{40}([\da-f]{24})?$/.test(field.slice(5))) invalid()
      entry.head = field.slice(5)
      hasHead = true
    } else if (field.startsWith('branch ')) {
      if (hasCheckout || !field.startsWith('branch refs/heads/') || field.length === 18) invalid()
      entry.branch = field.slice(18)
      hasCheckout = true
    } else if (field === 'detached') {
      if (hasCheckout) invalid()
      hasCheckout = true
    } else if (field === 'bare') {
      entry.isBare = true
    } else if (field === 'locked' || field.startsWith('locked ')) {
      entry.locked = true
      if (field.length > 7) entry.lockReason = field.slice(7)
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      entry.prunable = true
      if (field.length > 9) entry.prunableReason = field.slice(9)
    }
  }
  if (!result.length) invalid()
  return result
}

export class GitService {
  async inspectRepository(value: string): Promise<GitRepositoryInfo> {
    const requestedPath = absolutePath(value)
    let path: string
    try {
      path = await projectDirectory(requestedPath)
    } catch {
      return {
        status: 'unavailable',
        projectPath: requestedPath,
        code: 'REPOSITORY_UNAVAILABLE',
        error: '项目目录不可访问，可能已移动或删除。',
      }
    }
    try {
      const bare = line(await runGit(path, ['rev-parse', '--is-bare-repository']))
      if (bare !== 'true' && bare !== 'false')
        throw new WorktreeError('GIT_COMMAND_FAILED', 'Git 仓库类型无效。')
      const repoCommonDir = await realpath(
        line(await runGit(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])),
      )
      if (bare === 'true')
        return {
          status: 'unsupported',
          projectPath: path,
          repoCommonDir,
          isBare: true,
          error: '首版不支持 bare 仓库，请打开普通 Git 工作目录。',
          code: 'UNSUPPORTED_REPOSITORY',
        }
      const rootPath = await projectDirectory(
        line(await runGit(path, ['rev-parse', '--show-toplevel'])),
      )
      return { status: 'ready', projectPath: path, rootPath, repoCommonDir, isBare: false }
    } catch (error) {
      const failure = error as WorktreeError
      const cause = failure.cause as CommandError | undefined
      if (
        exitedWith(error, 128) &&
        cause?.stderr
          ?.toString()
          .startsWith('fatal: not a git repository (or any of the parent directories): .git')
      )
        return {
          status: 'nonGit',
          projectPath: path,
          code: 'NOT_GIT_REPO',
          error: '此目录不是 Git 仓库。',
        }
      return {
        status: failure.code === 'GIT_UNAVAILABLE' ? 'gitUnavailable' : 'unavailable',
        projectPath: path,
        code: failure.code === 'GIT_UNAVAILABLE' ? 'GIT_UNAVAILABLE' : 'REPOSITORY_UNAVAILABLE',
        error:
          failure instanceof WorktreeError
            ? failure.message
            : '无法读取 Git 仓库身份，请检查目录权限与状态。',
      }
    }
  }

  async requireRepository(path: string): Promise<ReadyRepository> {
    const repository = await this.inspectRepository(path)
    if (repository.status !== 'ready') throw new WorktreeError(repository.code, repository.error)
    return repository
  }

  async listWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
    const repository = await this.requireRepository(repoPath)
    return parseWorktreeList(
      await runGit(repository.rootPath, ['worktree', 'list', '--porcelain', '-z']),
    )
  }

  async validateNewBranch(repoPath: string, branchName: string, baseRef: string): Promise<string> {
    if (!branchName || branchName.startsWith('-') || /[\0\r\n]/.test(branchName))
      throw new WorktreeError('INVALID_BRANCH_NAME', '新分支名称无效。')
    try {
      const checked = line(await runGit(repoPath, ['check-ref-format', '--branch', branchName]))
      if (checked !== branchName)
        throw new WorktreeError('INVALID_BRANCH_NAME', '请填写明确的新分支名称。')
    } catch (error) {
      if (exitedWith(error, 128) || exitedWith(error, 1))
        throw new WorktreeError('INVALID_BRANCH_NAME', '新分支名称无效。')
      throw error
    }
    try {
      await runGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`])
    } catch (error) {
      if (!exitedWith(error, 1)) throw error
      try {
        const oid = line(
          await runGit(repoPath, [
            'rev-parse',
            '--verify',
            '--end-of-options',
            `${baseRef}^{commit}`,
          ]),
        )
        if (!/^[\da-f]{40}([\da-f]{24})?$/.test(oid))
          throw new WorktreeError('GIT_COMMAND_FAILED', 'Git 提交标识无效。')
        return oid
      } catch (baseError) {
        if (exitedWith(baseError, 128) || exitedWith(baseError, 1))
          throw new WorktreeError(
            'BASE_REF_NOT_FOUND',
            '基准引用无法解析为本地提交，请检查引用或先创建提交。',
          )
        throw baseError
      }
    }
    throw new WorktreeError('BRANCH_EXISTS', '同名本地分支已存在，请使用新分支名。')
  }

  async branchPrefix(repoPath: string): Promise<string> {
    let name = ''
    try {
      name = await runGit(repoPath, ['config', '--get', 'user.name'])
    } catch (error) {
      if (!exitedWith(error, 1)) throw error
    }
    const prefix = worktreeBranchSegment(name)
    if (!prefix)
      throw new WorktreeError(
        'INVALID_INPUT',
        '请先配置有效的 Git 用户名称（git config user.name）。',
      )
    return prefix
  }

  async localBranches(repoPath: string): Promise<string[]> {
    const repository = await this.requireRepository(repoPath)
    const output = await runGit(repository.rootPath, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads/',
    ])
    return output.split('\n').filter(Boolean)
  }

  async removalBlockers(path: string): Promise<RemovalBlocker[]> {
    const status = await runGit(path, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ])
    const blockers: RemovalBlocker[] = []
    const changes = status.split('\0').filter(Boolean)
    if (changes.some((entry) => entry.startsWith('?? '))) blockers.push('UNTRACKED_FILES')
    if (changes.some((entry) => !entry.startsWith('?? '))) blockers.push('DIRTY')
    if (await runGit(path, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']))
      blockers.push('IGNORED_CONTENT')
    const submodules = await runGit(path, ['submodule', 'status', '--recursive'])
    if (submodules.split('\n').some((entry) => entry && !entry.startsWith('-')))
      blockers.push('POPULATED_SUBMODULE')
    return blockers
  }

  async inspectBranchDeletion(
    repoPath: string,
    branch: string,
  ): Promise<{ head: string; merged: boolean }> {
    const ref = `refs/heads/${branch}`
    const head = line(await runGit(repoPath, ['rev-parse', '--verify', '--end-of-options', ref]))
    const upstream = line(await runGit(repoPath, ['for-each-ref', '--format=%(upstream)', ref]))
    let base = 'HEAD'
    if (upstream) {
      try {
        base = line(
          await runGit(repoPath, [
            'rev-parse',
            '--quiet',
            '--verify',
            '--end-of-options',
            upstream,
          ]),
        )
      } catch (error) {
        if (!exitedWith(error, 1)) throw error
      }
    }
    try {
      await runGit(repoPath, ['merge-base', '--is-ancestor', head, base])
      return { head, merged: true }
    } catch (error) {
      if (exitedWith(error, 1)) return { head, merged: false }
      throw error
    }
  }

  async removeWorktree(repoPath: string, path: string, force = false): Promise<void> {
    await runGit(repoPath, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', path], true)
  }

  async deleteBranch(
    repoPath: string,
    branch: string,
    force: boolean,
    expectedHead: string,
  ): Promise<void> {
    if (branch.startsWith('-') || /[\0\r\n]/.test(branch))
      throw new WorktreeError('INVALID_BRANCH_NAME', '分支名称无效。')
    await runGit(repoPath, ['check-ref-format', '--branch', branch])
    const head = line(
      await runGit(repoPath, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}`]),
    )
    if (head !== expectedHead)
      throw new WorktreeError('REMOVAL_BLOCKED', '分支提交已改变，分支已保留。')
    await runGit(repoPath, ['branch', force ? '-D' : '-d', '--', branch], true)
  }

  async addWorktree(
    repoPath: string,
    path: string,
    branchName: string,
    oid: string,
  ): Promise<void> {
    try {
      await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await runGit(repoPath, ['worktree', 'add', '-b', branchName, '--', path, oid], true)
      return
    }
    throw new WorktreeError('PATH_CONFLICT', '目标目录已存在，不会覆盖已有目录。', { path })
  }
}
