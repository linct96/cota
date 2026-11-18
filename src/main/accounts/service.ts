import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  OPENAI_API_URL,
  accountIdSchema,
  accountInputSchema,
  accountProductSchema,
  renameAccountSchema,
  supportsAutomaticUsageRefresh,
  switchAccountSchema,
} from '../../shared/accounts'
import type {
  AccountOAuthProgress,
  AccountProduct,
  AccountProfile,
  AccountStatus,
  AccountSwitchResult,
} from '../../shared/accounts'
import { AccountStore } from './store'
import type { StoredAccount } from './store'
import { AccountCredentials } from './credentials'
import { AccountRefresh } from './account-refresh'
import type { AutomaticRefresh } from './account-refresh'
import {
  GROK_AUTH_KEY,
  fingerprint,
  normalizeCredential,
  readPiCredentials,
  relayCredential,
  unwrapCredential,
  unwrapPiAuth,
} from './credential-data'
import type { CredentialDetails } from './credential-data'
import { credentialsDiffer, matches, mergeCurrent, refreshTokenKey } from './credential-matching'
import { object, parseObject } from './files'
import { AccountOAuth } from './oauth'
import { refreshCredential, refreshPastedCodex, requiresReauthorization } from './network'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法读取当前认证状态。'

type RefreshTask = { manual: boolean; promise: Promise<boolean> }

export class AccountService {
  private readonly store: AccountStore
  private readonly credentials: AccountCredentials
  private readonly oauth: AccountOAuth
  private readonly refreshExecution: AccountRefresh
  private queue: Promise<unknown> = Promise.resolve()
  private credentialCommits = new Map<AccountProduct, Promise<void>>()
  private credentialVersions = new Map<AccountProduct, number>()
  private snapshotReads = new Set<Promise<AccountStatus>>()
  private backgroundRefreshes = new Set<Promise<unknown>>()
  private refreshTasks = new Map<string, RefreshTask>()
  private clearRefreshError?: (id: string) => void
  private refreshSavedAccounts?: (product: AccountProduct, ids: string[]) => void
  private closing = false

  constructor(providersPath: string, emitOAuth: (progress: AccountOAuthProgress) => void) {
    this.store = new AccountStore(providersPath)
    this.credentials = new AccountCredentials(
      homedir(),
      () => process.env.CODEX_HOME || join(homedir(), '.codex'),
    )
    this.refreshExecution = new AccountRefresh(this.store, this.credentials, {
      run: (action) => this.run(action),
      enqueue: (action) => this.enqueue(action),
      commitCredential: (product, action) => this.commitCredential(product, action),
      advanceCredentialVersion: (product) => this.advanceCredentialVersion(product),
    })
    this.oauth = new AccountOAuth(
      (product, auth, alias) =>
        this.run(() => {
          const account = this.upsert(product, normalizeCredential(product, auth), alias)
          this.clearRefreshError?.(account.id)
          this.notifySavedAccounts(product, [account])
        }),
      emitOAuth,
    )
  }

