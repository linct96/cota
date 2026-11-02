import { z } from 'zod'
import {
  createHostedReviewSchema,
  hostingHostSchema,
  hostingBranchSchema,
  hostingProviderSchema,
  mergeHostedReviewSchema,
  prepareHostedReviewSchema,
  type PrepareHostedReview,
  type HostedReviewPreparation,
  type HostedReviewCreationContext,
  type HostedReview,
  type HostingContext,
  type HostingConnection,
  type HostingSnapshot,
} from '../../shared/code-hosting'
import type { ConfigStore } from '../settings/config-store'
import type { SourceControlService } from '../git/source-control/service'
import { WorktreeError } from '../git/git-runner'
import type { HostingAdapter, ReviewScope } from './adapter'
import { GitHubAdapter } from './github'
import { GitLabAdapter } from './gitlab'
import { HostingError } from './cli-runner'
import { scanHostingAccounts } from './accounts'
import { HostingBranches } from './branches'
import { HostingContexts, hostingKey } from './context'
import { prepareReview } from './review-preparation'

export class CodeHostingService {
  private readonly creating = new Set<string>()
  private readonly merging = new Set<string>()
  private readonly branches = new HostingBranches()
  private readonly creationScopes = new Map<
    string,
    {
      key: string
      expiresAt: number
      current: { adapter: HostingAdapter; scope: ReviewScope; account: string }
    }
  >()

  private readonly contexts: HostingContexts

  constructor(
    private readonly config: ConfigStore,
    git: SourceControlService,
    private readonly adapters: Record<'github' | 'gitlab', HostingAdapter> = {
      github: new GitHubAdapter(),
      gitlab: new GitLabAdapter(),
    },
    scanAccounts = scanHostingAccounts,
  ) {
    this.contexts = new HostingContexts(git, scanAccounts)
  }

  invalidateRemoteBranches(urls: string[]): void {
    this.branches.invalidateRemotes(urls)
    this.creationScopes.clear()
  }

  close(): void {
    this.contexts.close()
    this.branches.clear()
    this.creationScopes.clear()
  }

  prune(cwds: string[]): void {
    for (const cwd of this.creationScopes.keys())
      if (!cwds.includes(cwd)) this.creationScopes.delete(cwd)
    for (const context of this.contexts.prune(cwds))
      if (context.source) this.branches.invalidate(context.source)
  }

  capture(cwd: string) {
    return this.contexts.capture(cwd)
  }
  context(cwd: string): Promise<HostingContext> {
    return this.contexts.context(cwd)
  }
  resolveContext(
    captured: Parameters<HostingContexts['resolveContext']>[0],
  ): Promise<HostingContext> {
    return this.contexts.resolveContext(captured)
  }

  async accounts(providerValue: unknown) {
    const provider = hostingProviderSchema.parse(providerValue)
    this.creationScopes.clear()
    this.branches.clear()
    return this.contexts.accountScan(provider, true)
  }

  async connection(providerValue: unknown, hostValue: unknown): Promise<HostingConnection> {
    const provider = hostingProviderSchema.parse(providerValue)
    const host = hostingHostSchema.parse(hostValue)
    this.contexts.forgetAccounts(provider)
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
    return hostingKey({
      source: context.source,
      target: context.target,
      branch: context.sourceBranch,
    })
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
    this.contexts.assertActive(cwd)
    const { adapter, scope, account } = current
    try {
      const [source, target] = await Promise.all([
        this.branches.get(scope.source, scope.sourceInfo.id, account, adapter, force),
        scope.sourceInfo.id === scope.targetInfo.id && scope.source.host === scope.target.host
          ? undefined
          : this.branches.get(scope.target, scope.targetInfo.id, account, adapter, force),
      ])
      this.contexts.assertActive(cwd)
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
    const generation = this.contexts.generation
    const input = prepareHostedReviewSchema.pick({ key: true, account: true }).parse(value)
    const context = resolvedContext || (await this.context(cwd))
    if (context.key !== input.key)
      throw new HostingError('auth', '仓库或远端已改变，请重新打开弹窗。')
    const current = await this.scope(context)
    if (current.account !== input.account) {
      if (context.source) this.branches.invalidate(context.source)
      throw new HostingError('auth', 'CLI 账号已改变，请重新打开弹窗确认。')
    }
    if (generation !== this.contexts.generation)
      throw new Error('代码托管上下文已失效，请重新读取。')
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
    const generation = this.contexts.generation
    const context = resolvedContext || (await this.context(cwd))
    for (const [path, cached] of this.creationScopes)
      if (path === cwd || cached.expiresAt <= Date.now()) this.creationScopes.delete(path)
    const current = await this.scope(context)
    const { scope, account } = current
    if (generation !== this.contexts.generation)
      throw new Error('代码托管上下文已失效，请重新读取。')
    const lists = await this.branchLists(cwd, context, current)
    this.contexts.assertActive(cwd)
    if (generation !== this.contexts.generation)
      throw new Error('代码托管上下文已失效，请重新读取。')
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
    return prepareReview(input, adapter, scope, !!this.pending(context), reviews)
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

  async merge(cwd: string, value: unknown): Promise<HostedReview> {
    const input = mergeHostedReviewSchema.parse(value)
    const initial = await this.context(cwd)
    if (initial.key !== input.key || initial.sourceBranch !== input.sourceBranch)
      throw new Error('仓库、远端或来源分支已改变，请刷新后重新确认合并。')
    const { adapter, scope, account } = await this.scope(initial)
    if (account !== input.account) throw new Error('CLI 账号已改变，请刷新后重新确认合并。')
    const key = JSON.stringify([
      scope.target.provider,
      scope.target.host,
      scope.targetInfo.id,
      input.number,
    ])
    if (this.merging.has(key)) throw new Error('该评审正在合并，请稍后刷新。')
    this.merging.add(key)
    const matches = (review: HostedReview) =>
      review.number === input.number &&
      review.sourceBranch === input.sourceBranch &&
      review.targetBranch === input.targetBranch &&
      review.head === input.head
    try {
      const current = await adapter.get(scope, input.number)
      if (!matches(current)) throw new Error('评审分支或远端提交已改变，请刷新后重新确认合并。')
      if (current.state === 'merged') return current
      if (current.state !== 'open' || current.draft)
        throw new Error('只能合并开放且非草稿的评审，请刷新或在网页处理。')
      if ((await this.context(cwd)).key !== input.key)
        throw new Error('合并前仓库或远端已改变，请刷新后重试。')
      if ((await adapter.account(scope.source)) !== account)
        throw new Error('CLI 账号已改变，请刷新后重新确认合并。')
      try {
        const merged = await adapter.merge(scope, current)
        if (!matches(merged) || merged.state !== 'merged')
          throw new Error('平台未返回已确认的合并结果。')
        return merged
      } catch (error) {
        // A timed-out merge may have succeeded; only read back, never repeat the write.
        const reconciled = await adapter.get(scope, input.number).catch(() => undefined)
        if (reconciled && matches(reconciled) && reconciled.state === 'merged') return reconciled
        if (error instanceof HostingError && error.kind !== 'network' && error.kind !== 'response')
          throw error
        throw new Error('合并结果未确认，请刷新或在平台网页核对，不要直接重试。')
      }
    } finally {
      this.merging.delete(key)
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
