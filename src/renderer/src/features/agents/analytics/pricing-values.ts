import type { ModelPrice } from '../../../../../shared/usage-analytics'

export const priceKey = (item: Pick<ModelPrice, 'provider' | 'model'>) =>
  JSON.stringify([item.provider.toLowerCase(), item.model.toLowerCase()])
export const priceText = (value: number | null) => (value === null ? '—' : `$${value}`)
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法处理模型定价。'

export const modelPriceFields = [
  { name: 'provider', label: 'Provider' },
  { name: 'model', label: '模型 ID' },
  { name: 'input', label: '输入' },
  { name: 'output', label: '输出' },
  { name: 'cacheRead', label: '缓存读取' },
  { name: 'cacheWrite', label: '缓存写入' },
] as const
