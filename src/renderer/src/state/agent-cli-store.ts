import { create } from 'zustand'
import { unwrap } from '../../../shared/contracts'
import { AGENT_CLI_PROVIDERS, agentCliCacheSchema } from '../../../shared/agent-cli'
import type { AgentCliCache } from '../../../shared/agent-cli'

interface AgentClis {
  cache?: AgentCliCache
  error?: string
  receive: (cache: AgentCliCache) => void
  load: () => Promise<void>
}

export const useAgentClis = create<AgentClis>((set, get) => ({
  receive(cache) {
    const previous = get().cache
    const parsed = agentCliCacheSchema.safeParse(cache)
    if (!parsed.success) {
      if (!previous) set({ error: 'Agent CLI 缓存格式不匹配，请重启应用。' })
      return
    }
    const entries = { ...parsed.data.entries }
    for (const provider of AGENT_CLI_PROVIDERS) {
      const entry = previous?.entries[provider]
      if (entry && entry.checkedAt >= entries[provider].checkedAt) entries[provider] = entry
    }
    set({ cache: { entries }, error: undefined })
  },
  async load() {
    try {
      get().receive(unwrap(await window.desktop.readAgentClis()))
    } catch (error) {
      if (!get().cache) set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
}))
