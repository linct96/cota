import { create } from 'zustand'
import { unwrap } from '../../../shared/contracts'
import type { AgentCliCache } from '../../../shared/agent-cli'

interface AgentClis {
  cache?: AgentCliCache
  error?: string
  receive(cache: AgentCliCache): void
  load(): Promise<void>
}

export const useAgentClis = create<AgentClis>((set, get) => ({
  receive(cache) {
    if (cache.checkedAt >= (get().cache?.checkedAt ?? 0)) set({ cache, error: undefined })
  },
  async load() {
    try {
      get().receive(unwrap(await window.desktop.readAgentClis()))
    } catch (error) {
      if (!get().cache) set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
}))