  private run<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('账号服务正在关闭。'))
    return this.enqueue(action)
  }

  private enqueue<T>(action: () => T | Promise<T>): Promise<T> {
    const pending = this.queue.then(action)
    this.queue = pending.catch(() => {})
    return pending
  }

  private notifySavedAccounts(product: AccountProduct, accounts: StoredAccount[]): void {
    const ids = [...new Set(accounts.filter(supportsAutomaticUsageRefresh).map(({ id }) => id))]
    if (!ids.length) return
    try {
      this.refreshSavedAccounts?.(product, ids)
    } catch {
      console.warn('无法安排账号额度刷新。')
    }
  }

  private advanceCredentialVersion(product: AccountProduct): void {
    this.credentialVersions.set(product, (this.credentialVersions.get(product) ?? 0) + 1)
  }

  // Readers retry across credential commits without delaying rotated-token persistence.
  private commitCredential(product: AccountProduct, action: () => Promise<void>): Promise<void> {
    this.advanceCredentialVersion(product)
    const previous = this.credentialCommits.get(product) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    const settled = pending.then(
      () => {
        this.advanceCredentialVersion(product)
        if (this.credentialCommits.get(product) === settled) this.credentialCommits.delete(product)
      },
      () => {
        this.advanceCredentialVersion(product)
        if (this.credentialCommits.get(product) === settled) this.credentialCommits.delete(product)
      },
    )
    this.credentialCommits.set(product, settled)
    return pending
  }

  private upsert(
    product: AccountProduct,
    details: CredentialDetails,
    alias: string,
  ): StoredAccount {
    const accounts = this.store.list()
    const existing = accounts.find(
      (account) => account.product === product && matches(account, details),
    )
    if (
      existing &&
      product === 'claude' &&
      unwrapCredential(details.auth).auth.source === 'settings_import'
    )
      details = normalizeCredential(product, mergeCurrent(existing, details).auth)
    const { identity: _identity, name, ...credential } = details
    const account: StoredAccount = {
      id: existing?.id || randomUUID(),
      product,
      ...credential,
      alias:
        alias.trim() ||
        name ||
        details.email ||
        (details.apiBaseUrl
          ? new URL(details.apiBaseUrl).hostname
          : `账号 ${accounts.filter((entry) => entry.product === product).length + 1}`),
      usagePrimary: existing?.usagePrimary ?? null,
      usageSecondary: existing?.usageSecondary ?? null,
      usageUpdatedAt: existing?.usageUpdatedAt ?? null,
      updatedAt: Date.now(),
      lastUsedAt: existing?.lastUsedAt ?? null,
      needsReauthorization: false,
      sortOrder: existing?.sortOrder ?? accounts.length,
    }
    this.advanceCredentialVersion(product)
    this.store.save(account)
    return account
  }

  list(productInput: unknown): Promise<AccountStatus> {
    const product = accountProductSchema.parse(productInput)
    if (this.closing) return Promise.reject(new Error('账号服务正在关闭。'))
    const pending = this.readSnapshot(product)
    this.snapshotReads.add(pending)
    void pending.then(
      () => this.snapshotReads.delete(pending),
      () => this.snapshotReads.delete(pending),
    )
    return pending
  }

  private async readSnapshot(product: AccountProduct): Promise<AccountStatus> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const commit = this.credentialCommits.get(product)
      if (commit) await commit
      const version = this.credentialVersions.get(product) ?? 0
      let beforeRevision: string | undefined
      try {
        beforeRevision = await this.credentials.revision(product)
      } catch {
        // An unreadable revision cannot authorize overwriting the current login.
      }
      let current: CredentialDetails[] = []
      let authMessage = ''
      try {
        current = await this.credentials.current(product)
      } catch (error) {
        authMessage = errorMessage(error)
      }
      let authRevision: string | undefined
      try {
        const afterRevision = await this.credentials.revision(product)
        if (beforeRevision && beforeRevision !== afterRevision) continue
        if (beforeRevision) authRevision = afterRevision
      } catch {
        // Listing remains available, but forced switching requires a verifiable revision.
      }
      if (
        version !== (this.credentialVersions.get(product) ?? 0) ||
        this.credentialCommits.has(product)
      )
        continue
      const accounts = this.store.list().filter((entry) => entry.product === product)
      const authState = authMessage
        ? 'unmanaged'
        : !current.length
          ? 'missing'
          : current.every((credential) => accounts.some((account) => matches(account, credential)))
            ? 'managed'
            : 'unmanaged'
      const profiles: AccountProfile[] = accounts.map(
        ({ auth, sortOrder: _order, ...account }) => ({
          ...account,
          apiBaseUrl:
            account.apiBaseUrl ??
            (product === 'pi' && account.accountType === 'relay' && account.providerKey === 'openai'
              ? OPENAI_API_URL
              : null),
          isActive: current.some((credential) =>
            matches({ ...account, auth, sortOrder: _order }, credential),
          ),
        }),
      )
      return {
        profiles,
        authPath: this.credentials.authPath(product),
        authState,
        authRevision,
        authMessage:
          authMessage ||
          (authState === 'managed'
            ? '当前登录已纳入 Cota 管理。'
            : authState === 'missing'
              ? '尚未检测到当前产品的登录凭据。'
              : '检测到尚未保存的登录，请先导入当前账号。'),
      }
    }
    throw new Error('认证文件持续变化，请刷新后重试。')
  }

  add(input: unknown): Promise<void> {
    const value = accountInputSchema.parse(input)
    return this.run(async () => {
      if (value.mode === 'api_key' || value.mode === 'provider') {
        this.upsert(
          'pi',
          normalizeCredential(
            'pi',
            {
              [value.mode === 'api_key' ? 'openai' : value.providerKey!]: {
                type: 'api_key',
                key: value.apiKey.trim(),
              },
              $cota: {
                providerConfig: {
                  baseUrl: value.apiBaseUrl.trim() || OPENAI_API_URL,
                  ...(value.mode === 'provider'
                    ? {
                        api: value.api,
                        models: [
                          ...new Set(
                            value
                              .modelIds!.trim()
                              .split(/[,\n]/)
                              .map((id) => id.trim()),
                          ),
                        ].map((id) => ({ id })),
                      }
                    : {}),
                },
              },
            },
            value.mode === 'api_key' ? 'openai' : value.providerKey,
          ),
          value.alias,
        )
        return
      }
      if (value.mode === 'relay') {
        const account = this.upsert(
          value.product,
          relayCredential(value.product, value.apiKey.trim(), value.apiBaseUrl.trim()),
          value.alias,
        )
        this.clearRefreshError?.(account.id)
        return
      }
      let auth: unknown
      if (value.product === 'codex' && !value.credential.trim().startsWith('{'))
        auth = await refreshPastedCodex(value.credential)
      else auth = parseObject(value.credential)
      if (value.product === 'grok' && object(auth)[GROK_AUTH_KEY])
        auth = object(auth)[GROK_AUTH_KEY]
      if (value.product === 'pi') {
        const unwrapped = unwrapCredential(auth).auth
        const root = unwrapped.models ? object(unwrapped.auth) : unwrapped
        const models = unwrapped.models ? object(unwrapped.models) : unwrapped
        const entries = unwrapped.$cota
          ? [normalizeCredential('pi', auth)]
          : readPiCredentials(root, models)
        if (!entries.length) entries.push(normalizeCredential('pi', auth))
        const saved: StoredAccount[] = []
        this.store.transaction(() => {
          for (const entry of entries) saved.push(this.upsert('pi', entry, value.alias))
        })
        this.notifySavedAccounts('pi', saved)
        return
      }
      const providerKey = ''
      const account = this.upsert(
        value.product,
        normalizeCredential(value.product, auth, providerKey),
        value.alias,
      )
      this.clearRefreshError?.(account.id)
      this.notifySavedAccounts(value.product, [account])
    })
  }

  importCurrent(productInput: unknown): Promise<number> {
    const product = accountProductSchema.parse(productInput)
    return this.run(async () => {
      const current = await this.credentials.current(product)
      if (!current.length) throw new Error('未检测到可导入的账号，请先在对应 CLI 中登录。')
      const saved: StoredAccount[] = []
      this.store.transaction(() => {
        for (const credential of current) saved.push(this.upsert(product, credential, ''))
      })
      for (const account of saved) this.clearRefreshError?.(account.id)
      this.notifySavedAccounts(product, saved)
      return current.length
    })
  }

  switch(input: unknown): Promise<AccountSwitchResult> {
    const { id, force, authRevision } = switchAccountSchema.parse(input)
    return this.run(async () => {
      let account = this.store.get(id)
      let restartRequired = false
      const switchAccount = async (piLock?: () => void) => {
        if (account.switchUnavailable) throw new Error(account.switchUnavailable)
        if (piLock) {
          normalizeCredential('pi', account.auth, account.providerKey)
          await this.credentials.assertPiReplaceable(account.providerKey)
        }
        const piRevision = piLock ? await this.credentials.revision('pi') : undefined
        if (force) {
          if (!authRevision) throw new Error('无法验证当前 CLI 登录，请刷新并重新确认切换。')
          let currentRevision: string
          try {
            currentRevision = await this.credentials.revision(account.product)
          } catch {
            throw new Error('无法验证当前 CLI 登录，请刷新并重新确认切换。')
          }
          if (currentRevision !== authRevision)
            throw new Error('当前 CLI 登录已变化，请刷新并重新确认切换。')
        }
        let current: CredentialDetails[] = []
        let unreadable = false
        try {
          current = await this.credentials.current(account.product)
        } catch {
          unreadable = true
        }
        const saved = this.store.list().filter((entry) => entry.product === account.product)
        const unmanaged =
          unreadable ||
          current.some((credential) => !saved.some((entry) => matches(entry, credential)))
        if (unmanaged && piLock)
          throw new Error('当前 Pi 登录尚未保存或无法识别，请先导入当前登录再切换。')
        if (unmanaged && !force) throw new Error('当前登录尚未保存，请先导入，或确认覆盖后切换。')
        // Capture tokens renewed by a running CLI before replacing its active login.
        for (const credential of current) {
          const outgoing = saved.find((entry) => matches(entry, credential))
          if (outgoing?.needsReauthorization && credentialsDiffer(outgoing, credential))
            throw new Error('当前 CLI 凭据与已保存凭据不一致，请先导入当前登录或重新授权。')
          if (outgoing && outgoing.auth !== credential.auth) {
            const updated = mergeCurrent(outgoing, credential)
            this.advanceCredentialVersion(outgoing.product)
            this.store.save(updated)
            if (outgoing.id === account.id) account = updated
          }
        }
        // pi-lens-ignore: no-sort-without-comparator -- String fingerprints need canonical lexicographic order.
        const before = current
          .map((entry) => fingerprint(entry.auth))
          .sort()
          .join(':')
        if (piLock && account.providerKey === 'openai') {
          const token = refreshTokenKey(account)
          if (
            token &&
            saved.some((other) => {
              if (other.id === id) return false
              try {
                return refreshTokenKey(other) === token
              } catch {
                return false
              }
            })
          )
            throw new Error('多个账号共用刷新令牌，请分别重新授权后再切换。')
        }
        const active = current.some((credential) => matches(account, credential))
        const beforeRefresh = account.auth
        const previousSIWC =
          piLock && account.providerKey === 'openai' && account.accountType === 'oauth'
            ? normalizeCredential('pi', beforeRefresh, 'openai')
            : undefined
        try {
          if (account.accountType === 'oauth')
            account = await refreshCredential(account, account.needsReauthorization)
        } catch (error) {
          if (requiresReauthorization(error))
            this.store.save({ ...account, needsReauthorization: true })
          throw error
        }
        await this.commitCredential(account.product, async () => {
          try {
            this.store.save(account) // Preserve rotated refresh tokens even if applying CLI files fails.
          } catch (error) {
            if (!piLock || account.auth === beforeRefresh) throw error
            const latest = this.store.get(id)
            if (
              latest.product !== account.product ||
              latest.providerKey !== account.providerKey ||
              JSON.stringify(unwrapCredential(latest.auth)) !==
                JSON.stringify(unwrapCredential(beforeRefresh))
            )
              throw new Error('账号认证在续期期间发生变化，无法安全保存新凭据，请重新授权。', {
                cause: error,
              })
            account = {
              ...latest,
              auth: account.auth,
              needsReauthorization: account.needsReauthorization,
              updatedAt: Math.max(latest.updatedAt, account.updatedAt),
            }
            this.store.save(account)
          }
          if (previousSIWC) {
            let sameRegistration = false
            try {
              const refreshed = normalizeCredential('pi', account.auth, 'openai')
              sameRegistration =
                refreshed.identity === previousSIWC.identity &&
                (!refreshed.accountId ||
                  !previousSIWC.accountId ||
                  refreshed.accountId === previousSIWC.accountId)
            } catch {
              // Retain rotated credentials even if their returned scope is no longer usable.
            }
            if (!sameRegistration) {
              this.store.save({ ...account, needsReauthorization: true })
              throw new Error('续期后的 SIWC 授权不匹配；新凭据已保存，请在 Pi 中重新登录。')
            }
          }
          let after: CredentialDetails[] = []
          let afterUnreadable = false
          try {
            after = await this.credentials.current(account.product)
          } catch {
            afterUnreadable = true
          }
          if (
            unreadable !== afterUnreadable ||
            before !==
              // pi-lens-ignore: no-sort-without-comparator -- String fingerprints need canonical lexicographic order.
              after
                .map((entry) => fingerprint(entry.auth))
                .sort()
                .join(':')
          )
            throw new Error('授权期间检测到 CLI 登录变更，请刷新后重新确认切换。')
          const applied = await this.credentials.apply(
            account,
            piRevision ?? (force ? authRevision : undefined),
            piLock,
          )
          restartRequired = applied.restartRequired
          try {
            this.store.save({ ...account, lastUsedAt: Date.now(), updatedAt: Date.now() })
          } catch (error) {
            if (piLock && active && account.auth !== beforeRefresh)
              throw new Error('登录令牌已更新，但无法保存账号状态，请刷新后重试。', {
                cause: error,
              })
            await applied.restore()
            throw error
          }
        })
        this.clearRefreshError?.(account.id)
      }
      if (account.product === 'pi') await this.credentials.withPiLock(switchAccount)
      else await switchAccount()
      return { restartRequired }
    })
  }

  deactivate(idInput: unknown): Promise<void> {
    const id = accountIdSchema.parse(idInput)
    return this.run(async () => {
      let account = this.store.get(id)
      if (account.product !== 'pi') throw new Error('仅支持取消激活 Pi 账号。')
      await this.credentials.withPiLock(async (assertLocked) => {
        await this.credentials.assertPiReplaceable(account.providerKey)
        const revision = await this.credentials.revision('pi')
        const current = (await this.credentials.current('pi')).find((entry) =>
          matches(account, entry),
        )
        if ((await this.credentials.revision('pi')) !== revision || !current)
          throw new Error('当前 Pi 登录已变化，请刷新后重试。')
        const latest = this.store.get(id)
        if (
          latest.product !== account.product ||
          latest.providerKey !== account.providerKey ||
          latest.auth !== account.auth ||
          latest.needsReauthorization !== account.needsReauthorization
        )
          throw new Error('账号凭据已变化，请刷新后重试。')
        account = latest
        if (credentialsDiffer(account, current)) {
          const savedExpiry = unwrapPiAuth(unwrapCredential(account.auth).auth, account.providerKey)
            .entry.expires
          const currentExpiry = unwrapPiAuth(
            unwrapCredential(current.auth).auth,
            account.providerKey,
          ).entry.expires
          const refreshChanged =
            refreshTokenKey(account) !== refreshTokenKey({ ...account, auth: current.auth })
          // shortcut: expiry estimates recency across unsynchronized writers; use a shared refresh lock for strict ordering.
          if (
            account.needsReauthorization ||
            (refreshChanged &&
              !(
                typeof currentExpiry === 'number' &&
                typeof savedExpiry === 'number' &&
                currentExpiry > savedExpiry
              ))
          )
            throw new Error('无法确认最新的 Pi 令牌，请先确认账号凭据或重新授权。')
        }
        await this.commitCredential('pi', async () => {
          if (
            JSON.stringify(unwrapCredential(account.auth)) !==
            JSON.stringify(unwrapCredential(current.auth))
          )
            this.store.save(mergeCurrent(account, current))
          await this.credentials.deactivatePi(account.providerKey, revision, assertLocked)
        })
      })
    })
  }

  rename(input: unknown): Promise<void> {
    const { id, alias } = renameAccountSchema.parse(input)
    return this.run(() => this.store.save({ ...this.store.get(id), alias, updatedAt: Date.now() }))
  }

  remove(idInput: unknown): Promise<void> {
    const id = accountIdSchema.parse(idInput)
    return this.run(() => {
      this.store.get(id)
      this.store.remove(id)
      this.clearRefreshError?.(id)
    })
  }

  reorder(productInput: unknown, idsInput: unknown): Promise<void> {
    const product = accountProductSchema.parse(productInput)
    const ids = z.array(accountIdSchema).max(10000).parse(idsInput)
    return this.run(() => {
      const accounts = this.store.list().filter((entry) => entry.product === product)
      if (
        ids.length !== accounts.length ||
        new Set(ids).size !== ids.length ||
        accounts.some((account) => !ids.includes(account.id))
      )
        throw new Error('账号列表已变化，请刷新后重试。')
      this.store.transaction(() => {
        for (const account of accounts)
          this.store.save({ ...account, sortOrder: ids.indexOf(account.id) })
      })
    })
  }

  setRefreshAttemptRecorder(recorder: (id: string) => Promise<() => Promise<void>>): void {
    this.refreshExecution.setAttemptRecorder(recorder)
  }

  setRefreshErrorClearer(clearer: (id: string) => void): void {
    this.clearRefreshError = clearer
  }

  setSavedAccountRefreshRequester(
    requester: (product: AccountProduct, ids: string[]) => void,
  ): void {
    this.refreshSavedAccounts = requester
  }

  refresh(idInput: unknown): Promise<void> {
    const id = accountIdSchema.parse(idInput)
    return this.requestRefresh(id).then(async (refreshed) => {
      if (!refreshed) await this.refresh(id)
      else this.clearRefreshError?.(id)
    })
  }

  refreshAutomatically(id: string, automatic: AutomaticRefresh): Promise<boolean> {
    return this.requestRefresh(accountIdSchema.parse(id), automatic)
  }

  private requestRefresh(id: string, automatic?: AutomaticRefresh): Promise<boolean> {
    const existing = this.refreshTasks.get(id)
    if (existing) {
      if (!automatic) existing.manual = true
      return existing.promise
    }
    const task: RefreshTask = { manual: !automatic, promise: Promise.resolve(false) }
    if (automatic) {
      const pending = this.refreshExecution.runBackgroundRefresh(id, automatic, task)
      this.backgroundRefreshes.add(pending)
      void pending.then(
        () => this.backgroundRefreshes.delete(pending),
        () => this.backgroundRefreshes.delete(pending),
      )
      task.promise = pending
    } else {
      task.promise = this.run(() => this.refreshExecution.runManualRefresh(id))
    }
    this.refreshTasks.set(id, task)
    void task.promise.then(
      () => this.refreshTasks.delete(id),
      () => this.refreshTasks.delete(id),
    )
    return task.promise
  }

  startOAuth(product: unknown, alias: unknown): Promise<void> {
    if (this.closing) return Promise.reject(new Error('账号服务正在关闭。'))
    const validated = renameAccountSchema.shape.alias.optional().parse(alias || undefined) || ''
    return this.oauth.start(accountProductSchema.parse(product), validated)
  }
  cancelOAuth(): void {
    this.oauth.cancel()
  }
  async close(): Promise<void> {
    this.closing = true
    this.oauth.dispose()
    await Promise.allSettled(this.backgroundRefreshes)
    await this.queue
    await Promise.allSettled(this.snapshotReads)
    this.store.close()
  }
}
