import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isUtf8 } from 'node:buffer'
import type {
  GitBranchTarget,
  GitBranchChange,
  GitBranchData,
  GitBranchSnapshot,
  GitBranchView,
} from '../../shared/git-branches'
import { SourceControlWatches } from './source-control-watch'
import type { GitStatus, GitMutation, GitRemoteMutation } from '../../shared/source-control'
import type { SourceControlService } from './source-control'
import { GitService } from './git-worktrees'
import {
  runGit,
  runGitBytes,
  WorktreeError,
  resolveGitCommit,
  explainGitError as explain,
} from './git-runner'

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

type Entry = {
  commonDir: string
  identity: string
  repositoryId: string
  revision: number
  data?: GitBranchSnapshot
  request?: Promise<GitBranchSnapshot>
  requestRevision?: number
  watch?: Promise<boolean>
  watching?: boolean
}
type Subscription = { target: GitBranchTarget; cwd?: string; entry?: Entry }

async function directoryIdentity(path: string): Promise<string> {
  const info = await stat(path)
  return `${info.dev}:${info.ino}:${info.birthtimeMs}`
}

export class BranchService {
  private readonly entries = new Map<string, Entry>()
  private readonly subscriptions = new Map<string, Subscription>()

  private readonly watches: Pick<SourceControlWatches, 'start' | 'stop'>

  constructor(
    private readonly notify: (repositoryId: string) => void = () => {},
    private readonly git = new GitService(),
    private readonly read = readBranchData,
    watches?: Pick<SourceControlWatches, 'start' | 'stop'>,
  ) {
    this.watches =
      watches ||
      new SourceControlWatches(undefined, (_cwd, changes, commonDir) =>
        this.invalidateRepository(commonDir, changes),
      )
  }

  subscribe(id: string, target: GitBranchTarget): void {
    const previous = this.subscriptions.get(id)
    if (previous) {
      if (
        previous.target.workspaceId !== target.workspaceId ||
        previous.target.projectPath !== target.projectPath
      )
        throw new Error('分支订阅绑定已改变。')
      return
    }
    if (this.subscriptions.size >= 128) throw new Error('分支订阅请求过多。')
    this.subscriptions.set(id, { target })
  }

  release(id: string): void {
    const entry = this.subscriptions.get(id)?.entry
    this.subscriptions.delete(id)
    if (
      entry &&
      ![...this.subscriptions.values()].some((subscription) => subscription.entry === entry) &&
      this.entries.get(entry.commonDir) === entry
    ) {
      this.entries.delete(entry.commonDir)
      this.watches.stop(entry.repositoryId)
    }
  }

  prune(targets: GitBranchTarget[]): void {
    for (const [id, subscription] of this.subscriptions)
      if (
        !targets.some(
          (target) =>
            target.projectPath === subscription.target.projectPath &&
            (!subscription.target.workspaceId ||
              target.workspaceId === subscription.target.workspaceId),
        )
      )
        this.release(id)
  }

  invalidate(cwd?: string): void {
    const entries =
      cwd === undefined
        ? [...this.entries.values()]
        : [
            ...new Set(
              [...this.subscriptions.values()]
                .filter((subscription) => subscription.cwd === cwd)
                .flatMap((subscription) => (subscription.entry ? [subscription.entry] : [])),
            ),
          ]
    for (const entry of entries) {
      entry.revision++
      this.notify(entry.repositoryId)
    }
  }

  invalidateRepository(commonDir: string, changes: GitBranchChange[] = ['unknown']): void {
    const entry = this.entries.get(commonDir)
    if (!entry) return
    if (changes.some((change) => change !== 'config')) entry.revision++
    this.notify(entry.repositoryId)
  }

  invalidateProjects(projects: string[]): void {
    const entries = new Set(
      [...this.subscriptions.values()]
        .filter((subscription) => projects.includes(subscription.target.projectPath))
        .flatMap((subscription) => (subscription.entry ? [subscription.entry] : [])),
    )
    for (const entry of entries) this.invalidateRepository(entry.commonDir)
  }

  close(): void {
    for (const entry of this.entries.values()) this.watches.stop(entry.repositoryId)
    this.subscriptions.clear()
    this.entries.clear()
  }

  async mutate(
    cwd: string,
    input: GitBranchMutation,
    sourceControl: Pick<SourceControlService, 'status' | 'references'>,
    onRemoteWrite?: (urls: string[]) => void,
  ): Promise<boolean> {
    const { repoCommonDir } = await this.git.requireRepository(cwd)
    try {
      return await mutateBranch(cwd, input, sourceControl, onRemoteWrite)
    } finally {
      this.invalidateRepository(repoCommonDir)
    }
  }

  private load(entry: Entry, cwd: string): Promise<GitBranchSnapshot> {
    if (entry.data?.revision === entry.revision) return Promise.resolve(entry.data)
    if (entry.request) return entry.request
    const revision = entry.revision
    entry.requestRevision = revision
    const request = this.read(cwd, this.git)
      .then((data) => {
        const snapshot = {
          ...data,
          repositoryId: entry.repositoryId,
          revision,
          fetchedAt: Date.now(),
        }
        if (this.entries.get(entry.commonDir) === entry && entry.revision === revision)
          entry.data = snapshot
        return snapshot
      })
      .finally(() => {
        if (entry.request === request) entry.request = undefined
      })
    entry.request = request
    return request
  }

