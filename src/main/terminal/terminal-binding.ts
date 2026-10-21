import type { TerminalBinding } from '../../shared/contracts'
import { absolutePath, projectDirectory, terminalId, workspaceTarget } from '../validation'
import { GitService, WorktreeError } from '../git/git-worktrees'

export function terminalBinding(value: TerminalBinding): TerminalBinding {
  const target = workspaceTarget(value)
  const cwd = absolutePath(value.cwd)
  if (
    value.workspaceKind === 'local' &&
    value.worktreeId === undefined &&
    value.repoCommonDir === undefined
  )
    return { ...target, cwd, workspaceKind: 'local' }
  if (value.workspaceKind === 'git-worktree')
    return {
      ...target,
      cwd,
      workspaceKind: 'git-worktree',
      worktreeId: terminalId(value.worktreeId),
      repoCommonDir: absolutePath(value.repoCommonDir),
    }
  throw new Error('终端工作目录授权无效。')
}

export function sameBinding(a: TerminalBinding, b: TerminalBinding): boolean {
  return (
    a.projectPath === b.projectPath &&
    a.workspaceId === b.workspaceId &&
    a.cwd === b.cwd &&
    a.workspaceKind === b.workspaceKind &&
    a.worktreeId === b.worktreeId &&
    a.repoCommonDir === b.repoCommonDir
  )
}

export async function validateTerminalBinding(
  binding: TerminalBinding,
  git = new GitService(),
): Promise<void> {
  if ((await projectDirectory(binding.cwd)) !== binding.cwd)
    throw new WorktreeError('PATH_CONFLICT', '工作目录真实路径已改变。')
  if (binding.workspaceKind === 'local') {
    if ((await projectDirectory(binding.projectPath)) !== binding.cwd)
      throw new Error('本地工作区目录不匹配。')
    return
  }
  const repository = await git.requireRepository(binding.cwd)
  const project = await git.requireRepository(binding.projectPath)
  const worktree = (await git.listWorktrees(binding.cwd)).find(
    (entry) => entry.path === binding.cwd,
  )
  if (
    repository.repoCommonDir !== binding.repoCommonDir ||
    repository.rootPath !== binding.cwd ||
    project.repoCommonDir !== binding.repoCommonDir ||
    !worktree ||
    worktree.prunable ||
    worktree.isMain ||
    worktree.isBare
  )
    throw new WorktreeError(
      'REPOSITORY_UNAVAILABLE',
      '工作目录不再属于已授权的 Git Worktree；不会回退到项目目录。',
    )
}
