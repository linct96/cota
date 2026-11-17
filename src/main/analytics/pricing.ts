import { z } from 'zod'
import { modelPriceKeySchema, modelPriceSchema } from '../../shared/usage-analytics'
import type { ModelPrice, ModelPriceKey } from '../../shared/usage-analytics'
import { json, object, readOptional, writePrivate } from '../accounts/files'

const catalogProviders = ['openai', 'anthropic', 'google', 'deepseek', 'xai']
const priceFileSchema = z.strictObject({
  version: z.literal(1),
  prices: z.array(modelPriceSchema).max(10_000),
})
const batchSchema = z.array(modelPriceSchema).min(1).max(500)
const keyOf = ({ provider, model }: ModelPriceKey) =>
  `${provider.toLowerCase()}\0${model.toLowerCase()}`

export class ModelPrices {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string) {}

  async list(): Promise<ModelPrice[]> {
    const content = await readOptional(this.path)
    if (content === null) return []
    try {
      const parsed = priceFileSchema.parse(JSON.parse(content))
      if (new Set(parsed.prices.map(keyOf)).size !== parsed.prices.length) throw new Error()
      return parsed.prices
    } catch {
      throw new Error(`无法读取模型定价，原文件已保留：${this.path}`)
    }
  }

  save(value: unknown, replaceInput: unknown): Promise<void> {
    const price = modelPriceSchema.parse(value)
    const replace = z.boolean().parse(replaceInput)
    return this.update((prices) => {
      const index = prices.findIndex((item) => keyOf(item) === keyOf(price))
      if (index >= 0 && !replace) throw new Error('该模型定价已存在，请编辑已有定价。')
      if (index < 0 && replace) throw new Error('模型定价不存在，请刷新后重试。')
      if (index < 0) prices.push(price)
      else prices[index] = price
    })
  }

  remove(value: unknown): Promise<void> {
    const key = modelPriceKeySchema.parse(value)
    return this.update((prices) => {
      const index = prices.findIndex((item) => keyOf(item) === keyOf(key))
      if (index < 0) throw new Error('模型定价不存在，请刷新后重试。')
      prices.splice(index, 1)
    })
  }

  import(values: unknown): Promise<number> {
    const incoming = batchSchema.parse(values)
    let added = 0
    return this.update((prices) => {
      const keys = new Set(prices.map(keyOf))
      for (const price of incoming) {
        const key = keyOf(price)
        if (keys.has(key)) continue
        keys.add(key)
        prices.push(price)
        added++
      }
    }).then(() => added)
  }

  private update(change: (prices: ModelPrice[]) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const prices = await this.list()
      change(prices)
      const data = priceFileSchema.parse({ version: 1, prices })
      await writePrivate(this.path, json(data))
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}

export async function fetchModelPrices(): Promise<ModelPrice[]> {
  const response = await fetch('https://models.dev/api.json', {
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok || !response.body) throw new Error('无法加载 models.dev 模型定价。')
  const maxBytes = 16 * 1024 * 1024
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength
      if (size > maxBytes) throw new Error('models.dev 返回的数据过大。')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  let catalog: Record<string, unknown>
  try {
    catalog = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    throw new Error('models.dev 返回了无效数据。')
  }
  const items: ModelPrice[] = []
  for (const provider of catalogProviders) {
    const models = object(object(catalog[provider]).models)
    for (const [model, raw] of Object.entries(models)) {
      const cost = object(object(raw).cost)
      const validPrice = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
          ? value
          : null
      const parsed = modelPriceSchema.safeParse({
        provider,
        model,
        input: validPrice(cost.input),
        output: validPrice(cost.output),
        cacheRead: validPrice(cost.cache_read),
        cacheWrite: validPrice(cost.cache_write),
      })
      if (parsed.success && (parsed.data.input !== null || parsed.data.output !== null))
        items.push(parsed.data)
    }
  }
  if (!items.length) throw new Error('models.dev 未返回可用的模型定价。')
  return items.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  )
}
