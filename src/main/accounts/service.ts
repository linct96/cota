import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
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
} from '../../shared/accounts'
import { AccountStore } from './store'
import type { StoredAccount } from './store'
import {
  AccountCredentials,
  GROK_AUTH_KEY,
  credentialIdentity,
  fingerprint,
  normalizeCredential,
  relayCredential,
  unwrapCredential,
  unwrapGrokAuth,
  unwrapPiAuth,
  wrapCredential,
} from './credentials'
import type { CredentialDetails } from './credentials'
import { json, object, parseObject, text } from './files'
import { AccountOAuth } from './oauth'
import {
  AccountNetworkError,
  AccountReauthorizationError,
  refreshAccountUsage,
  refreshCredential,
  refreshPastedCodex,
} from './network'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法读取当前认证状态。'
const requiresReauthorization = (error: unknown) =>
  error instanceof AccountReauthorizationError ||
  (error instanceof AccountNetworkError && error.reauthorizationRequired)

function accessFingerprint(rawAuth: string): string {
  const { auth } = unwrapCredential(rawAuth)
  const env = object(auth.env)
  const claudeAccess =
    text(env.CLAUDE_CODE_OAUTH_TOKEN) ||
    text(env.ANTHROPIC_AUTH_TOKEN) ||
    text(env.ANTHROPIC_API_KEY)
  const piAccess =
    text(object(auth['openai-codex']).access) || text(object(auth.xai).access) || text(auth.access)
  const grokAccess = text(unwrapGrokAuth(auth).entry.key)
  return fingerprint(
    text(object(auth.tokens).access_token) ||
      text(auth.OPENAI_API_KEY) ||
      claudeAccess ||
      piAccess ||
      grokAccess,
  )
}

function storedIdentity(account: StoredAccount): string | undefined {
  try {
    return credentialIdentity(account)
  } catch {
    // Incompatible imported credentials must remain available for rename and removal.
    return undefined
  }
}

function matches(account: StoredAccount, current: CredentialDetails): boolean {
  if (account.accountType !== current.accountType || account.providerKey !== current.providerKey)
    return false
  const identity = storedIdentity(account)
  if (identity === undefined) return false
  return (
    identity === current.identity ||
    (account.accountType === 'oauth' &&
      accessFingerprint(account.auth) === accessFingerprint(current.auth))
  )
}

function mergeCurrent(account: StoredAccount, credential: CredentialDetails): StoredAccount {
  const original = unwrapCredential(account.auth)
  const incoming = unwrapCredential(credential.auth)
  if (account.product === 'pi') {
    const key = account.providerKey || credential.providerKey
    const mergedEntry = {
      ...unwrapPiAuth(original.auth, key).entry,
      ...unwrapPiAuth(incoming.auth, key).entry,
    }
    return {
      ...account,
      email: credential.email || account.email,
      planType: credential.planType || account.planType,
      auth: wrapCredential('pi', { [key]: mergedEntry }),
      updatedAt: Date.now(),
    }
  }
  if (account.product === 'grok') {
    const origGrok = unwrapGrokAuth(original.auth)
    const nextGrok = unwrapGrokAuth(incoming.auth)
    const entryKey = nextGrok.entryKey || origGrok.entryKey
    return {
      ...account,
      email: credential.email || account.email,
      planType: credential.planType || account.planType,
      auth: wrapCredential('grok', { [entryKey]: { ...origGrok.entry, ...nextGrok.entry } }),
      updatedAt: Date.now(),
    }
  }
  const merged = { ...original.auth, ...incoming.auth }
  if (account.product === 'claude') {
    merged.env = { ...object(original.auth.env), ...object(incoming.auth.env) }
  }
  for (const key of ['refreshToken', 'cliTokenExpiresAt', 'accountId', 'email'])
    if (!incoming.auth[key] && original.auth[key]) merged[key] = original.auth[key]
  const kind = incoming.kind ?? original.kind
  return {
    ...account,
    email: credential.email || account.email,
    planType: credential.planType || account.planType,
    auth: kind ? wrapCredential(kind, merged) : json(merged),
    updatedAt: Date.now(),
  }
}

function refreshTokenKey(account: StoredAccount): string {
  if (account.accountType !== 'oauth' || account.product === 'claude') return ''
  const { auth } = unwrapCredential(account.auth)
  const openai =
    account.product === 'codex' ||
    (account.product === 'pi' && account.providerKey === 'openai-codex')
  const token =
    account.product === 'codex'
      ? text(object(auth.tokens).refresh_token)
      : account.product === 'pi'
        ? text(unwrapPiAuth(auth, account.providerKey).entry.refresh)
        : text(unwrapGrokAuth(auth).entry.refresh_token)
  return token ? `${openai ? 'openai' : 'xai'}:${token}` : ''
}

function credentialsDiffer(account: StoredAccount, current: CredentialDetails): boolean {
  return (
    accessFingerprint(account.auth) !== accessFingerprint(current.auth) ||
    refreshTokenKey(account) !== refreshTokenKey({ ...account, auth: current.auth })
  )
}

