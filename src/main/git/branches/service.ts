import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type {
  GitBranchChange,
  GitBranchSnapshot,
  GitBranchTarget,
  GitBranchView,
} from '../../../shared/git-branches'
import { SourceControlWatches } from '../source-control/watch'
import type { SourceControlService } from '../source-control/service'
import { GitService } from '../worktrees/git'
import { WorktreeError, runGit } from '../git-runner'
import { readBranchData, readBranchRemotes } from './read'
import { mutateBranch } from './mutations'
import type { GitBranchMutation } from './mutations'

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
          () => cwd,
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
            if (
              error instanceof WorktreeError &&
              (error.cause as { code?: number } | undefined)?.code === 1
            )
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
