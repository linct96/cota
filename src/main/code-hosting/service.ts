import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { z } from 'zod'
import {
  createHostedReviewSchema,
  hostingHostSchema,
  hostingBranchSchema,
  hostingProviderSchema,
  prepareHostedReviewSchema,
  type PrepareHostedReview,
  type HostedReviewPreparation,
  type HostedReviewCreationContext,
  type HostedReview,
  type HostingContext,
  type HostingComparison,
  type HostingConnection,
  type HostingSnapshot,
  type HostingAccounts,
  type HostingProvider,
} from '../../shared/code-hosting'
import type { ConfigStore } from '../config'
import type { SourceControlService } from '../git/source-control'
import { runGit, WorktreeError } from '../git/git-runner'
import type { HostingAdapter, ReviewScope } from './adapter'
import { GitHubAdapter } from './github'
import { GitLabAdapter } from './gitlab'
import { parseHostingRemote } from './remote'
import { HostingError } from './cli-runner'
import { scanHostingAccounts } from './accounts'
import { HostingBranches } from './branches'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class CodeHostingService {
  private readonly creating = new Set<string>()
  private readonly branches = new HostingBranches()
  private generation = 0
  private authorizedCwds?: Set<string>
  private readonly contexts = new Map<string, HostingContext>()
  private readonly accountScans = new Map<HostingProvider, Promise<HostingAccounts>>()
  private readonly creationScopes = new Map<
    string,
    {
      key: string
      expiresAt: number
      current: { adapter: HostingAdapter; scope: ReviewScope; account: string }
    }
  >()

  constructor(
    private readonly config: ConfigStore,
    private readonly git: SourceControlService,
    private readonly adapters: Record<'github' | 'gitlab', HostingAdapter> = {
      github: new GitHubAdapter(),
      gitlab: new GitLabAdapter(),
    },
    private readonly scanAccounts = scanHostingAccounts,
  ) {}

  invalidateRemoteBranches(urls: string[]): void {
    this.branches.invalidateRemotes(urls)
    this.creationScopes.clear()
  }

  close(): void {
    this.generation++
    this.authorizedCwds = new Set()
    this.branches.clear()
    this.contexts.clear()
    this.creationScopes.clear()
    this.accountScans.clear()
  }

  prune(cwds: string[]): void {
    this.authorizedCwds = new Set(cwds)
    const removed: HostingContext[] = []
    for (const [cwd, context] of this.contexts)
      if (!cwds.includes(cwd)) {
        removed.push(context)
        this.contexts.delete(cwd)
        this.creationScopes.delete(cwd)
      }
    for (const context of removed)
      if (
        context.source &&
        ![...this.contexts.values()].some(
          (current) =>
            current.source?.host === context.source!.host &&
            current.source.path === context.source!.path,
        )
      )
        this.branches.invalidate(context.source)
  }

  private assertActive(cwd: string): void {
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
    captured: Awaited<ReturnType<CodeHostingService['localContext']>>,
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
      key: hash({
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

  private accountScan(provider: HostingProvider, refresh = false): Promise<HostingAccounts> {
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

  async accounts(providerValue: unknown) {
    const provider = hostingProviderSchema.parse(providerValue)
    this.creationScopes.clear()
    this.branches.clear()
    return this.accountScan(provider, true)
  }

  async connection(providerValue: unknown, hostValue: unknown): Promise<HostingConnection> {
    const provider = hostingProviderSchema.parse(providerValue)
    const host = hostingHostSchema.parse(hostValue)
    this.accountScans.delete(provider)
    this.creationScopes.clear()
    this.branches.clear()
    try {
      const account = await this.adapters[provider].account({ provider, host, path: '' })
      return { status: 'connected', account }
    } catch (error) {
      if (error instanceof HostingError && (error.kind === 'auth' || error.kind === 'cli'))
        return {
          status: error.kind === 'auth' ? 'disconnected' : 'cli-unavailable',
          message: error.message,
        }
      throw error
    }
  }

  private async scope(context: HostingContext) {
    if (context.reason || !context.source || !context.target)
      throw new Error(context.reason || '无法自动识别代码托管仓库，请检查 Git 远端。')
    const adapter = this.adapters[context.source.provider]
    try {
      const [account, sourceInfo] = await Promise.all([
        adapter.account(context.source),
        adapter.repository(context.source),
      ])
      const targetInfo =
        context.source.path === context.target.path
          ? sourceInfo
          : await adapter.repository(context.target)
      const scope: ReviewScope = {
        source: context.source,
        target: context.target,
        sourceInfo,
        targetInfo,
        branch: context.sourceBranch || '',
      }
      return { adapter, scope, account }
    } catch (error) {
      if (
        error instanceof HostingError &&
        ['auth', 'forbidden', 'not-found'].includes(error.kind)
      ) {
        this.branches.invalidate(context.source)
        this.branches.invalidate(context.target)
      }
      throw error
    }
  }

  private pendingKey(context: HostingContext): string {
    // Exclude HEAD and target branch: editing either must not bypass an uncertain POST.
    return hash({ source: context.source, target: context.target, branch: context.sourceBranch })
  }

  private pending(context: HostingContext) {
    const key = this.pendingKey(context)
    return this.config
      .snapshot()
      .codeHostingPendingCreates?.find(
        (entry) => (typeof entry === 'string' ? entry : entry.key) === key,
      )
  }

  private async reconcile(
    context: HostingContext,
    account: string,
    reviews: HostedReview[],
    ownsLock = false,
  ) {
    // Background reads must not clear protection for an in-flight POST.
    if (this.creating.has(this.pendingKey(context)) && !ownsLock) return
    const pending = this.pending(context)
    // Legacy keys have no target identity; only explicit user confirmation can clear them.
    if (
      pending &&
      typeof pending !== 'string' &&
      pending.account === account &&
      reviews.filter(
        (review) =>
          review.state === 'open' &&
          review.sourceBranch === context.sourceBranch &&
          review.targetBranch === pending.targetBranch,
      ).length === 1
    )
      await this.config.saveCodeHostingPending(this.pendingKey(context), null)
  }

  private async snapshot(
    context: HostingContext,
    account: string,
    defaultBranch: string,
    activeReviews: HostedReview[],
    adapter: HostingAdapter,
    scope: ReviewScope,
  ): Promise<HostingSnapshot> {
    await this.reconcile(context, account, activeReviews)
    await Promise.all(
      activeReviews.map(async (current) => {
        try {
          current.checks = await adapter.checks(scope, current)
        } catch (error) {
          current.checks = 'unknown'
          current.checksError =
            error instanceof z.ZodError
              ? '检查结果格式无法识别，请检查 CLI 版本。'
              : error instanceof Error
                ? error.message
                : '检查读取失败，请刷新。'
        }
      }),
    )
    return {
      context,
      account,
      defaultBranch,
      activeReviews,
      fetchedAt: Date.now(),
      creationBlocked: !!this.pending(context),
    }
  }

  private async branchLists(
    cwd: string,
    context: HostingContext,
    current: { adapter: HostingAdapter; scope: ReviewScope; account: string },
    force = false,
  ) {
    this.assertActive(cwd)
    const { adapter, scope, account } = current
    try {
      const [source, target] = await Promise.all([
        this.branches.get(scope.source, scope.sourceInfo.id, account, adapter, force),
        scope.sourceInfo.id === scope.targetInfo.id && scope.source.host === scope.target.host
          ? undefined
          : this.branches.get(scope.target, scope.targetInfo.id, account, adapter, force),
      ])
      this.assertActive(cwd)
      return {
        sourceBranches: source.branches,
        targetBranches: (target || source).branches,
        branchesStale: source.stale || !!target?.stale,
        branchesFetchedAt: Math.min(source.fetchedAt, (target || source).fetchedAt),
      }
    } catch (error) {
      if (
        error instanceof HostingError &&
        ['auth', 'forbidden', 'not-found'].includes(error.kind)
      ) {
        if (context.source) this.branches.invalidate(context.source)
        if (context.target) this.branches.invalidate(context.target)
      }
      throw error
    }
  }

  async refreshBranches(cwd: string, value: unknown, resolvedContext?: HostingContext) {
    const generation = this.generation
    const input = prepareHostedReviewSchema.pick({ key: true, account: true }).parse(value)
    const context = resolvedContext || (await this.context(cwd))
    if (context.key !== input.key)
      throw new HostingError('auth', '仓库或远端已改变，请重新打开弹窗。')
    const current = await this.scope(context)
    if (current.account !== input.account) {
      if (context.source) this.branches.invalidate(context.source)
      throw new HostingError('auth', 'CLI 账号已改变，请重新打开弹窗确认。')
    }
    if (generation !== this.generation) throw new Error('代码托管上下文已失效，请重新读取。')
    return this.branchLists(cwd, context, current, true)
  }

  async inspect(cwd: string, resolvedContext?: HostingContext): Promise<HostingSnapshot> {
    const context = resolvedContext || (await this.context(cwd))
    const { adapter, scope, account } = await this.scope(context)
    return this.snapshot(
      context,
      account,
      scope.targetInfo.defaultBranch,
      scope.branch ? await adapter.listOpen(scope) : [],
      adapter,
      scope,
    )
  }

  async creationContext(
    cwd: string,
    resolvedContext?: HostingContext,
  ): Promise<HostedReviewCreationContext> {
    const generation = this.generation
    const context = resolvedContext || (await this.context(cwd))
    for (const [path, cached] of this.creationScopes)
      if (path === cwd || cached.expiresAt <= Date.now()) this.creationScopes.delete(path)
    const current = await this.scope(context)
    const { adapter, scope, account } = current
    if (generation !== this.generation) throw new Error('代码托管上下文已失效，请重新读取。')
    const lists = await this.branchLists(cwd, context, current)
    this.assertActive(cwd)
    if (generation !== this.generation) throw new Error('代码托管上下文已失效，请重新读取。')
    this.creationScopes.set(cwd, { key: context.key, current, expiresAt: Date.now() + 5000 })
    return {
      context,
      account,
      defaultBranch: scope.targetInfo.defaultBranch,
      ...lists,
    }
  }

  async history(cwd: string, key: unknown, value: unknown, resolvedContext?: HostingContext) {
    const page = z.number().int().min(1).max(10000).parse(value)
    const context = resolvedContext || (await this.context(cwd))
    if (context.key !== key) throw new Error('工作区已改变，请刷新历史。')
    const { adapter, scope } = await this.scope(context)
    return scope.branch
      ? adapter.history(scope, page)
      : { items: [], nextPage: null, fetchedAt: Date.now() }
  }

  private async prepareContext(
    cwd: string,
    input: PrepareHostedReview,
    reuseInitialization = false,
    resolvedContext?: HostingContext,
  ) {
    const cached = this.creationScopes.get(cwd)
    this.creationScopes.delete(cwd)
    const currentContext = resolvedContext || (await this.context(cwd))
    if (currentContext.key !== input.key)
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库或远端已改变，请刷新后重新创建。')
    const context = { ...currentContext, sourceBranch: input.sourceBranch }
    // Only the first preflight reuses repository info; account checks and create stay fresh.
    const current =
      reuseInitialization &&
      cached?.key === context.key &&
      cached.expiresAt > Date.now() &&
      cached.current.account === input.account
        ? {
            ...cached.current,
            account: await cached.current.adapter.account(cached.current.scope.source),
            scope: { ...cached.current.scope, branch: input.sourceBranch },
          }
        : await this.scope(context)
    if (current.account !== input.account)
      throw new HostingError('auth', 'CLI 账号已改变，请刷新后重新确认。')
    return { context, ...current }
  }

  private async preparation(
    context: HostingContext,
    input: PrepareHostedReview,
    adapter: HostingAdapter,
    scope: ReviewScope,
    account: string,
    reviews: HostedReview[],
    ownsLock = false,
  ): Promise<HostedReviewPreparation> {
    await this.reconcile(context, account, reviews, ownsLock)
    const existingReviews = reviews.filter(
      (review) =>
        review.sourceBranch === input.sourceBranch && review.targetBranch === input.targetBranch,
    )
    if (existingReviews.length)
      return {
        status: existingReviews.length === 1 ? 'existing' : 'blocked',
        existingReviews,
        message:
          existingReviews.length === 1
            ? '该目标已有开放评审，将使用已有记录，不会重复创建。'
            : '该目标存在多个开放评审，请在网页核对；已阻止创建。',
      }
    const result = (
      status: HostedReviewPreparation['status'],
      message: string,
    ): HostedReviewPreparation => ({ status, message, existingReviews: [] })
    if (this.pending(context))
      return {
        ...result('blocked', '上次创建的结果尚未确认，已阻止重复提交。'),
        creationBlocked: true,
      }
    if (scope.sourceInfo.id === scope.targetInfo.id && scope.branch === input.targetBranch)
      return result('blocked', '来源分支和目标分支不能相同。')
    const [sourceHead, targetHead] = await Promise.all([
      adapter.branchHead(scope.source, scope.branch),
      adapter.branchHead(scope.target, input.targetBranch),
    ])
    const comparison = await adapter
      .compare(scope, sourceHead, targetHead)
      .catch((): HostingComparison => ({ status: 'unknown' }))
    if (comparison.status === 'unknown')
      return result('unknown', '无法确认远端差异，请刷新或在平台网页核对后创建。')
    if (comparison.status === 'empty')
      return result('empty', '远端来源与目标之间没有可评审差异，无需创建。')
    return {
      ...result('ready', ''),
      sourceHead,
      defaultTitle: comparison.defaultTitle,
      defaultDescription: comparison.defaultDescription,
    }
  }

  async prepare(
    cwd: string,
    value: unknown,
    context?: HostingContext,
  ): Promise<HostedReviewPreparation> {
    const input = prepareHostedReviewSchema.parse(value)
    const current = await this.prepareContext(cwd, input, true, context)
    return this.preparation(
      current.context,
      input,
      current.adapter,
      current.scope,
      current.account,
      await current.adapter.listOpen(current.scope),
    )
  }

  async create(cwd: string, value: unknown): Promise<HostedReview> {
    const input = createHostedReviewSchema.parse(value)
    const initial = await this.context(cwd)
    if (initial.key !== input.key)
      throw new WorktreeError('REPOSITORY_UNAVAILABLE', '仓库或远端已改变，请刷新后重新创建。')
    const key = this.pendingKey({ ...initial, sourceBranch: input.sourceBranch })
    if (this.creating.has(key)) throw new Error('当前来源分支正在创建评审，请稍后刷新。')
    this.creating.add(key)
    try {
      const { context, adapter, scope, account } = await this.prepareContext(cwd, input)
      const reviews = await adapter.listOpen(scope)
      const preparation = await this.preparation(
        context,
        input,
        adapter,
        scope,
        account,
        reviews,
        true,
      )
      if (preparation.status === 'existing') return preparation.existingReviews[0]!
      if (preparation.status !== 'ready') throw new Error(preparation.message)
      if ((await this.context(cwd)).key !== input.key)
        throw new Error('创建前仓库或远端已改变，请刷新后重试。')
      if ((await adapter.account(scope.source)) !== account)
        throw new Error('CLI 账号已改变，请刷新后重新确认。')
      await this.config.saveCodeHostingPending(key, {
        key,
        source: scope.source,
        target: scope.target,
        sourceBranch: scope.branch,
        targetBranch: input.targetBranch,
        sourceHead: preparation.sourceHead!,
        account,
        startedAt: Date.now(),
      })
      let created: HostedReview
      try {
        created = await adapter.create(scope, input)
        if (
          created.sourceBranch !== input.sourceBranch ||
          created.targetBranch !== input.targetBranch
        )
          throw new Error('平台返回的源分支或目标分支不匹配。')
      } catch (error) {
        // A failed POST may have succeeded remotely. Reconcile once, never POST again.
        const reconciled = await adapter.listOpen(scope).catch(() => [])
        const matches = reconciled.filter(
          (review) =>
            review.sourceBranch === input.sourceBranch &&
            review.targetBranch === input.targetBranch,
        )
        if (matches.length === 1) {
          await this.config.saveCodeHostingPending(key, null)
          return matches[0]!
        }
        if (error instanceof HostingError && error.kind === 'rejected') {
          await this.config.saveCodeHostingPending(key, null)
          throw error
        }
        throw new Error(
          '创建结果未确认（请求可能已在远端成功），已启用跨重启的重复创建保护。请刷新或在网页核对，不要直接重试。',
        )
      }
      await this.config.saveCodeHostingPending(key, null)
      return created
    } finally {
      this.creating.delete(key)
    }
  }

  async reviewUrl(
    cwd: string,
    value: unknown,
    sourceBranch?: unknown,
    resolvedContext?: HostingContext,
  ): Promise<string> {
    const number = z.number().int().positive().parse(value)
    const context = { ...(resolvedContext || (await this.context(cwd))) }
    if (sourceBranch !== undefined) context.sourceBranch = hostingBranchSchema.parse(sourceBranch)
    const { adapter, scope } = await this.scope(context)
    return (await adapter.get(scope, number)).url
  }

  async clearCreation(cwd: string, key: unknown, sourceBranch?: unknown): Promise<void> {
    const context = await this.context(cwd)
    if (context.key !== key) throw new Error('工作区已改变，请刷新后重试。')
    if (sourceBranch !== undefined) context.sourceBranch = hostingBranchSchema.parse(sourceBranch)
    const pendingKey = this.pendingKey(context)
    if (this.creating.has(pendingKey)) throw new Error('评审创建仍在进行中，不能解除保护。')
    this.creating.add(pendingKey)
    try {
      await this.config.saveCodeHostingPending(pendingKey, null)
    } finally {
      this.creating.delete(pendingKey)
    }
  }
}
