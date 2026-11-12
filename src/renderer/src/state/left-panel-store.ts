import { create } from 'zustand'

interface LeftPanelState {
  open: boolean
  agentsOpen: boolean
}

export const useLeftPanel = create<LeftPanelState>(() => ({
  open: true,
  agentsOpen: false,
}))
