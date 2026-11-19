import { agentCliCacheSchema } from '../../../shared/agent-cli'
import type { AgentCliCache } from '../../../shared/agent-cli'
import { json, readOptional, writePrivate } from '../../accounts/files'

export class AgentCliCacheStore {
  private cache?: AgentCliCache

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    const content = await readOptional(this.path)
    if (content === null) return
    try {
      this.cache = agentCliCacheSchema.safeParse(JSON.parse(content)).data
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      this.cache = undefined
    }
  }

  snapshot(): AgentCliCache | undefined {
    return structuredClone(this.cache)
  }

  async save(value: AgentCliCache): Promise<void> {
    const cache = agentCliCacheSchema.parse(value)
    await writePrivate(this.path, json(cache))
    this.cache = cache
  }
}