type AutomaticRefresh = {
  allowed: () => boolean
  due: (
    account: Pick<StoredAccount, 'usageUpdatedAt' | 'usagePrimary' | 'usageSecondary'>,
    active: boolean,
  ) => boolean
}
type RefreshTask = { manual: boolean; promise: Promise<boolean> }

export class AccountService {
  private readonly store: AccountStore
  private readonly credentials: AccountCredentials
  private readonly oauth: AccountOAuth
  private queue: Promise<unknown> = Promise.resolve()
  private credentialCommits = new Map<AccountProduct, Promise<void>>()
  private credentialVersions = new Map<AccountProduct, number>()
  private snapshotReads = new Set<Promise<AccountStatus>>()
  private refreshTasks = new Map<string, RefreshTask>()
  private recordRefreshAttempt?: (id: string) => Promise<() => Promise<void>>
  private clearRefreshError?: (id: string) => void
  private closing = false

  constructor(providersPath: string, emitOAuth: (progress: AccountOAuthProgress) => void) {
    this.store = new AccountStore(providersPath)
    this.credentials = new AccountCredentials(
      homedir(),
      () => process.env.CODEX_HOME || join(homedir(), '.codex'),
    )
    this.oauth = new AccountOAuth(
      (product, auth, alias) =>
        this.run(() => {
          const account = this.upsert(product, normalizeCredential(product, auth), alias)
          this.clearRefreshError?.(account.id)
        }),
      emitOAuth,
    )
  }

