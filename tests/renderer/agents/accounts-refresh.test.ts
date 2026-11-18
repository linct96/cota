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
  useAgents,
  watchAccountUsageRefresh,
} from '../../../src/renderer/src/features/agents/agents-store'

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
  useAgents.setState(useAgents.getInitialState(), true)
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
    useAgents.getState().selectProduct('grok')
    expect(useAgents.getState().usageRefreshStatuses.a?.error).toBe('服务不可用')
    expect(useAgents.getState().statusVersions.codex).toBe(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    stop()
  })

  it('does not restore a stale background snapshot after a newer completion event', async () => {
    useAgents.getState().selectProduct('codex')
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
    expect(useAgents.getState().usageRefreshStatuses.a).toBeUndefined()
    expect(useAgents.getState().statusVersions.codex).toBe(2)
    stop()
  })

  it('keeps different requests independent across product switches and suppresses duplicates', async () => {
    const first = deferred<Result<void>>()
    const second = deferred<Result<void>>()
    refresh.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = account('a')
    const b = account('b', 'grok')

    const refreshingA = useAgents.getState().refreshAccount(a)
    await useAgents.getState().refreshAccount(a)
    expect(refresh).toHaveBeenCalledTimes(1)
    useAgents.getState().selectProduct('grok')
    const refreshingB = useAgents.getState().refreshAccount(b)
    expect(useAgents.getState().activeProduct).toBe('grok')
    expect(useAgents.getState().refreshing).toMatchObject({ a: true, b: true })

    first.resolve({ ok: true, value: undefined })
    await refreshingA
    expect(useAgents.getState().refreshing).toMatchObject({ a: false, b: true })
    expect(useAgents.getState().statusVersions).toEqual({ codex: 1 })
    second.resolve({ ok: false, error: '服务不可用' })
    await refreshingB
    expect(useAgents.getState().refreshing.b).toBe(false)
    expect(useAgents.getState().refreshErrors.b).toBe('服务不可用')
    expect(useAgents.getState().refreshErrors.a).toBeUndefined()
    expect(useAgents.getState().statusVersions).toEqual({ codex: 1, grok: 1 })
  })

  it('keeps queued operations independent and prevents duplicate submissions', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const action = vi.fn(() => first.promise)
    const switching = useAgents.getState().perform('codex', 'switch:a', 'a', action)
    await useAgents.getState().perform('codex', 'switch:a', 'a', action)
    const deleting = useAgents.getState().perform('codex', 'delete:b', 'b', () => second.promise)
    expect(action).toHaveBeenCalledOnce()
    expect(useAgents.getState().pending).toMatchObject({ 'switch:a': true, 'delete:b': true })
    useAgents.getState().selectProduct('grok')
    expect(useAgents.getState().activeProduct).toBe('grok')
    first.resolve()
    await switching
    expect(useAgents.getState().pending).toMatchObject({ 'switch:a': false, 'delete:b': true })
    second.resolve()
    await deleting
    expect(useAgents.getState().statusVersions.codex).toBe(2)
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
    const saving = useAgents.getState().addAccount(input)
    useAgents.getState().selectProduct('grok')
    expect(useAgents.getState().addDrafts.codex).toEqual(input)
    response.resolve({ ok: false, error: '保存失败' })
    await saving
    expect(useAgents.getState().addDrafts.codex).toEqual(input)
    expect(useAgents.getState().operationErrors['add:codex']).toBe('保存失败')
    expect(
      vi
        .mocked(toast.error)
        .mock.calls.map(([message]) => (typeof message === 'string' ? message : ''))
        .join(' '),
    ).not.toContain('secret-draft')
    await useAgents.getState().addAccount(input)
    expect(useAgents.getState().addDrafts.codex).toBeUndefined()
  })

  it('keeps optimistic ordering scoped to its product and clears it on failure', async () => {
    const response = deferred<Result<void>>()
    reorder.mockReturnValueOnce(response.promise)
    const ordering = useAgents.getState().reorder('codex', ['b', 'a'])
    expect(useAgents.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useAgents.getState().acknowledgeOrder('codex')
    expect(useAgents.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useAgents.getState().selectProduct('grok')
    expect(useAgents.getState().pending['reorder:grok']).toBeUndefined()
    response.resolve({ ok: false, error: '列表已变化' })
    await ordering
    expect(useAgents.getState().pendingOrders.codex).toEqual(['b', 'a'])
    useAgents.getState().acknowledgeOrder('codex')
    expect(useAgents.getState().pendingOrders.codex).toBeUndefined()
    expect(useAgents.getState().operationErrors['reorder:codex']).toBe('列表已变化')
  })

  it('keeps browser authorization alive across product switches', async () => {
    startOAuth.mockResolvedValueOnce({ ok: true, value: undefined })
    await useAgents.getState().startOAuth('codex', 'work')
    oauthListener({ product: 'codex', stage: 'waiting', message: '等待授权' })
    useAgents.getState().selectProduct('grok')
    await useAgents.getState().startOAuth('grok', '')
    expect(startOAuth).toHaveBeenCalledOnce()
    expect(cancelOAuth).not.toHaveBeenCalled()
    oauthListener({ product: 'codex', stage: 'success', message: '完成' })
    expect(useAgents.getState().statusVersions.codex).toBe(1)
  })

  it('clears a failed account state when that account is retried', async () => {
    const stop = watchAccountUsageRefresh()
    usageRefreshListener({ id: 'a', product: 'codex', refreshing: false, error: '后台失败' })
    expect(useAgents.getState().usageRefreshStatuses.a?.error).toBe('后台失败')
    refresh
      .mockResolvedValueOnce({ ok: false, error: '需要重新授权' })
      .mockResolvedValueOnce({ ok: true, value: undefined })
    const item = account('a')
    await useAgents.getState().refreshAccount(item)
    expect(useAgents.getState().usageRefreshStatuses.a).toBeUndefined()
    expect(useAgents.getState().refreshErrors.a).toBe('需要重新授权')
    await useAgents.getState().refreshAccount(item)
    expect(useAgents.getState().refreshErrors.a).toBeUndefined()
    expect(useAgents.getState().statusVersions.codex).toBe(3)
    stop()
  })
})
