import type { GitRemoteMutation, GitStatus } from '../../../shared/source-control'
import type { SourceControlService } from '../source-control/service'
import { explainGitError as explain, runGit } from '../git-runner'

// 校验远端操作，并在同步拉取成功后推送复核过的提交。
export async function mutateRemote(
  cwd: string,
  status: GitStatus,
  input: GitRemoteMutation,
  sourceControl: Pick<SourceControlService, 'status' | 'references'>,
  onRemoteWrite: (urls: string[]) => void,
): Promise<boolean> {
  const tracking = 'tracking' in input ? input.tracking : undefined
  const remote =
    input.action === 'fetch' || input.action === 'publish' ? input.remote : tracking?.remote
  const references = await sourceControl.references(cwd)
  if (typeof remote !== 'string' || !references.remotes.includes(remote))
    throw new Error('请选择仓库中已配置的远端；本地上游请使用终端。')
  const root = status.rootPath
  await runGit(root, ['check-ref-format', `refs/remotes/${remote}/cota-check`])
  if (input.action === 'fetch') {
    // An empty refmap disables Git's implicit updates from configured fetch mappings.
    await runGit(
      root,
      [
        'fetch',
        '--refmap=',
        '--no-tags',
        '--no-prune',
        '--no-prune-tags',
        '--no-recurse-submodules',
        '--',
        remote,
        `+refs/heads/*:refs/remotes/${remote}/*`,
      ],
      true,
    )
    return true
  }
  const verify = (current: GitStatus) => {
    if (current.merge)
      throw new Error(
        current.entries.some((entry) => entry.area === 'conflict')
          ? '请先解决现有合并冲突并暂存，再完成合并提交；未执行拉取或推送。'
          : '当前合并尚未提交，请先审阅合并结果并完成合并提交，再拉取、同步或推送。',
      )
    if (
      !current.branch ||
      !current.head ||
      current.branch !== input.branch ||
      current.head !== input.head
    )
      throw new Error('分支或 HEAD 已改变，请刷新后重试。')
    if (input.action === 'publish') {
      if (current.tracking || current.upstream)
        throw new Error('分支已有上游，请使用推送而非重新发布。')
    } else if (
      !current.tracking ||
      current.tracking.remote !== tracking?.remote ||
      current.tracking.branch !== tracking.branch
    )
      throw new Error('上游配置已改变，请刷新后重试。')
  }
  verify(status)
  const branch = input.action === 'publish' ? status.branch! : input.tracking.branch
  await runGit(root, ['check-ref-format', `refs/heads/${branch}`])
  if (input.action === 'pull' || input.action === 'sync') {
    if (status.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('请先解决现有合并冲突，再拉取或同步；不会自动 stash。')
    const current = await sourceControl.status(cwd)
    verify(current)
    if (current.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('请先解决现有合并冲突，再拉取或同步；不会自动 stash。')
    try {
      // Pull 不透传 --no-overwrite-ignore，改由分支合并选项保留忽略文件保护。
      await runGit(
        root,
        [
          '-c',
          'merge.autoStash=false',
          '-c',
          `branch.${status.branch}.mergeOptions=--no-overwrite-ignore`,
          '-c',
          'fetch.pruneTags=false',
          '-c',
          `remote.${remote}.pruneTags=false`,
          'pull',
          '--no-rebase',
          input.action === 'sync' ? '--ff' : '--ff-only',
          '--commit',
          '--no-squash',
          '--no-autostash',
          '--no-edit',
          '--refmap=',
          '--no-tags',
          '--no-prune',
          '--no-recurse-submodules',
          '--',
          remote,
          `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
        ],
        true,
      )
    } catch (error) {
      if (input.action === 'sync')
        throw explain(
          error,
          '拉取合并未完成，未执行推送。请检查合并状态；如有冲突，解决并暂存后完成合并提交，再同步。',
        )
      throw error
    }
    if (input.action === 'pull') return true
    try {
      const merged = await sourceControl.status(cwd)
      if (
        merged.branch !== status.branch ||
        merged.tracking?.remote !== input.tracking.remote ||
        merged.tracking.branch !== input.tracking.branch
      )
        throw new Error('分支或上游已改变，请刷新后重试。')
      if (!merged.head || merged.merge || merged.entries.some((entry) => entry.area === 'conflict'))
        throw new Error('合并后 HEAD 无效或仍有冲突，未执行推送。请检查 Git 状态。')
      if (!merged.ahead) return true
      return await mutateRemote(
        cwd,
        merged,
        { ...input, action: 'push', head: merged.head },
        sourceControl,
        onRemoteWrite,
      )
    } catch (error) {
      throw explain(error, '已完成拉取合并，但同步未完成。')
    }
  }
  const urls = await runGit(root, ['remote', 'get-url', '--push', '--all', remote])
  if (urls.trim().split('\n').length !== 1)
    throw new Error('此远端有多个推送地址，请在终端明确处理。')
  verify(await sourceControl.status(cwd))
  if (urls !== (await runGit(root, ['remote', 'get-url', '--push', '--all', remote])))
    throw new Error('推送前远端推送地址已改变，未执行推送。')
  // Push the selected commit, not a HEAD that an Agent could advance while Git connects.
  try {
    await runGit(
      root,
      [
        'push',
        '--porcelain',
        '--no-force',
        '--no-mirror',
        '--no-follow-tags',
        '--recurse-submodules=no',
        '--',
        remote,
        `${status.head}:refs/heads/${branch}`,
      ],
      true,
    )
  } finally {
    onRemoteWrite(urls.trim().split('\n'))
  }
  if (input.action === 'publish') {
    try {
      verify(await sourceControl.status(cwd))
      await runGit(
        root,
        ['branch', `--set-upstream-to=refs/remotes/${remote}/${branch}`, '--', status.branch!],
        true,
      )
    } catch (error) {
      throw explain(error, '远端推送已完成，但上游未能设置。请刷新并在终端检查，不要直接重复推送。')
    }
  }
  return true
}
