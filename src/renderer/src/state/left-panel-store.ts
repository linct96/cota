import { create } from 'zustand'

interface LeftPanelState {
  open: boolean
  width: number
}

export const useLeftPanel = create<LeftPanelState>(() => ({
  open: true,
  width: 240,
}))
