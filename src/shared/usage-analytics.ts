import { z } from 'zod'
import type { AccountProduct } from './accounts'
import type { Result } from './contracts'

export const usageRangeSchema = z.enum(['today', '7d', '30d', 'all'])
export type UsageRange = z.infer<typeof usageRangeSchema>

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\0\r\n]+$/)
const price = z.number().finite().nonnegative().max(1_000_000).nullable()
export const modelPriceKeySchema = z.strictObject({ provider: identifier, model: identifier })
export const modelPriceSchema = modelPriceKeySchema.extend({
  input: price,
  output: price,
  cacheRead: price,
  cacheWrite: price,
})
export type ModelPrice = z.infer<typeof modelPriceSchema>
export type ModelPriceKey = z.infer<typeof modelPriceKeySchema>

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  total: number
}

export interface ModelUsage {
  provider: string
  model: string
  tokens: UsageTokens
  sessionCount: number
  turnCount: number
  estimatedCost: number | null
  unpricedRecords: number
}

export interface UsageAnalytics {
  total: UsageTokens
  estimatedCost: number | null
  unpricedRecords: number
  sessionCount: number
  turnCount: number
  activeDays: number
  models: ModelUsage[]
  trend: { key: string; label: string; total: number }[]
  skippedFiles: number
  skippedRecords: number
}

export interface UsageAnalyticsAPI {
  query: (product: AccountProduct, range: UsageRange) => Promise<Result<UsageAnalytics>>
  listPrices: () => Promise<Result<ModelPrice[]>>
  savePrice: (price: ModelPrice, replace: boolean) => Promise<Result<void>>
  deletePrice: (key: ModelPriceKey) => Promise<Result<void>>
  fetchPrices: () => Promise<Result<ModelPrice[]>>
  importPrices: (prices: ModelPrice[]) => Promise<Result<number>>
}
