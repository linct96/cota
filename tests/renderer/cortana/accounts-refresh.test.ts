import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountOAuthProgress,
  AccountProduct,
  AccountProfile,
  AccountUsageRefreshStatus,
  AddAccountInput,
} from '../../../src/shared/accounts'
import { toast } from 'sonner'
import type { Result } from '../../../src/shared/contracts'
import {
  useCortana,
  watchAccountUsageRefresh,
} from '../../../src/renderer/src/features/cortana/cortana-store'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function account(id: string, product: AccountProduct = 'codex'): AccountProfile {
  return {
    id,
    product,
    providerKey: '',
    accountType: 'oauth',
    alias: id,
    email: '',
    accountId: id,
    planType: '',
    apiBaseUrl: null,
    usagePrimary: null,
    usageSecondary: null,
    usageUpdatedAt: null,
    updatedAt: 1,
    lastUsedAt: null,
    isActive: false,
    needsReauthorization: false,
  }
}

const refresh = vi.fn<(id: string) => Promise<Result<void>>>()
const add = vi.fn<(input: AddAccountInput) => Promise<Result<void>>>()
const reorder = vi.fn<(product: AccountProduct, ids: string[]) => Promise<Result<void>>>()
const startOAuth = vi.fn<(product: AccountProduct, alias: string) => Promise<Result<void>>>()
const cancelOAuth = vi.fn<() => Promise<Result<void>>>()
const usageRefreshStatuses = vi.fn<() => Promise<Result<AccountUsageRefreshStatus[]>>>()
let usageRefreshListener: (status: AccountUsageRefreshStatus) => void
const onUsageRefresh = vi.fn((listener: (status: AccountUsageRefreshStatus) => void) => {
  usageRefreshListener = listener
  return () => {}
})
let oauthListener: (progress: AccountOAuthProgress) => void
const onOAuth = vi.fn((listener: (progress: AccountOAuthProgress) => void) => {
  oauthListener = listener
  return () => {}
})
beforeEach(() => {
  useCortana.setState(useCortana.getInitialState(), true)
  refresh.mockReset()
  add.mockReset()
  reorder.mockReset()
  startOAuth.mockReset()
  cancelOAuth.mockReset()
  usageRefreshStatuses.mockReset().mockResolvedValue({ ok: true, value: [] })
  onUsageRefresh.mockClear()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal('window', {
    desktop: {
      accounts: {
        refresh,
        add,
        reorder,
        startOAuth,
        cancelOAuth,
        onOAuth,
        usageRefreshStatuses,
        onUsageRefresh,
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('account refresh state', () => {
  it('keeps background errors visible across product switches without toasts', () => {
    const stop = watchAccountUsageRefresh()
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: true })
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: false, error: '服务不可用' })
    useCortana.getState().selectProduct('grok')
    expect(useCortana.getState().usageRefreshStatuses.a?.error).toBe('服务不可用')
    expect(useCortana.getState().statusVersions.codex).toBe(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    stop()
  })

  it('does not restore a stale background snapshot after a newer completion event', async () => {
    useCortana.getState().selectProduct('codex')
    const response = deferred<Result<AccountUsageRefreshStatus[]>>()
    usageRefreshStatuses.mockReturnValueOnce(response.promise)
    const stop = watchAccountUsageRefresh()
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: true })
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: false })
    response.resolve({
      ok: true,
      value: [{ id: 'a', product: 'codex', refreshing: true }],
    })
    await response.promise
    await Promise.resolve()
    await Promise.resolve()
    expect(useCortana.getState().usageRefreshStatuses.a).toBeUndefined()
    expect(useCortana.getState().statusVersions.codex).toBe(2)
    stop()
  })

  it('keeps different requests independent across product switches and suppresses duplicates', async () => {
    const first = deferred<Result<void>>()
    const second = deferred<Result<void>>()
    refresh.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = account('a')
    const b = account('b', 'grok')

    const refreshingA = useCortana.getState().refreshAccount(a)
    await useCortana.getState().refreshAccount(a)
    expect(refresh).toHaveBeenCalledTimes(1)
    useCortana.getState().selectProduct('grok')
    const refreshingB = useCortana.getState().refreshAccount(b)
    expect(useCortana.getState().activeProduct).toBe('grok')
    expect(useCortana.getState().refreshing).toMatchObject({ a: true, b: true })

    first.resolve({ ok: true, value: undefined })
    await refreshingA
    expect(useCortana.getState().refreshing).toMatchObject({ a: false, b: true })
    expect(useCortana.getState().statusVersions).toEqual({ codex: 1 })
    second.resolve({ ok: false, error: '服务不可用' })
    await refreshingB
    expect(useCortana.getState().refreshing.b).toBe(false)
    expect(useCortana.getState().refreshErrors.b).toBe('服务不可用')
    expect(useCortana.getState().refreshErrors.a).toBeUndefined()
    expect(useCortana.getState().statusVersions).toEqual({ codex: 1, grok: 1 })
  })

  it('keeps queued operations independent and prevents duplicate submissions', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const action = vi.fn(() => first.promise)
    const switching = useCortana.getState().perform('codex', 'switch:a', 'a', action)
    await useCortana.getState().perform('codex', 'switch:a', 'a', action)
    const deleting = useCortana.getState().perform('codex', 'delete:b', 'b', () => second.promise)
    expect(action).toHaveBeenCalledOnce()
    expect(useCortana.getState().pending).toMatchObject({ 'switch:a': true, 'delete:b': true })
    useCortana.getState().selectProduct('grok')
    expect(useCortana.getState().activeProduct).toBe('grok')
    first.resolve()
    await switching
    expect(useCortana.getState().pending).toMatchObject({ 'switch:a': false, 'delete:b': true })
    second.resolve()
    await deleting
    expect(useCortana.getState().statusVersions.codex).toBe(2)
  })

  it('preserves a failed credential draft in memory and clears it after success', async () => {
    const input: AddAccountInput = {
      product: 'codex',
      alias: 'work',
      mode: 'credential',
      credential: 'secret-draft',
      apiBaseUrl: '',
      apiKey: '',
    }
    const response = deferred<Result<void>>()
    add.mockReturnValueOnce(response.promise).mockResolvedValueOnce({ ok: true, value: undefined })
    const saving = useCortana.getState().addAccount(input)
    useCortana.getState().selectProduct('grok')
    expect(useCortana.getState().addDrafts.codex).toEqual(input)
    response.resolve({ ok: false, error: '保存失败' })
    await saving
    expect(useCortana.getState().addDrafts.codex).toEqual(input)
    expect(useCortana.getState().operationErrors['add:codex']).toBe('保存失败')
    expect(
      vi
        .mocked(toast.error)
        .mock.calls.map(([message]) => (typeof message === 'string' ? message : ''))
        .join(' '),
    ).not.toContain('secret-draft')
    await useCortana.getState().addAccount(input)
    expect(useCortana.getState().addDrafts.codex).toBeUndefined()
  })

  it('keeps optimistic ordering scoped to its product and clears it on failure', async () => {
    const response = deferred<Result<void>>()
    reorder.mockReturnValueOnce(response.promise)
    const ordering = useCortana.getState().reorder('codex', ['b', 'a'])
    expect(useCortana.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useCortana.getState().acknowledgeOrder('codex')
    expect(useCortana.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useCortana.getState().selectProduct('grok')
    expect(useCortana.getState().pending['reorder:grok']).toBeUndefined()
    response.resolve({ ok: false, error: '列表已变化' })
    await ordering
    expect(useCortana.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useCortana.getState().acknowledgeOrder('codex')
    expect(useCortana.getState().pendingOrders.codex).toBeUndefined()
    expect(useCortana.getState().operationErrors['reorder:codex']).toBe('列表已变化')
  })

  it('keeps browser authorization alive across product switches', async () => {
    startOAuth.mockResolvedValueOnce({ ok: true, value: undefined })
    await useCortana.getState().startOAuth('codex', 'work')
    oauthListener({ product: 'codex', stage: 'waiting', message: '等待授权' })
    useCortana.getState().selectProduct('grok')
    await useCortana.getState().startOAuth('grok', '')
    expect(startOAuth).toHaveBeenCalledOnce()
    expect(cancelOAuth).not.toHaveBeenCalled()
    oauthListener({ product: 'codex', stage: 'success', message: '完成' })
    expect(useCortana.getState().statusVersions.codex).toBe(1)
  })

  it('clears a failed account state when that account is retried', async () => {
    const stop = watchAccountUsageRefresh()
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: false, error: '后台失败' })
    expect(useCortana.getState().usageRefreshStatuses.a?.error).toBe('后台失败')
    refresh
      .mockResolvedValueOnce({ ok: false, error: '需要重新授权' })
      .mockResolvedValueOnce({ ok: true, value: undefined })
    const item = account('a')
    await useCortana.getState().refreshAccount(item)
    expect(useCortana.getState().usageRefreshStatuses.a).toBeUndefined()
    expect(useCortana.getState().refreshErrors.a).toBe('需要重新授权')
    await useCortana.getState().refreshAccount(item)
    expect(useCortana.getState().refreshErrors.a).toBeUndefined()
    expect(useCortana.getState().statusVersions.codex).toBe(3)
    stop()
  })
})
