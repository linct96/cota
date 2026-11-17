import { join } from 'node:path'
import type { IpcHandler } from '../app/ipc'
import { ModelPrices, fetchModelPrices } from './pricing'
import { UsageAnalyticsService } from './service'

export function registerAnalyticsIPC(
  handle: IpcHandler,
  configDirectory: string,
): UsageAnalyticsService {
  const prices = new ModelPrices(join(configDirectory, 'model-pricing.json'))
  const analytics = new UsageAnalyticsService(prices)
  handle('analytics:query', (product: unknown, range: unknown) => analytics.query(product, range))
  handle('analytics:prices-list', () => prices.list())
  handle('analytics:prices-save', (value: unknown, replace: unknown) => prices.save(value, replace))
  handle('analytics:prices-delete', (value: unknown) => prices.remove(value))
  handle('analytics:prices-fetch', () => fetchModelPrices())
  handle('analytics:prices-import', (value: unknown) => prices.import(value))
  return analytics
}
