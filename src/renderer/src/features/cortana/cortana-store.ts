import { create } from 'zustand'
import { toast } from 'sonner'
import { ACCOUNT_PRODUCTS } from '../../../../shared/accounts'
import type {
  AccountOAuthProgress,
  AccountProduct,
  AccountProfile,
  AccountUsageRefreshStatus,
  AddAccountInput,
} from '../../../../shared/accounts'
import { unwrap } from '../../../../shared/contracts'

type OAuthProgress =
  | AccountOAuthProgress
  | { product: AccountProduct; stage: 'starting'; message: string }

interface CortanaState {
  activeProduct: AccountProduct
  refreshing: Record<string, boolean>
  refreshErrors: Record<string, string | undefined>
  usageRefreshStatuses: Record<string, AccountUsageRefreshStatus | undefined>
  statusVersions: Partial<Record<AccountProduct, number>>
  pending: Record<string, boolean>
  operationErrors: Record<string, string | undefined>
  pendingOrders: Partial<Record<AccountProduct, string[]>>
  addDrafts: Partial<Record<AccountProduct, AddAccountInput>>
  renameDrafts: Record<string, string | undefined>
  oauthProgress?: OAuthProgress
  selectProduct: (product: AccountProduct) => void
  perform: (
    product: AccountProduct,
    key: string,
    subject: string,
    action: () => Promise<string | void>,
  ) => Promise<boolean>
  refreshAccount: (account: AccountProfile) => Promise<void>
  receiveUsageRefresh: (status: AccountUsageRefreshStatus) => void
  reorder: (product: AccountProduct, ids: string[]) => Promise<void>
  acknowledgeOrder: (product: AccountProduct) => void
  addAccount: (input: AddAccountInput) => Promise<boolean>
  renameAccount: (account: AccountProfile, alias: string) => Promise<boolean>
  clearAddDraft: (product: AccountProduct) => void
  clearRenameDraft: (id: string) => void
  startOAuth: (product: AccountProduct, alias: string) => Promise<void>
  cancelOAuth: () => Promise<void>
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '账号操作失败，请稍后重试。'

export function oauthActive(progress?: OAuthProgress): boolean {
  return !!progress && ['starting', 'waiting', 'exchanging'].includes(progress.stage)
}

let stopOAuth: (() => void) | undefined

export const useCortana = create<CortanaState>((set, get) => ({
  activeProduct: 'pi',
  refreshing: {},
  refreshErrors: {},
  usageRefreshStatuses: {},
  statusVersions: {},
  pending: {},
  operationErrors: {},
  pendingOrders: {},
  addDrafts: {},
  renameDrafts: {},
  selectProduct: (product) => set({ activeProduct: product }),
  perform: async (product, key, subject, action) => {
    if (get().pending[key]) return false
    set((state) => ({
      pending: { ...state.pending, [key]: true },
      operationErrors: { ...state.operationErrors, [key]: undefined },
    }))
    try {
      const notice = await action()
      if (notice) toast.success(notice)
      return true
    } catch (error) {
      const message = errorText(error)
      set((state) => ({ operationErrors: { ...state.operationErrors, [key]: message } }))
      toast.error(`${subject}：${message}`)
      return false
    } finally {
      set((state) => ({
        pending: { ...state.pending, [key]: false },
        statusVersions: {
          ...state.statusVersions,
          [product]: (state.statusVersions[product] ?? 0) + 1,
        },
      }))
    }
  },
  refreshAccount: async (account) => {
    const { id, product, alias } = account
    if (get().refreshing[id] || get().pending[`delete:${id}`]) return
    set((state) => ({
      refreshing: { ...state.refreshing, [id]: true },
      refreshErrors: { ...state.refreshErrors, [id]: undefined },
      usageRefreshStatuses: state.usageRefreshStatuses[id]?.error
        ? {
            ...state.usageRefreshStatuses,
            [id]: state.usageRefreshStatuses[id].refreshing
              ? { ...state.usageRefreshStatuses[id], error: undefined }
              : undefined,
          }
        : state.usageRefreshStatuses,
    }))
    try {
      unwrap(await window.desktop.accounts.refresh(id))
      toast.success(`${alias}：${product === 'claude' ? '登录令牌已更新。' : '额度已刷新。'}`)
    } catch (error) {
      const message = errorText(error)
      set((state) => ({ refreshErrors: { ...state.refreshErrors, [id]: message } }))
      toast.error(`${alias}：${message}`)
    } finally {
      set((state) => ({
        refreshing: { ...state.refreshing, [id]: false },
        statusVersions: {
          ...state.statusVersions,
          [product]: (state.statusVersions[product] ?? 0) + 1,
        },
      }))
    }
  },
  receiveUsageRefresh: (status) => {
    set((state) => ({
      usageRefreshStatuses: {
        ...state.usageRefreshStatuses,
        [status.id]: status.refreshing || status.error ? status : undefined,
      },
      refreshErrors: status.refreshing
        ? { ...state.refreshErrors, [status.id]: undefined }
        : state.refreshErrors,
      statusVersions: status.refreshing
        ? state.statusVersions
        : {
            ...state.statusVersions,
            [status.product]: (state.statusVersions[status.product] ?? 0) + 1,
          },
    }))
  },
  reorder: async (product, ids) => {
    const key = `reorder:${product}`
    if (get().pending[key]) return
    set((state) => ({ pendingOrders: { ...state.pendingOrders, [product]: ids } }))
    await get().perform(product, key, ACCOUNT_PRODUCTS[product].name, async () => {
      unwrap(await window.desktop.accounts.reorder(product, ids))
    })
  },
  acknowledgeOrder: (product) => {
    if (get().pending[`reorder:${product}`] || !get().pendingOrders[product]) return
    set((state) => ({ pendingOrders: { ...state.pendingOrders, [product]: undefined } }))
  },
  addAccount: async (input) => {
    const key = `add:${input.product}`
    if (get().pending[key]) return false
    set((state) => ({ addDrafts: { ...state.addDrafts, [input.product]: input } }))
    const saved = await get().perform(
      input.product,
      key,
      ACCOUNT_PRODUCTS[input.product].name,
      async () => {
        unwrap(await window.desktop.accounts.add(input))
        return '账号已保存。'
      },
    )
    if (saved) get().clearAddDraft(input.product)
    return saved
  },
  renameAccount: async (account, alias) => {
    const key = `rename:${account.id}`
    if (get().pending[key] || get().pending[`delete:${account.id}`]) return false
    set((state) => ({ renameDrafts: { ...state.renameDrafts, [account.id]: alias } }))
    const saved = await get().perform(account.product, key, account.alias, async () => {
      unwrap(await window.desktop.accounts.rename({ id: account.id, alias }))
      return '账号已重命名。'
    })
    if (saved) get().clearRenameDraft(account.id)
    return saved
  },
  clearAddDraft: (product) => {
    if (get().pending[`add:${product}`]) return
    set((state) => ({
      addDrafts: { ...state.addDrafts, [product]: undefined },
      operationErrors: { ...state.operationErrors, [`add:${product}`]: undefined },
    }))
  },
  clearRenameDraft: (id) => {
    if (get().pending[`rename:${id}`]) return
    set((state) => ({
      renameDrafts: { ...state.renameDrafts, [id]: undefined },
      operationErrors: { ...state.operationErrors, [`rename:${id}`]: undefined },
    }))
  },
  startOAuth: async (product, alias) => {
    if (oauthActive(get().oauthProgress)) return
    if (!stopOAuth) {
      stopOAuth = window.desktop.accounts.onOAuth((progress) => {
        set({ oauthProgress: progress })
        if (progress.stage === 'success') {
          set((state) => ({
            statusVersions: {
              ...state.statusVersions,
              [progress.product]: (state.statusVersions[progress.product] ?? 0) + 1,
            },
          }))
          toast.success('账号已保存。')
        } else if (progress.stage === 'error') {
          toast.error(`${ACCOUNT_PRODUCTS[progress.product].name}：${progress.message}`)
        }
      })
    }
    set({ oauthProgress: { product, stage: 'starting', message: '正在启动授权…' } })
    try {
      unwrap(await window.desktop.accounts.startOAuth(product, alias))
    } catch (error) {
      const message = errorText(error)
      set({ oauthProgress: { product, stage: 'error', message } })
      toast.error(`${ACCOUNT_PRODUCTS[product].name}：${message}`)
    }
  },
  cancelOAuth: async () => {
    try {
      unwrap(await window.desktop.accounts.cancelOAuth())
    } catch (error) {
      toast.error(errorText(error))
    }
  },
}))

export function watchAccountUsageRefresh(): () => void {
  const api = window.desktop.accounts
  if (typeof api.onUsageRefresh !== 'function' || typeof api.usageRefreshStatuses !== 'function')
    return () => {}
  let active = true
  const received = new Set<string>()
  const stop = api.onUsageRefresh((status) => {
    received.add(status.id)
    useCortana.getState().receiveUsageRefresh(status)
  })
  void api
    .usageRefreshStatuses()
    .then(unwrap)
    .then((statuses) => {
      if (!active) return
      const snapshot = new Map(statuses.map((status) => [status.id, status]))
      useCortana.setState((state) => {
        const next = { ...state.usageRefreshStatuses }
        // A refresh may have finished before the listener was attached.
        const changed = new Set<AccountProduct>([state.activeProduct])
        for (const [id, status] of Object.entries(next)) {
          if (status && !received.has(id) && !snapshot.has(id)) {
            next[id] = undefined
            changed.add(status.product)
          }
        }
        for (const status of statuses) {
          if (received.has(status.id)) continue
          next[status.id] = status
          if (!status.refreshing) changed.add(status.product)
        }
        const versions = { ...state.statusVersions }
        for (const product of changed) versions[product] = (versions[product] ?? 0) + 1
        return { usageRefreshStatuses: next, statusVersions: versions }
      })
    })
    .catch((error: unknown) => console.warn('无法读取后台额度刷新状态。', error))
  return () => {
    active = false
    stop()
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => stopOAuth?.())
