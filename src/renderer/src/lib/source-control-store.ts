import { create } from 'zustand'
import { gitFileKey, type GitDiffSelection, type GitStatus } from '../../../shared/source-control'

interface SourceControlSession {
  selection?: GitDiffSelection
  mode: 'changes' | 'history' | 'compare'
  baseRef: string
  preview: boolean
  draft: string
  status?: GitStatus
  refreshed: number
}
export const EMPTY_SOURCE_CONTROL: SourceControlSession = {
  preview: false,
  mode: 'changes',
  baseRef: '',
  draft: '',
  refreshed: 0,
}
interface SourceControlState {
  sessions: Record<string, SourceControlSession>
  update(id: string, patch: Partial<SourceControlSession>): void
  showTerminal(id: string): void
}

export const useSourceControl = create<SourceControlState>((set, get) => ({
  sessions: {},
  update(id, patch) {
    set((state) => {
      const session = { ...(state.sessions[id] || EMPTY_SOURCE_CONTROL), ...patch }
      if (patch.status && session.selection && session.selection.area !== 'review') {
        const selection = session.selection
        const entry =
          patch.status.entries.find((entry) => gitFileKey(entry) === gitFileKey(selection)) ||
          patch.status.entries.find((entry) => entry.path === selection.path)
        session.selection = entry ? { path: entry.path, area: entry.area } : undefined
        if (!entry) session.preview = false
      }
      return { sessions: { ...state.sessions, [id]: session } }
    })
  },
  showTerminal(id) {
    if (get().sessions[id]?.preview) get().update(id, { preview: false })
  },
}))
