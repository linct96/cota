import {
  hostingBranchesExpired,
  type HostingBranch,
  type HostingRepository,
} from '../../shared/code-hosting'
import type { HostingAdapter } from './adapter'
import { HostingError } from './cli-runner'
import { parseHostingRemote } from './remote'

type Entry = {
  repository: HostingRepository
  revision: number
  data?: HostingBranch[]
  fetchedAt: number
  dataRevision?: number
  request?: Promise<HostingBranch[]>
  requestRevision?: number
}

export class HostingBranches {
  private readonly entries = new Map<string, Entry>()

  invalidate(repository: Pick<HostingRepository, 'host' | 'path'>): void {
    for (const [key, entry] of this.entries)
      if (
        entry.repository.host === repository.host &&
        (entry.repository.provider === 'github'
          ? entry.repository.path.toLowerCase() === repository.path.toLowerCase()
          : entry.repository.path === repository.path)
      )
        this.entries.delete(key)
  }

  invalidateRemotes(urls: string[]): void {
    for (const url of urls) {
      // Parse identity only; matching an existing cache never guesses a provider or scans accounts.
      const repository = parseHostingRemote(url, 'gitlab')
      if (repository) this.invalidate(repository)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  async get(
    repository: HostingRepository,
    repositoryId: number,
    account: string,
    adapter: Pick<HostingAdapter, 'branches'>,
    force = false,
  ): Promise<{ branches: HostingBranch[]; stale: boolean; fetchedAt: number }> {
    const key = JSON.stringify([
      repository.provider,
      repository.host,
      repository.path,
      repositoryId,
      account,
    ])
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { repository, revision: 0, fetchedAt: 0 }
      this.entries.set(key, entry)
      while (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!)
    }
    if (!force && entry.data && entry.dataRevision === entry.revision)
      return {
        branches: entry.data,
        stale: hostingBranchesExpired(entry.fetchedAt),
        fetchedAt: entry.fetchedAt,
      }
    if (force && entry.request && entry.requestRevision === entry.revision) entry.revision++
    const owned = entry
    const load = () => {
      if (owned.request) return owned.request
      const revision = owned.revision
      owned.requestRevision = revision
      const request = adapter
        .branches(repository)
        .then((branches) => {
          if (this.entries.get(key) === owned && owned.revision === revision) {
            owned.data = branches
            owned.dataRevision = revision
            owned.fetchedAt = Date.now()
          }
          return branches
        })
        .catch((error) => {
          if (
            error instanceof HostingError &&
            ['auth', 'forbidden', 'not-found'].includes(error.kind)
          )
            this.invalidate(repository)
          throw error
        })
        .finally(() => {
          if (owned.request === request) owned.request = undefined
        })
      owned.request = request
      return request
    }
    await load()
    if (this.entries.get(key) === owned && owned.dataRevision !== owned.revision) await load()
    if (this.entries.get(key) !== owned || !owned.data || owned.dataRevision !== owned.revision)
      throw new HostingError('response', '远端分支资源已失效，请重新读取。')
    return { branches: owned.data, stale: false, fetchedAt: owned.fetchedAt }
  }
}
