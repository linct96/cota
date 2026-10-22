import { create } from 'zustand'
import type { AccountProduct } from '../../../../shared/accounts'

interface CortanaState {
  activeProduct: AccountProduct
  agentSwitchBlocked: boolean
  selectProduct(product: AccountProduct): void
  setAgentSwitchBlocked(blocked: boolean): void
}

export const useCortana = create<CortanaState>((set, get) => ({
  activeProduct: 'codex',
  agentSwitchBlocked: false,
  selectProduct: (product) => {
    if (!get().agentSwitchBlocked) set({ activeProduct: product })
  },
  setAgentSwitchBlocked: (blocked) => set({ agentSwitchBlocked: blocked }),
}))
