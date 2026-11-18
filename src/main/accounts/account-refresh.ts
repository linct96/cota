import { supportsAutomaticUsageRefresh } from '../../shared/accounts'
import type { AccountProduct } from '../../shared/accounts'
import { fingerprint } from './credential-data'
import type { CredentialDetails } from './credential-data'
import { credentialsDiffer, matches, mergeCurrent, refreshTokenKey } from './credential-matching'
import type { AccountCredentials } from './credentials'
import { refreshAccountUsage, refreshCredential, requiresReauthorization } from './network'
import type { AccountStore, StoredAccount } from './store'

export type AutomaticRefresh = {
  allowed: () => boolean
  due: (
    account: Pick<StoredAccount, 'usageUpdatedAt' | 'usagePrimary' | 'usageSecondary'>,
    active: boolean,
  ) => boolean
}

type RefreshCoordination = {
  run: <T>(action: () => T | Promise<T>) => Promise<T>
  enqueue: <T>(action: () => T | Promise<T>) => Promise<T>
  commitCredential: (product: AccountProduct, action: () => Promise<void>) => Promise<void>
  advanceCredentialVersion: (product: AccountProduct) => void
}

export class AccountRefresh {
  private recordRefreshAttempt?: (id: string) => Promise<() => Promise<void>>

  constructor(
    private readonly store: AccountStore,
    private readonly credentials: AccountCredentials,
    private readonly coordination: RefreshCoordination,
  ) {}

  setAttemptRecorder(recorder: (id: string) => Promise<() => Promise<void>>): void {
    this.recordRefreshAttempt = recorder
  }

  private validateRefreshTarget(
    id: string,
    background: boolean,
    automatic?: AutomaticRefresh,
  ): StoredAccount | undefined {
    if (background && automatic && !automatic.allowed()) return undefined
    const found = this.store.list().find((entry) => entry.id === id)
    if (!found) {
      if (background) return undefined
      throw new Error('账号不存在，请刷新后重试。')
    }
    if (
      background &&
      (!supportsAutomaticUsageRefresh(found) ||
        found.needsReauthorization ||
        found.switchUnavailable)
    )
      return undefined
    if (found.switchUnavailable) throw new Error(found.switchUnavailable)
    if (found.accountType === 'relay') throw new Error('API 账号的额度请在对应服务商查看。')
    if (found.product === 'pi' && found.providerKey === 'openai')
      throw new Error('此账号暂不支持额度查询。')
    return found
  }

  private async prepareRefreshSnapshot(
    id: string,
    initial: StoredAccount,
    background: boolean,
    automatic?: AutomaticRefresh,
  ): Promise<
    | {
        account: StoredAccount
        current: CredentialDetails[]
        revision: string | undefined
        active: boolean
      }
    | undefined
  > {
    let account = initial
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
    if (background && automatic && (!automatic.allowed() || !automatic.due(account, active)))
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
    const latestRevision = background ? await this.credentials.revision(account.product) : undefined
    if (background && automatic && !automatic.allowed()) {
      await undoAttempt?.()
      return undefined
    }
    if (background && revision !== latestRevision)
      throw new Error('当前 CLI 登录已变化，请稍后重试。')
    if (
      background &&
      JSON.stringify(this.store.list().find((entry) => entry.id === id)) !== JSON.stringify(account)
    )
      throw new Error('账号配置已变化，请稍后重试。')
    if (activeCredential) {
      account = merged
      this.coordination.advanceCredentialVersion(account.product)
      this.store.save(account)
    }
    return { account, current, revision, active }
  }

  private mergeFreshCredential(
    latest: StoredAccount,
    account: StoredAccount,
    fresh: StoredAccount,
  ): StoredAccount {
    if (
      latest.product !== account.product ||
      latest.accountType !== account.accountType ||
      latest.providerKey !== account.providerKey ||
      latest.accountId !== account.accountId ||
      (latest.auth !== account.auth && latest.auth !== fresh.auth)
    )
      throw new Error('账号认证在续期期间发生变化，无法安全保存新凭据，请重新授权。')
    return {
      ...latest,
      auth: fresh.auth,
      needsReauthorization: fresh.needsReauthorization,
      updatedAt: Math.max(latest.updatedAt, fresh.updatedAt),
    }
  }

  private saveRefreshedCredential(
    id: string,
    account: StoredAccount,
    fresh: StoredAccount,
  ): StoredAccount | undefined {
    const latest = this.store.list().find((entry) => entry.id === id)
    if (!latest) return undefined
    let toSave = fresh
    if (JSON.stringify(latest) !== JSON.stringify(account))
      toSave = this.mergeFreshCredential(latest, account, fresh)
    try {
      this.store.save(toSave)
      return toSave
    } catch (error) {
      let currentLatest: StoredAccount
      try {
        currentLatest = this.store.get(id)
      } catch {
        throw error
      }
      try {
        toSave = this.mergeFreshCredential(currentLatest, account, fresh)
      } catch (mergeError) {
        const message = mergeError instanceof Error ? mergeError.message : '无法读取当前认证状态。'
        throw new Error(message, { cause: error })
      }
      this.store.save(toSave)
      return toSave
    }
  }

  private markReauthorizationIfUnchanged(id: string, expectedAuth: string): void {
    const latest = this.store.list().find((entry) => entry.id === id)
    if (latest && latest.auth === expectedAuth)
      this.store.save({ ...latest, needsReauthorization: true })
  }

