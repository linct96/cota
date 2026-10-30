import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import {
  hostingProviderSchema,
  type HostingContext,
  type HostingProvider,
  type HostingAccounts,
} from '../../shared/code-hosting'
import type { SourceControlService } from '../git/source-control/service'
import { runGit } from '../git/git-runner'
import { parseHostingRemote } from './remote'
import { scanHostingAccounts } from './accounts'

export const hostingKey = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class HostingContexts {
  generation = 0
  private authorizedCwds?: Set<string>
  private readonly contexts = new Map<string, HostingContext>()
  private readonly accountScans = new Map<HostingProvider, Promise<HostingAccounts>>()
  constructor(
    private readonly git: SourceControlService,
    private readonly scanAccounts = scanHostingAccounts,
  ) {}

  close(): void {
    this.generation++
    this.authorizedCwds = new Set()
    this.contexts.clear()
    this.accountScans.clear()
  }

  prune(cwds: string[]): HostingContext[] {
    this.authorizedCwds = new Set(cwds)
    const removed: HostingContext[] = []
    for (const [cwd, context] of this.contexts) {
      if (cwds.includes(cwd)) continue
      removed.push(context)
      this.contexts.delete(cwd)
    }
    return removed.filter(
      (context) =>
        context.source &&
        ![...this.contexts.values()].some(
          (current) =>
            current.source?.host === context.source!.host &&
            current.source.path === context.source!.path,
        ),
    )
  }

  forgetAccounts(provider: HostingProvider): void {
    this.accountScans.delete(provider)
  }

  assertActive(cwd: string): void {
    if (this.authorizedCwds && !this.authorizedCwds.has(cwd))
      throw new Error('工作区已关闭，请重新选择。')
  }

  private async localContext(cwd: string) {
    this.assertActive(cwd)
    const generation = this.generation
    const status = await this.git.repositoryContext(cwd)
    const names = (await runGit(cwd, ['remote'])).trim().split('\n').filter(Boolean)
    if (names.length > 50) throw new Error('远端数量超过 50，请在终端管理。')
    const urls = await Promise.all(
      names.map(async (name) => (await runGit(cwd, ['remote', 'get-url', '--', name])).trim()),
    )
    return { cwd, generation, status, names, urls }
  }

  async capture(cwd: string) {
    const local = await this.localContext(cwd)
    const commonDir = await realpath(
      (await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(
        /\r?\n$/,
        '',
      ),
    )
    const info = await stat(commonDir)
    return {
      ...local,
      identity: `${commonDir}:${info.dev}:${info.ino}:${info.birthtimeMs}`,
    }
  }

  async context(cwd: string): Promise<HostingContext> {
    return this.resolveContext(await this.localContext(cwd))
  }

  async resolveContext(
    captured: Awaited<ReturnType<HostingContexts['localContext']>>,
  ): Promise<HostingContext> {
    const { cwd, status, names, urls } = captured
    if (captured.generation !== this.generation)
      throw new Error('代码托管上下文已失效，请重新读取。')
    const remotes = names.map((name, index) => ({
      name,
      repository: parseHostingRemote(urls[index]),
    }))
    const custom = urls.flatMap((url, index) => {
      const repository = !remotes[index].repository && parseHostingRemote(url, 'gitlab')
      return repository ? [{ index, host: repository.host }] : []
    })
    let ambiguousHost = false
    let discoveryFailed = false
    if (custom.length) {
      const scans = await Promise.allSettled(
        hostingProviderSchema.options.map(async (provider) => ({
          provider,
          accounts: await this.accountScan(provider),
        })),
      )
      discoveryFailed = scans.some((scan) => scan.status === 'rejected')
      for (const { index, host } of custom) {
        const providers = scans.flatMap((scan) =>
          scan.status === 'fulfilled' &&
          scan.value.accounts.status === 'detected' &&
          scan.value.accounts.accounts.some((account) => account.host === host)
            ? [scan.value.provider]
            : [],
        )
        if (providers.length === 1)
          remotes[index].repository = parseHostingRemote(urls[index], providers[0])
        else if (providers.length > 1) ambiguousHost = true
      }
    }
    const upstream =
      status.tracking &&
      remotes.find((remote) => remote.name === status.tracking!.remote && remote.repository)
    const candidates = remotes.filter((remote) => remote.repository)
    const selected =
      upstream || (!ambiguousHost && candidates.length === 1 ? candidates[0] : undefined)
    const source = selected?.repository || null
    const target = source
    const sourceBranch =
      status.tracking && selected?.name === status.tracking.remote
        ? status.tracking.branch
        : status.branch
    let reason: string | undefined
    if (!selected && ambiguousHost)
      reason = '同一自定义端点同时出现在 GitHub 和 GitLab CLI 中，请先在代码托管设置中核对平台。'
    else if (!source || !target)
      reason = discoveryFailed
        ? '自定义托管端点读取失败，请在代码托管设置中重新检测 CLI 连接。'
        : '无法自动识别代码托管仓库，请检查 Git 远端、分支上游及代码托管设置中的 CLI 端点。'
    const context: HostingContext = {
      remotes,
      source,
      target,
      branch: status.branch,
      sourceBranch,
      head: status.head,
      key: hostingKey({
        source,
        target,
        remotes,
      }),
      ...(reason ? { reason } : {}),
    }
    this.assertActive(cwd)
    if (captured.generation !== this.generation)
      throw new Error('代码托管上下文已失效，请重新读取。')
    this.contexts.set(cwd, context)
    return context
  }

  accountScan(provider: HostingProvider, refresh = false): Promise<HostingAccounts> {
    const cached = this.accountScans.get(provider)
    if (!refresh && cached) return cached
    // Endpoint discovery is refreshed explicitly; API access still checks the current CLI account.
    const promise = this.scanAccounts(provider)
    this.accountScans.set(provider, promise)
    void promise.catch(() => {
      if (this.accountScans.get(provider) === promise) this.accountScans.delete(provider)
    })
    return promise
  }
}
