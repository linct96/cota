import { isUtf8 } from 'node:buffer'
import type { GitBranchData } from '../../../shared/git-branches'
import { GitService } from '../worktrees/git'
import { runGit, runGitBytes } from '../git-runner'

export async function readBranchData(cwd: string, git = new GitService()): Promise<GitBranchData> {
  const raw = await runGitBytes(cwd, [
    'for-each-ref',
    '--format=%(refname)%00%(symref)%00%(objectname)%00%(committerdate:iso-strict)%00%(contents:subject)',
    'refs/heads/',
    'refs/remotes/',
  ])
  if (!isUtf8(raw)) throw new Error('分支名称或提交信息不是 UTF-8，请在终端处理。')
  const worktrees = await git.listWorktrees(cwd)
  const records = raw
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((record) => record.split('\0'))
  const branches = records
    .filter(([, symbolic]) => !symbolic)
    .map(([ref, , oid, date, subject]) => {
      if (
        !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid) ||
        !Number.isFinite(Date.parse(date)) ||
        subject === undefined
      )
        throw new Error('分支提交信息格式无效。')
      return {
        ref,
        oid,
        label: ref.replace(/^refs\/(heads|remotes)\//, ''),
        date,
        subject,
        worktreePath: worktrees.find(
          (entry) => entry.branch !== null && `refs/heads/${entry.branch}` === ref,
        )?.path,
      }
    })
  if (branches.length > 5000) throw new Error('引用过多，请在终端处理。')
  return {
    branches,
    remoteHeads: records
      .filter(([, symbolic]) => symbolic)
      .map(([ref, target]) => ({ ref, target })),
  }
}

export async function readBranchRemotes(cwd: string): Promise<string[]> {
  const remotes = (await runGit(cwd, ['remote'])).split('\n').filter(Boolean)
  if (remotes.length > 100) throw new Error('引用过多，请在终端处理。')
  return remotes
}
