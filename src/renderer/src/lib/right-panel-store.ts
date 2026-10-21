import { create } from 'zustand'

interface RightPanelState {
  open: boolean
  width: number
}

export const useRightPanel = create<RightPanelState>(() => ({
  open: false,
  width: 300,
}))
