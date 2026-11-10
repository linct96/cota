import type { GitMutation } from '../../../shared/source-control'
import type { SourceControlService } from '../source-control/service'
import { GitService } from '../worktrees/git'
import { explainGitError as explain, resolveGitCommit, runGit } from '../git-runner'
import { mutateRemote } from './remote'

const OID = /^[\da-f]{40}([\da-f]{24})?$/
export type GitBranchMutation = Exclude<
  GitMutation,
  { action: 'commit' | 'stage' | 'unstage' | 'discard' }
>
export function isBranchMutation(input: GitMutation): input is GitBranchMutation {
  return [
    'fetch',
    'pull',
    'push',
    'publish',
    'sync',
    'create-branch',
    'create-and-switch-branch',
    'switch-branch',
    'delete-branch',
  ].includes(input.action)
}

export async function mutateBranch(
  cwd: string,
  input: GitBranchMutation,
  sourceControl: Pick<SourceControlService, 'status' | 'references'>,
  onRemoteWrite: (urls: string[]) => void = () => {},
): Promise<boolean> {
  const git = new GitService()
  try {
    const status = await sourceControl.status(cwd)
    if (
      input.action === 'fetch' ||
      input.action === 'push' ||
      input.action === 'publish' ||
      input.action === 'pull' ||
      input.action === 'sync'
    )
      return await mutateRemote(cwd, status, input, sourceControl, onRemoteWrite)
    if (input.action === 'create-branch' || input.action === 'create-and-switch-branch') {
      if (
        typeof input.name !== 'string' ||
        !input.name ||
        input.name !== input.name.trim() ||
        input.name.length > 1013 ||
        input.name.startsWith('-') ||
        input.name === 'HEAD' ||
        /[\0\r\n]/.test(input.name)
      )
        throw new Error('请输入有效的本地分支名（上限 1,013 字符）。')
      if (!status.head) throw new Error('当前分支还没有提交，暂不能创建分支。')
      if (typeof input.head !== 'string' || !OID.test(input.head) || input.head !== status.head)
        throw new Error('HEAD 已改变，请刷新后重试。')
      if (input.action === 'create-and-switch-branch' && input.branch !== status.branch)
        throw new Error('分支已改变，请刷新后重试。')
      await runGit(status.rootPath, ['check-ref-format', `refs/heads/${input.name}`])
      if (input.action === 'create-and-switch-branch') {
        // Git creates the branch only if switching succeeds; never leave a half-created branch.
        await runGit(
          status.rootPath,
          [
            'switch',
            '--no-track',
            '--no-guess',
            '--no-overwrite-ignore',
            '--no-recurse-submodules',
            '--create',
            input.name,
            '--',
            input.head,
          ],
          true,
        )
      } else {
        await runGit(status.rootPath, ['branch', '--no-track', '--', input.name, input.head], true)
      }
      return true
    }
    if ('ref' in input && ['switch-branch', 'delete-branch'].includes(input.action)) {
      const remoteRef =
        input.action === 'switch-branch' &&
        typeof input.ref === 'string' &&
        input.ref.startsWith('refs/remotes/')
      if (
        typeof input.ref !== 'string' ||
        (!input.ref.startsWith('refs/heads/') && !remoteRef) ||
        input.ref.length > 1024 ||
        /[\0\r\n]/.test(input.ref) ||
        (input.ref.startsWith('refs/heads/') && input.ref.slice(11).startsWith('-'))
      )
        throw new Error(
          input.action === 'switch-branch'
            ? '请选择明确的本地或远端分支。'
            : '请选择明确的本地分支。',
        )
      if (input.branch !== status.branch || input.head !== status.head)
        throw new Error('分支或 HEAD 已改变，请刷新后重试。')
      await runGit(status.rootPath, ['check-ref-format', input.ref])
      await resolveGitCommit(status.rootPath, input.ref)
      let branch = input.ref.slice(11)
      if (remoteRef) {
        const references = await sourceControl.references(status.rootPath)
        const remote = references.remotes
          .sort((a, b) => b.length - a.length)
          .find((name) => input.ref.startsWith(`refs/remotes/${name}/`))
        if (!remote || !references.branches.some((entry) => entry.ref === input.ref))
          throw new Error('请选择已配置远端下的明确分支。')
        branch = input.ref.slice(`refs/remotes/${remote}/`.length)
        if (branch.startsWith('-') || branch === 'HEAD')
          throw new Error('远端分支无法使用同名本地分支签出，请在终端处理。')
        await runGit(status.rootPath, ['check-ref-format', `refs/heads/${branch}`])
        if (references.branches.some((entry) => entry.ref === `refs/heads/${branch}`))
          throw new Error(`本地分支「${branch}」已存在，请从本地分支分组选择；不会覆盖或重设上游。`)
      }
      if (status.branch === branch) {
        if (input.action === 'delete-branch') throw new Error('不能删除当前分支。')
        return true
      }
      const occupied = (await git.listWorktrees(status.rootPath)).find(
        (entry) => entry.branch === branch && entry.path !== status.rootPath,
      )
      if (occupied) throw new Error(`分支已被其他 Worktree 占用：${occupied.path}`)
      if (input.action === 'delete-branch') {
        // Let Git refuse unmerged or checked-out branches; never force deletion.
        await runGit(status.rootPath, ['branch', '--delete', '--', branch], true)
        return true
      }
      if (status.entries.length)
        throw new Error('切换分支前请提交或自行处理工作区更改；不会自动 stash 或丢弃改动。')
      await runGit(
        status.rootPath,
        [
          'switch',
          '--no-guess',
          '--no-overwrite-ignore',
          '--no-recurse-submodules',
          ...(remoteRef ? ['--track=direct', '--create', branch] : []),
          '--',
          remoteRef ? input.ref : branch,
        ],
        true,
      )
      return true
    }

    throw new Error('不支持的分支操作。')
  } catch (error) {
    throw explain(error)
  }
}
