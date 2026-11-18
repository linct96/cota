import { parentPort, workerData } from 'node:worker_threads'
import type { AccountProduct } from '../../shared/accounts'
import type { ModelPrice, UsageRange } from '../../shared/usage-analytics'
import { aggregateUsage } from './aggregate'
import { scanSessions } from './sessions'

const input = workerData as {
  product: AccountProduct
  range: UsageRange
  roots: string[]
  prices: ModelPrice[]
  cachePath: string
}
void scanSessions(input.product, input.roots, input.cachePath)
  .then((scan) => aggregateUsage(scan, input.range, input.prices))
  .then(
    (value) => parentPort?.postMessage({ ok: true, value }),
    (error: unknown) =>
      parentPort?.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : '无法读取统计数据。',
      }),
  )