  async query(cwd: string, id: string, force = false): Promise<GitBranchView> {
    const subscription = this.subscriptions.get(id)
    if (!subscription) throw new Error('分支订阅已结束。')
    const { repoCommonDir } = await this.git.requireRepository(cwd)
    const identity = await directoryIdentity(repoCommonDir)
    if (this.subscriptions.get(id) !== subscription) throw new Error('分支订阅已结束。')
    let entry = this.entries.get(repoCommonDir)
    if (!entry || entry.identity !== identity) {
      if (entry) {
        this.watches.stop(entry.repositoryId)
        this.notify(entry.repositoryId)
      }
      entry = { commonDir: repoCommonDir, identity, repositoryId: randomUUID(), revision: 0 }
      this.entries.set(repoCommonDir, entry)
    }
    if (subscription.entry && subscription.entry !== entry) {
      this.release(id)
      this.subscriptions.set(id, subscription)
    }
    subscription.cwd = cwd
    subscription.entry = entry
    if (!entry.watch) {
      const owned = entry
      const request = this.watches
        .start(
          entry.repositoryId,
          async () => cwd,
          (event) => {
            if (event === 'unavailable' && this.entries.get(repoCommonDir) === owned) {
              owned.watch = undefined
              owned.watching = false
              this.invalidateRepository(repoCommonDir)
            }
          },
          true,
        )
        .then((watching) => {
          if (owned.watch === request) {
            owned.watching = watching
            if (!watching) owned.watch = undefined
          }
          return watching
        })
      entry.watch = request
    }
    await entry.watch
    if (this.subscriptions.get(id) !== subscription || this.entries.get(repoCommonDir) !== entry)
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', '分支订阅已结束。')
    // Concurrent force reads share the same new generation, never the pre-refresh response.
    if (force && (!entry.request || entry.requestRevision === entry.revision)) {
      entry.revision++
      this.notify(entry.repositoryId)
    }
    const active = () =>
      this.subscriptions.get(id) === subscription &&
      subscription.entry === entry &&
      this.entries.get(repoCommonDir) === entry
    let snapshot = await this.load(entry, cwd)
    if (active() && snapshot.revision !== entry.revision) snapshot = await this.load(entry, cwd)
    if (!active())
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', '工作区或分支资源已改变，请重新读取。')
    const remotes = await readBranchRemotes(cwd)
    const currentBranch = subscription.target.workspaceId
      ? undefined
      : await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
          .then((value) => value.replace(/\r?\n$/, ''))
          .catch((error) => {
            if (error instanceof WorktreeError && (error.cause as { code?: number })?.code === 1)
              return null
            throw error
          })
    const currentIdentity = await directoryIdentity(repoCommonDir)
    const currentCommonDir = await realpath(
      (await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(
        /\r?\n$/,
        '',
      ),
    )
    if (!active() || currentIdentity !== identity || currentCommonDir !== repoCommonDir) {
      this.invalidate(cwd)
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库身份已改变，请重新读取。')
    }
    return {
      snapshot,
      remotes,
      stale: snapshot.revision !== entry.revision,
      currentBranch,
      watching: !!entry.watching,
    }
  }
}
async function mutateRemote(
  cwd: string,
  status: GitStatus,
  input: GitRemoteMutation,
  sourceControl: Pick<SourceControlService, 'status' | 'references'>,
  onRemoteWrite: (urls: string[]) => void,
): Promise<boolean> {
  const remote =
    input.action === 'fetch' || input.action === 'publish' ? input.remote : input.tracking?.remote
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
      current.tracking.remote !== input.tracking?.remote ||
      current.tracking.branch !== input.tracking?.branch
    )
      throw new Error('上游配置已改变，请刷新后重试。')
  }
  verify(status)
  const branch = input.action === 'publish' ? status.branch! : input.tracking.branch
  await runGit(root, ['check-ref-format', `refs/heads/${branch}`])
  if (input.action === 'pull' || input.action === 'sync') {
    if (status.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('请先解决现有合并冲突，再拉取或同步；不会自动 stash。')
    const upstream = `refs/remotes/${remote}/${branch}`
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
        `+refs/heads/${branch}:${upstream}`,
      ],
      true,
    )
    const tip = await resolveGitCommit(root, upstream)
    const current = await sourceControl.status(cwd)
    verify(current)
    if (current.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('获取期间出现合并冲突，仅完成 Fetch，未更新工作文件。')
    try {
      await runGit(
        root,
        [
          '-c',
          'merge.autoStash=false',
          'merge',
          input.action === 'sync' ? '--ff' : '--ff-only',
          '--commit',
          '--no-squash',
          '--no-autostash',
          '--no-overwrite-ignore',
          '--no-edit',
          tip,
        ],
        true,
      )
    } catch (error) {
      if (input.action === 'sync')
        throw new Error(
          `拉取合并未完成，未执行推送。如有冲突，请在编辑器或终端解决。\n${explain(error).message}`,
        )
      throw error
    }
    if (input.action === 'pull') return true
    try {
      const merged = await sourceControl.status(cwd)
      if (
        merged.branch !== status.branch ||
        merged.tracking?.remote !== input.tracking.remote ||
        merged.tracking?.branch !== input.tracking.branch
      )
        throw new Error('分支或上游已改变，请刷新后重试。')
      if (!merged.head || merged.entries.some((entry) => entry.area === 'conflict'))
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
      throw new Error(`已完成拉取合并，但同步未完成。\n${explain(error).message}`)
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
      throw new Error(
        `远端推送已完成，但上游未能设置。请刷新并在终端检查，不要直接重复推送。\n${explain(error).message}`,
      )
    }
  }
  return true
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
    if (input.action === 'switch-branch' || input.action === 'delete-branch') {
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
