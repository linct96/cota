import { z } from 'zod'
import { accountIdSchema, supportsAutomaticUsageRefresh } from '../../shared/accounts'
import type {
  AccountProduct,
  AccountProfile,
  AccountUsageRefreshStatus,
  UsageRefreshSettings,
} from '../../shared/accounts'
import type { AccountService } from './service'
import { readOptional, writePrivate } from './files'

const REFRESH_TICK_MS = 10_000
const MAX_ATTEMPTS = 10_000
const refreshStateSchema = z.strictObject({
  version: z.literal(1),
  attempts: z.record(accountIdSchema, z.number().finite().nonnegative()),
})

export class AccountUsageScheduler {
  private readonly attempts = new Map<string, number>()
  private readonly attemptVersions = new Map<string, number>()
  private readonly statuses = new Map<string, AccountUsageRefreshStatus>()
  private readonly savedAccounts = new Map<string, { product: AccountProduct }>()
  private writeQueue: Promise<unknown> = Promise.resolve()
  private running?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private storageError?: Error
  private stopped = false
  private rerun = false

  constructor(
    private readonly accounts: AccountService,
    private readonly path: string,
    private settings: UsageRefreshSettings,
    private readonly available: () => boolean,
    private readonly emit: (status: AccountUsageRefreshStatus) => void,
  ) {}

  async start(): Promise<void> {
    try {
      const content = await readOptional(this.path)
      if (content !== null) {
        const saved = refreshStateSchema.parse(JSON.parse(content))
        if (Object.keys(saved.attempts).length > MAX_ATTEMPTS) throw new Error('记录数量超限。')
        for (const [id, time] of Object.entries(saved.attempts)) this.attempts.set(id, time)
      }
    } catch (cause) {
      this.storageError = new Error(`无法读取额度刷新记录，原文件已保留：${this.path}`, { cause })
      console.warn(this.storageError.message)
    }
    if (this.stopped) return
    this.accounts.setRefreshAttemptRecorder((id) => this.recordAttempt(id))
    this.accounts.setRefreshErrorClearer((id) => this.clearError(id))
    this.accounts.setSavedAccountRefreshRequester((product, ids) => {
      if (this.stopped) return
      for (const id of ids) this.savedAccounts.set(id, { product })
      this.request()
    })
    this.timer = setInterval(() => this.request(), REFRESH_TICK_MS)
    this.request()
  }

  configure(settings: UsageRefreshSettings): void {
    this.settings = settings
    this.request()
  }

  wake(): void {
    this.request()
  }

  snapshot(): AccountUsageRefreshStatus[] {
    return [...this.statuses.values()].map((status) => ({ ...status }))
  }

  clearError(id: string): void {
    const status = this.statuses.get(id)
    if (status && !status.refreshing) this.setStatus({ ...status, error: undefined })
  }

  async close(): Promise<void> {
    this.stopped = true
    this.rerun = false
    this.savedAccounts.clear()
    if (this.timer) clearInterval(this.timer)
    await this.running?.catch(() => {})
    await this.writeQueue
  }

  private canRun(): boolean {
    return !this.stopped && this.available()
  }

  private allowed(): boolean {
    return this.settings.enabled && this.canRun()
  }

  private due(
    id: string,
    account: Pick<AccountProfile, 'usageUpdatedAt' | 'usagePrimary' | 'usageSecondary'>,
    active: boolean,
  ): boolean {
    const now = Date.now()
    const lastChecked = Math.max(account.usageUpdatedAt ?? 0, this.attempts.get(id) ?? 0)
    const interval = active
      ? this.settings.activeIntervalMinutes
      : this.settings.inactiveIntervalMinutes
    if (now - lastChecked >= interval * 60_000) return true
    return [account.usagePrimary, account.usageSecondary].some(
      (window) =>
        window !== null &&
        window.resetsAt !== null &&
        window.resetsAt > 0 &&
        window.resetsAt <= now &&
        lastChecked < window.resetsAt,
    )
  }