  private run<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('账号服务正在关闭。'))
    const pending = this.queue.then(action)
    this.queue = pending.catch(() => {})
    return pending
  }

  private advanceCredentialVersion(product: AccountProduct): void {
    this.credentialVersions.set(product, (this.credentialVersions.get(product) ?? 0) + 1)
  }

  // Readers retry across credential commits without delaying rotated-token persistence.
  private commitCredential(product: AccountProduct, action: () => Promise<void>): Promise<void> {
    this.advanceCredentialVersion(product)
    const pending = Promise.resolve().then(action)
    const finish = () => {
      this.advanceCredentialVersion(product)
      this.credentialCommits.delete(product)
    }
    this.credentialCommits.set(product, pending.then(finish, finish))
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
      let providerKey = ''
      if (value.product === 'pi') {
        const provider = ['openai-codex', 'xai'].find((key) => object(auth)[key])
        if (provider) {
          providerKey = provider
          auth = object(auth)[provider]
        }
      }
      const account = this.upsert(
        value.product,
        normalizeCredential(value.product, auth, providerKey),
        value.alias,
      )
      this.clearRefreshError?.(account.id)
    })
  }

  importCurrent(productInput: unknown): Promise<number> {
    const product = accountProductSchema.parse(productInput)
    return this.run(async () => {
      const current = await this.credentials.current(product)
      if (!current.length) throw new Error('未检测到可导入的账号，请先在对应 CLI 中登录。')
      const ids: string[] = []
      this.store.transaction(() => {
        for (const credential of current) ids.push(this.upsert(product, credential, '').id)
      })
      for (const id of ids) this.clearRefreshError?.(id)
      return current.length
    })
  }

  switch(input: unknown): Promise<void> {
    const { id, force, authRevision } = switchAccountSchema.parse(input)
    return this.run(async () => {
      let account = this.store.get(id)
      if (account.switchUnavailable) throw new Error(account.switchUnavailable)
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
      try {
        account = await refreshCredential(account, account.needsReauthorization)
      } catch (error) {
        if (requiresReauthorization(error))
          this.store.save({ ...account, needsReauthorization: true })
        throw error
      }
      await this.commitCredential(account.product, async () => {
        this.store.save(account) // Preserve rotated refresh tokens even if applying CLI files fails.
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
        const restore = await this.credentials.apply(account, force ? authRevision : undefined)
        try {
          this.store.save({ ...account, lastUsedAt: Date.now(), updatedAt: Date.now() })
        } catch (error) {
          await restore()
          throw error
        }
      })
      this.clearRefreshError?.(account.id)
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
    this.recordRefreshAttempt = recorder
  }

  setRefreshErrorClearer(clearer: (id: string) => void): void {
    this.clearRefreshError = clearer
  }

  refresh(idInput: unknown): Promise<void> {
    const id = accountIdSchema.parse(idInput)
    return this.requestRefresh(id).then(async (refreshed) => {
      if (!refreshed) await this.refresh(id)
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
    task.promise = this.run(async () => {
      const background = !!automatic && !task.manual
      if (background && !automatic.allowed()) return false
      const found = this.store.list().find((entry) => entry.id === id)
      if (!found) {
        if (background) return false
        throw new Error('账号不存在，请刷新后重试。')
      }
      let account: StoredAccount = found
      if (
        background &&
        (!supportsAutomaticUsageRefresh(account) ||
          account.needsReauthorization ||
          account.switchUnavailable)
      )
        return false
      if (account.switchUnavailable) throw new Error(account.switchUnavailable)
      if (account.accountType === 'relay') throw new Error('API 账号的额度请在对应服务商查看。')
      const prepare = async (piLock?: () => void): Promise<StoredAccount | undefined> => {
        let current: CredentialDetails[] = []
        let revision: string | undefined
        try {
          if (background) revision = await this.credentials.revision(account.product)
          current = await this.credentials.current(account.product)
          if (background && revision !== (await this.credentials.revision(account.product)))
            throw new Error('当前 CLI 登录已变化，请稍后重试。')
        } catch (error) {
          if (background || account.needsReauthorization) throw error
          /* Only update stored credentials if local state is unavailable. */
        }
        const active = current.some((credential) => matches(account, credential))
        if (background && (!automatic.allowed() || !automatic.due(account, active)))
          return undefined
        const activeCredential = current.find((credential) => matches(account, credential))
        if (
          account.needsReauthorization &&
          activeCredential &&
          credentialsDiffer(account, activeCredential)
        )
          throw new Error('当前 CLI 凭据与已保存凭据不一致，请先导入当前登录或重新授权。')
        const merged = activeCredential ? mergeCurrent(account, activeCredential) : account
        if (background) {
          const token = refreshTokenKey(merged)
          if (
            token &&
            this.store.list().some((other) => {
              if (other.id === id) return false
              try {
                return refreshTokenKey(other) === token
              } catch {
                return false
              }
            })
          )
            throw new Error('多个账号共用刷新令牌，请分别重新授权后再自动刷新。')
        }
        let undoAttempt: (() => Promise<void>) | undefined
        try {
          undoAttempt = await this.recordRefreshAttempt?.(id)
        } catch (error) {
          if (background) throw error
          console.warn('无法记录额度刷新时间。', error)
        }
        const latestRevision = background
          ? await this.credentials.revision(account.product)
          : undefined
        if (background && !automatic.allowed()) {
          await undoAttempt?.()
          return undefined
        }
        if (background && revision !== latestRevision)
          throw new Error('当前 CLI 登录已变化，请稍后重试。')
        if (
          background &&
          JSON.stringify(this.store.list().find((entry) => entry.id === id)) !==
            JSON.stringify(account)
        )
          throw new Error('账号配置已变化，请稍后重试。')
        if (activeCredential) {
          account = merged
          this.advanceCredentialVersion(account.product)
          this.store.save(account)
        }
        let fresh: StoredAccount
        try {
          fresh = await refreshCredential(account, account.product === 'claude')
        } catch (error) {
          if (requiresReauthorization(error))
            this.store.save({ ...account, needsReauthorization: true })
          throw error
        }
        await this.commitCredential(account.product, async () => {
          try {
            this.store.save(fresh)
          } catch (error) {
            let latest: StoredAccount
            try {
              latest = this.store.get(id)
            } catch {
              throw error
            }
            if (
              latest.product !== account.product ||
              latest.accountType !== account.accountType ||
              latest.providerKey !== account.providerKey ||
              latest.accountId !== account.accountId ||
              (latest.auth !== account.auth && latest.auth !== fresh.auth)
            )
              throw new Error('账号认证在续期期间发生变化，无法安全保存新凭据，请重新授权。', {
                cause: error,
              })
            fresh = {
              ...latest,
              auth: fresh.auth,
              needsReauthorization: fresh.needsReauthorization,
              updatedAt: Math.max(latest.updatedAt, fresh.updatedAt),
            }
            this.store.save(fresh)
          }
          if (fresh.auth !== account.auth) {
            try {
              if (active) {
                const latest = await this.credentials.current(account.product)
                if (
                  // pi-lens-ignore: no-sort-without-comparator -- String fingerprints need canonical lexicographic order.
                  latest
                    .map((entry) => fingerprint(entry.auth))
                    .sort()
                    .join(':') !==
                  // pi-lens-ignore: no-sort-without-comparator -- String fingerprints need canonical lexicographic order.
                  current
                    .map((entry) => fingerprint(entry.auth))
                    .sort()
                    .join(':')
                )
                  throw new Error('当前 CLI 登录已变化，请刷新后重试。')
                if (background) await this.credentials.updateCurrent(fresh, revision, piLock)
                else await this.credentials.apply(fresh)
              }
              piLock?.()
            } catch (error) {
              this.store.save({ ...fresh, needsReauthorization: true })
              throw new Error(
                `${errorMessage(error)} 新凭据已保存，请重新授权或确认后导入当前登录。`,
                { cause: error },
              )
            }
          }
        })
        return fresh
      }
      const fresh =
        background && account.product === 'pi'
          ? await this.credentials.withPiLock(prepare)
          : await prepare()
      if (!fresh) return false
      try {
        this.store.save({ ...(await refreshAccountUsage(fresh)), needsReauthorization: false })
      } catch (error) {
        if (requiresReauthorization(error))
          this.store.save({ ...fresh, needsReauthorization: true })
        throw error
      }
      return true
    })
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
    await this.queue
    await Promise.allSettled(this.snapshotReads)
    this.store.close()
  }
}