  private async commitRefreshedCredential(
    id: string,
    account: StoredAccount,
    freshInput: StoredAccount,
    current: CredentialDetails[],
    revision: string | undefined,
    active: boolean,
    background: boolean,
    piLock?: () => void,
  ): Promise<StoredAccount | undefined> {
    let saved: StoredAccount | undefined
    await this.coordination.commitCredential(account.product, async () => {
      saved = this.saveRefreshedCredential(id, account, freshInput)
      if (!saved) return
      if (saved.auth !== account.auth) {
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
            if (background) await this.credentials.updateCurrent(saved, revision, piLock)
            else await this.credentials.apply(saved, undefined, piLock)
          } else if (background) {
            const latest = await this.credentials.current(account.product)
            if (latest.some((entry) => matches(account, entry))) {
              // Account was switched active concurrently while its credential was renewing.
              const latestRevision = await this.credentials.revision(account.product)
              await this.credentials.updateCurrent(saved, latestRevision, piLock)
            }
          }
          piLock?.()
        } catch (error) {
          this.store.save({ ...saved, needsReauthorization: true })
          const message = error instanceof Error ? error.message : '无法读取当前认证状态。'
          throw new Error(`${message} 新凭据已保存，请重新授权或确认后导入当前登录。`, {
            cause: error,
          })
        }
      }
    })
    return saved
  }

  private saveUsageResult(id: string, fresh: StoredAccount, usage: StoredAccount): boolean {
    const latest = this.store.list().find((entry) => entry.id === id)
    if (!latest || latest.auth !== fresh.auth) return false
    this.store.save({
      ...latest,
      email: usage.email,
      planType: usage.planType,
      usagePrimary: usage.usagePrimary,
      usageSecondary: usage.usageSecondary,
      usageUpdatedAt: usage.usageUpdatedAt,
      needsReauthorization: false,
    })
    return true
  }

  async runManualRefresh(id: string): Promise<boolean> {
    const found = this.validateRefreshTarget(id, false)
    if (!found) return false
    const snapshot = await this.prepareRefreshSnapshot(id, found, false)
    if (!snapshot) return false
    const { account, current, revision, active } = snapshot
    let fresh: StoredAccount
    try {
      fresh = await refreshCredential(account, account.product === 'claude')
    } catch (error) {
      if (requiresReauthorization(error)) this.markReauthorizationIfUnchanged(id, account.auth)
      throw error
    }
    const saved = await this.commitRefreshedCredential(
      id,
      account,
      fresh,
      current,
      revision,
      active,
      false,
    )
    if (!saved) return false
    try {
      const usage = await refreshAccountUsage(saved)
      return this.saveUsageResult(id, saved, usage)
    } catch (error) {
      if (requiresReauthorization(error)) this.markReauthorizationIfUnchanged(id, saved.auth)
      throw error
    }
  }

  async runBackgroundRefresh(
    id: string,
    automatic: AutomaticRefresh,
    task: { manual: boolean },
  ): Promise<boolean> {
    const stage1 = await this.coordination.run(async () => {
      if (task.manual) return { mode: 'manual' as const }
      const found = this.validateRefreshTarget(id, true, automatic)
      if (!found) return { mode: 'skip' as const }
      if (found.product === 'pi') return { mode: 'pi' as const, account: found }
      const snapshot = await this.prepareRefreshSnapshot(id, found, true, automatic)
      if (!snapshot) return { mode: 'skip' as const }
      return { mode: 'snapshot' as const, ...snapshot }
    })
    if (stage1.mode === 'manual') return this.coordination.run(() => this.runManualRefresh(id))
    if (stage1.mode === 'skip') return false

    let fresh: StoredAccount | undefined
    if (stage1.mode === 'pi') {
      // Pi's auth lock must stay outside this.coordination.run() to avoid deadlocking with switch/deactivate.
      fresh = await this.credentials.withPiLock(async (piLock) => {
        const snapshot = await this.prepareRefreshSnapshot(
          id,
          stage1.account,
          !task.manual,
          automatic,
        )
        if (!snapshot) return undefined
        const { account, current, revision, active } = snapshot
        let renewed: StoredAccount
        try {
          renewed = await refreshCredential(account, false)
        } catch (error) {
          if (requiresReauthorization(error)) this.markReauthorizationIfUnchanged(id, account.auth)
          throw error
        }
        return this.commitRefreshedCredential(
          id,
          account,
          renewed,
          current,
          revision,
          active,
          true,
          piLock,
        )
      })
    } else {
      const { account, current, revision, active } = stage1
      let renewed: StoredAccount
      try {
        renewed = await refreshCredential(account, account.product === 'claude')
      } catch (error) {
        if (requiresReauthorization(error))
          await this.coordination.enqueue(() =>
            this.markReauthorizationIfUnchanged(id, account.auth),
          )
        throw error
      }
      fresh =
        renewed === account
          ? account
          : await this.coordination.enqueue(() =>
              this.commitRefreshedCredential(id, account, renewed, current, revision, active, true),
            )
    }

    if (!fresh) return false
    if (!task.manual && !automatic.allowed()) return false
    const target = fresh
    let usage: StoredAccount
    try {
      usage = await refreshAccountUsage(target)
    } catch (error) {
      if (requiresReauthorization(error))
        await this.coordination.enqueue(() => this.markReauthorizationIfUnchanged(id, target.auth))
      throw error
    }
    return this.coordination.enqueue(() => this.saveUsageResult(id, target, usage))
  }
}
