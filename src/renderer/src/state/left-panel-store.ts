import { create } from 'zustand'

interface LeftPanelState {
  open: boolean
  width: number
  agentsOpen: boolean
}

export const useLeftPanel = create<LeftPanelState>(() => ({
  open: true,
  width: 240,
  agentsOpen: false,
}))