  private saveAttempts(): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      if (this.storageError) throw this.storageError
      await writePrivate(
        this.path,
        `${JSON.stringify({ version: 1, attempts: Object.fromEntries(this.attempts) }, null, 2)}\n`,
      )
    })
    this.writeQueue = operation.catch(() => {})
    return operation
  }

  private async recordAttempt(id: string): Promise<() => Promise<void>> {
    const previous = this.attempts.get(id)
    const version = (this.attemptVersions.get(id) ?? 0) + 1
    this.attemptVersions.set(id, version)
    this.attempts.set(id, Date.now())
    if (this.attempts.size > MAX_ATTEMPTS) {
      const oldest = [...this.attempts].sort((a, b) => a[1] - b[1]).find(([key]) => key !== id)
      if (oldest) {
        this.attempts.delete(oldest[0])
        this.attemptVersions.delete(oldest[0])
      }
    }
    await this.saveAttempts()
    return async () => {
      if (this.attemptVersions.get(id) !== version) return
      if (previous === undefined) this.attempts.delete(id)
      else this.attempts.set(id, previous)
      await this.saveAttempts()
    }
  }

  private setStatus(status: AccountUsageRefreshStatus): void {
    if (status.refreshing || status.error) this.statuses.set(status.id, status)
    else this.statuses.delete(status.id)
    try {
      this.emit(status)
    } catch (error) {
      console.warn('无法通知额度刷新状态。', error)
    }
  }

  private request(): void {
    if (!this.canRun() || (!this.settings.enabled && !this.savedAccounts.size)) return
    if (this.running) {
      this.rerun = true
      return
    }
    const running = this.scan()
    this.running = running
    void running.then(
      () => this.finishScan(),
      (error) => {
        console.warn('无法检查账号额度刷新。', error)
        this.finishScan()
      },
    )
  }

  private finishScan(): void {
    this.running = undefined
    if (this.rerun) {
      this.rerun = false
      this.request()
    }
  }

  private async refreshSaved(): Promise<void> {
    while (this.canRun() && this.savedAccounts.size) {
      const [id, saved] = this.savedAccounts.entries().next().value!
      await this.refresh({ id, product: saved.product })
      if (this.savedAccounts.get(id) === saved) this.savedAccounts.delete(id)
    }
  }

  private async refresh(account: Pick<AccountProfile, 'id' | 'product'>): Promise<void> {
    const status = { id: account.id, product: account.product, refreshing: true }
    const attemptVersion = this.attemptVersions.get(account.id)
    let covered: { product: AccountProduct } | undefined
    const automatic = {
      allowed: () => {
        const saved = this.savedAccounts.get(account.id)
        if (saved) covered = saved
        return this.canRun() && (!!saved || this.settings.enabled)
      },
      due: (
        latest: Pick<AccountProfile, 'usageUpdatedAt' | 'usagePrimary' | 'usageSecondary'>,
        active: boolean,
      ) => {
        const saved = this.savedAccounts.get(account.id)
        if (saved) covered = saved
        return !!saved || this.due(account.id, latest, active)
      },
    }
    this.setStatus(status)
    try {
      let refreshed = await this.accounts.refreshAutomatically(account.id, automatic)
      // A joined periodic request may have been skipped before the saved account was queued.
      if (!refreshed && !covered && this.savedAccounts.has(account.id) && this.canRun())
        refreshed = await this.accounts.refreshAutomatically(account.id, automatic)
      if (refreshed && !covered) covered = this.savedAccounts.get(account.id)
      this.setStatus({ ...status, refreshing: false })
    } catch (error) {
      covered ??= this.savedAccounts.get(account.id)
      if (this.attemptVersions.get(account.id) === attemptVersion) {
        try {
          await this.recordAttempt(account.id)
        } catch {
          // The original error is more useful; the in-memory attempt still limits retries.
        }
      }
      this.setStatus({
        ...status,
        refreshing: false,
        error: error instanceof Error ? error.message : '自动刷新额度失败。',
      })
    } finally {
      if (covered && this.savedAccounts.get(account.id) === covered)
        this.savedAccounts.delete(account.id)
    }
  }

  private async scan(): Promise<void> {
    await this.refreshSaved()
    for (const product of ['codex', 'pi', 'grok'] satisfies AccountProduct[]) {
      if (!this.allowed()) return
      let profiles
      try {
        profiles = (await this.accounts.list(product)).profiles
      } catch (error) {
        console.warn(`无法检查 ${product} 账号额度。`, error)
        continue
      }
      for (const account of profiles) {
        if (this.savedAccounts.size) await this.refreshSaved()
        if (!this.allowed()) return
        if (
          !supportsAutomaticUsageRefresh(account) ||
          account.needsReauthorization ||
          account.switchUnavailable ||
          !this.due(account.id, account, account.isActive)
        )
          continue
        await this.refresh(account)
      }
    }
  }
}
