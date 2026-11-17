import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { accountProductSchema } from '../../shared/accounts'
import { usageRangeSchema } from '../../shared/usage-analytics'
import type { AccountProduct } from '../../shared/accounts'
import type { UsageAnalytics } from '../../shared/usage-analytics'
import type { Result } from '../../shared/contracts'
import type { ModelPrices } from './pricing'

export function sessionRoots(
  product: AccountProduct,
  home = homedir(),
  env = process.env,
): string[] {
  const directory = (value: string | undefined, fallback: string) => {
    if (!value) return fallback
    if (value === '~') return home
    if (/^~[\\/]/.test(value)) return join(home, value.slice(2))
    return isAbsolute(value) ? value : resolve(value)
  }
  switch (product) {
    case 'codex': {
      const root = directory(env.CODEX_HOME, join(home, '.codex'))
      return [join(root, 'sessions'), join(root, 'archived_sessions')]
    }
    case 'claude':
      return [join(directory(env.CLAUDE_CONFIG_DIR, join(home, '.claude')), 'projects')]
    case 'pi':
      return [join(directory(env.PI_CODING_AGENT_DIR, join(home, '.pi', 'agent')), 'sessions')]
    case 'grok':
      return [join(directory(env.GROK_HOME, join(home, '.grok')), 'sessions')]
  }
}

export class UsageAnalyticsService {
  private generation = 0
  private cancel?: () => void

  constructor(private readonly prices: ModelPrices) {}

  async query(productInput: unknown, rangeInput: unknown): Promise<UsageAnalytics> {
    const product = accountProductSchema.parse(productInput)
    const range = usageRangeSchema.parse(rangeInput)
    const generation = ++this.generation
    this.cancel?.()
    const prices = await this.prices.list()
    if (generation !== this.generation) throw new Error('统计已取消。')
    return new Promise((resolveQuery, reject) => {
      const directory = __dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
      const worker = new Worker(join(directory, 'analytics-worker.js'), {
        workerData: { product, range, roots: sessionRoots(product), prices },
      })
      let finished = false
      const finish = (error?: Error, value?: UsageAnalytics) => {
        if (finished) return
        finished = true
        if (this.cancel === cancel) this.cancel = undefined
        worker.removeAllListeners()
        void worker.terminate()
        if (error) reject(error)
        else resolveQuery(value!)
      }
      const cancel = () => finish(new Error('统计已取消。'))
      this.cancel = cancel
      worker.once('message', (result: Result<UsageAnalytics>) => {
        if (result.ok) finish(undefined, result.value)
        else finish(new Error(result.error))
      })
      worker.once('error', (error) =>
        finish(error instanceof Error ? error : new Error('统计任务失败，请重试。')),
      )
      worker.once('exit', () => finish(new Error('统计任务已结束，请重试。')))
    })
  }

  dispose(): void {
    this.generation++
    this.cancel?.()
  }
}
