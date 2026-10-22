import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  accountIdSchema,
  accountInputSchema,
  accountProductSchema,
  renameAccountSchema,
  switchAccountSchema,
  type AccountOAuthProgress,
  type AccountProduct,
  type AccountProfile,
  type AccountStatus,
} from '../../shared/accounts'
import { AccountStore, cortanaDatabase, readCortanaAccounts, type StoredAccount } from './store'
import {
  AccountCredentials,
  credentialIdentity,
  fingerprint,
  GROK_AUTH_KEY,
  normalizeCredential,
  relayCredential,
  type CredentialDetails,
} from './credentials'
import { object, parseObject, text } from './files'
import { AccountOAuth } from './oauth'
import {
  AccountNetworkError,
  refreshAccountUsage,
  refreshCredential,
  refreshPastedCodex,
} from './network'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法读取当前认证状态。'

function accessFingerprint(auth: string): string {
  const value = parseObject(auth)
  return fingerprint(
    text(object(value.tokens).access_token) ||
      text(value.cliToken) ||
      text(value.access) ||
      text(value.key),
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
  const original = parseObject(account.auth)
  const incoming = parseObject(credential.auth)
  const merged = { ...original, ...incoming }
  for (const key of ['refreshToken', 'cliTokenExpiresAt', 'accountId', 'email'])
    if (!incoming[key] && original[key]) merged[key] = original[key]
  return { ...account, auth: JSON.stringify(merged), updatedAt: Date.now() }
}

export class AccountService {
  private readonly store: AccountStore
  private readonly credentials: AccountCredentials
  private readonly oauth: AccountOAuth
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false

  constructor(databasePath: string, emitOAuth: (progress: AccountOAuthProgress) => void) {
    this.store = new AccountStore(databasePath)
    this.credentials = new AccountCredentials(
      homedir(),
      () => process.env.CODEX_HOME || join(homedir(), '.codex'),
    )
    this.oauth = new AccountOAuth(
      (product, auth, alias) =>
        this.run(() => {
          this.upsert(product, normalizeCredential(product, auth), alias)
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

  private upsert(
    product: AccountProduct,
    details: CredentialDetails,
    alias: string,
  ): StoredAccount {
    const accounts = this.store.list()
    const existing = accounts.find(
      (account) => account.product === product && matches(account, details),
    )
    if (existing && product === 'claude' && parseObject(details.auth).source === 'settings_import')
      details = normalizeCredential(product, parseObject(mergeCurrent(existing, details).auth))
    const { identity: _identity, ...credential } = details
    const account: StoredAccount = {
      id: existing?.id || randomUUID(),
      product,
      ...credential,
      alias:
        alias.trim() ||
        existing?.alias ||
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
    this.store.save(account)
    return account
  }

  list(productInput: unknown): Promise<AccountStatus> {
    const product = accountProductSchema.parse(productInput)
    return this.run(async () => {
      const accounts = this.store.list().filter((entry) => entry.product === product)
      let current: CredentialDetails[] = []
      let authMessage = ''
      try {
        current = await this.credentials.current(product)
      } catch (error) {
        authMessage = errorMessage(error)
      }
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
        authMessage:
          authMessage ||
          (authState === 'managed'
            ? '当前登录已纳入 Cota 管理。'
            : authState === 'missing'
              ? '尚未检测到当前产品的登录凭据。'
              : '检测到尚未保存的登录，请先导入当前账号。'),
        cortanaAvailable: await access(cortanaDatabase()).then(
          () => true,
          () => false,
        ),
      }
    })
  }

  add(input: unknown): Promise<void> {
    const value = accountInputSchema.parse(input)
    return this.run(async () => {
      if (value.mode === 'relay') {
        this.upsert(
          value.product,
          relayCredential(value.product, value.apiKey.trim(), value.apiBaseUrl.trim()),
          value.alias,
        )
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
      this.upsert(value.product, normalizeCredential(value.product, auth, providerKey), value.alias)
    })
  }

  importCurrent(productInput: unknown): Promise<number> {
    const product = accountProductSchema.parse(productInput)
    return this.run(async () => {
      const current = await this.credentials.current(product)
      if (!current.length) throw new Error('未检测到可导入的账号，请先在对应 CLI 中登录。')
      this.store.transaction(() => {
        for (const credential of current) this.upsert(product, credential, '')
      })
      return current.length
    })
  }

  importCortana(): Promise<number> {
    return this.run(() => {
      const source = readCortanaAccounts(cortanaDatabase())
      const existing = this.store.list()
      const imported = source.filter((candidate) => {
        const identity = storedIdentity(candidate)
        return !existing.some(
          (entry) =>
            entry.id === `cortana:${candidate.id}` ||
            (identity !== undefined &&
              entry.product === candidate.product &&
              entry.accountType === candidate.accountType &&
              entry.providerKey === candidate.providerKey &&
              storedIdentity(entry) === identity),
        )
      })
      this.store.transaction(() => {
        for (const [index, account] of imported.entries())
          this.store.save({
            ...account,
            id: `cortana:${account.id}`,
            sortOrder: existing.length + index,
          })
      })
      return imported.length
    })
  }

  switch(input: unknown): Promise<void> {
    const { id, force } = switchAccountSchema.parse(input)
    return this.run(async () => {
      let account = this.store.get(id)
      if (account.switchUnavailable) throw new Error(account.switchUnavailable)
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
        if (outgoing && outgoing.auth !== credential.auth) {
          const updated = mergeCurrent(outgoing, credential)
          this.store.save(updated)
          if (outgoing.id === account.id) account = updated
        }
      }
      const before = current
        .map((entry) => fingerprint(entry.auth))
        .sort()
        .join(':')
      try {
        account = await refreshCredential(account, account.needsReauthorization)
        this.store.save(account) // Preserve rotated refresh tokens even if applying CLI files fails.
      } catch (error) {
        if (error instanceof AccountNetworkError && error.status === 401)
          this.store.save({ ...account, needsReauthorization: true })
        throw error
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
          after
            .map((entry) => fingerprint(entry.auth))
            .sort()
            .join(':')
      )
        throw new Error('授权期间检测到 CLI 登录变更，请刷新后重新确认切换。')
      const restore = await this.credentials.apply(account)
      try {
        this.store.save({ ...account, lastUsedAt: Date.now(), updatedAt: Date.now() })
      } catch (error) {
        await restore()
        throw error
      }
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

  refresh(idInput: unknown): Promise<void> {
    const id = accountIdSchema.parse(idInput)
    return this.run(async () => {
      let account = this.store.get(id)
      if (account.switchUnavailable) throw new Error(account.switchUnavailable)
      if (account.accountType === 'relay') throw new Error('API 账号的额度请在对应服务商查看。')
      let current: CredentialDetails[] = []
      try {
        current = await this.credentials.current(account.product)
      } catch {
        /* Only update stored credentials if local state is unavailable. */
      }
      const active = current.some((credential) => matches(account, credential))
      const activeCredential = current.find((credential) => matches(account, credential))
      if (activeCredential) {
        account = mergeCurrent(account, activeCredential)
        this.store.save(account)
      }
      let fresh: StoredAccount
      try {
        fresh = await refreshCredential(account, account.product === 'claude')
      } catch (error) {
        if (error instanceof AccountNetworkError && error.status === 401)
          this.store.save({ ...account, needsReauthorization: true })
        throw error
      }
      this.store.save(fresh)
      if (active && fresh.auth !== account.auth) {
        const latest = await this.credentials.current(account.product)
        if (
          latest
            .map((entry) => fingerprint(entry.auth))
            .sort()
            .join(':') ===
          current
            .map((entry) => fingerprint(entry.auth))
            .sort()
            .join(':')
        )
          await this.credentials.apply(fresh)
      }
      try {
        this.store.save(await refreshAccountUsage(fresh))
      } catch (error) {
        if (error instanceof AccountNetworkError && error.status === 401)
          this.store.save({ ...fresh, needsReauthorization: true })
        throw error
      }
    })
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
    this.store.close()
  }
}
