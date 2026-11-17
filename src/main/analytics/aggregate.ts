import type {
  ModelPrice,
  ModelUsage,
  UsageAnalytics,
  UsageRange,
  UsageTokens,
} from '../../shared/usage-analytics'
import type { SessionScan, UsagePart, UsageRecord } from './sessions'

const emptyTokens = (): UsageTokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
})
const pad = (value: number) => String(value).padStart(2, '0')
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
const providerKey = (value: string) =>
  value.toLowerCase() === 'openai-codex' ? 'openai' : value.toLowerCase()
const priceKey = (provider: string, model: string) =>
  `${providerKey(provider)}\0${model.toLowerCase()}`

function addTokens(total: UsageTokens, next: UsageTokens): void {
  total.input += next.input
  total.output += next.output
  total.total += next.total
  for (const field of ['cacheRead', 'cacheWrite', 'reasoning'] as const)
    total[field] = total[field] === null || next[field] === null ? null : total[field] + next[field]
}

export function estimateCost(part: UsagePart, prices: Map<string, ModelPrice>): number | null {
  if (part.cost !== null) return part.cost
  if (!part.provider || !part.model) return null
  const price = prices.get(priceKey(part.provider, part.model))
  if (!price) return null
  const { input, output, cacheRead, cacheWrite } = part.tokens
  if (input && (cacheRead === null || cacheWrite === null)) return null
  const fresh = input - (cacheRead ?? 0) - (cacheWrite ?? 0)
  const components = [
    [fresh, price.input],
    [output, price.output],
    [cacheRead ?? 0, price.cacheRead],
    [cacheWrite ?? 0, price.cacheWrite],
  ] as const
  let total = 0
  for (const [amount, rate] of components) {
    if (!amount) continue
    if (rate === null) return null
    total += (amount * rate) / 1_000_000
  }
  return total
}

type Accumulator = {
  tokens: UsageTokens
  sessions: Set<string>
  turns: Map<string, number>
  cost: number
  pricedRecords: number
  unpricedRecords: number
}
const accumulator = (): Accumulator => ({
  tokens: emptyTokens(),
  sessions: new Set(),
  turns: new Map(),
  cost: 0,
  pricedRecords: 0,
  unpricedRecords: 0,
})
const addTurn = (turns: Map<string, number>, record: UsageRecord, count: number) => {
  const key = JSON.stringify([record.session, record.turn])
  turns.set(key, Math.max(turns.get(key) ?? 0, count))
}
const turnCount = (turns: Map<string, number>) =>
  [...turns.values()].reduce((sum, value) => sum + value, 0)

export function aggregateUsage(
  scan: SessionScan,
  range: UsageRange,
  prices: ModelPrice[],
  now = new Date(),
): UsageAnalytics {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const start = new Date(today)
  if (range === '7d') start.setDate(start.getDate() - 6)
  if (range === '30d') start.setDate(start.getDate() - 29)
  const lookup = new Map(prices.map((price) => [priceKey(price.provider, price.model), price]))
  const total = accumulator()
  const models = new Map<string, { provider: string; model: string; value: Accumulator }>()
  const trend = new Map<string, number>()
  const days = new Set<string>()
  for (const record of scan.records) {
    const date = new Date(record.timestamp)
    if (date >= tomorrow || (range !== 'all' && date < start)) continue
    addTokens(total.tokens, record.tokens)
    total.sessions.add(record.session)
    addTurn(total.turns, record, record.turns)
    days.add(dayKey(date))
    const bucket =
      range === 'today'
        ? `${dayKey(date)}T${pad(date.getHours())}`
        : range === 'all'
          ? monthKey(date)
          : dayKey(date)
    trend.set(bucket, (trend.get(bucket) ?? 0) + record.tokens.total)
    for (const part of record.parts) {
      const provider = providerKey(part.provider)
      const model = part.model || '未知模型'
      const key = priceKey(provider, model)
      let entry = models.get(key)
      if (!entry) {
        entry = { provider, model, value: accumulator() }
        models.set(key, entry)
      }
      const value = entry.value
      addTokens(value.tokens, part.tokens)
      value.sessions.add(record.session)
      addTurn(value.turns, record, part.turns)
      const cost = estimateCost(part, lookup)
      if (cost === null) {
        if (part.tokens.total) {
          value.unpricedRecords++
          total.unpricedRecords++
        }
      } else {
        value.cost += cost
        value.pricedRecords++
        total.cost += cost
        total.pricedRecords++
      }
    }
  }
  const resultModels: ModelUsage[] = [...models.values()]
    .map(({ provider, model, value }) => ({
      provider,
      model,
      tokens: value.tokens,
      sessionCount: value.sessions.size,
      turnCount: turnCount(value.turns),
      estimatedCost: value.pricedRecords ? value.cost : null,
      unpricedRecords: value.unpricedRecords,
    }))
    .sort((a, b) => b.tokens.total - a.tokens.total || a.model.localeCompare(b.model))
  const buckets: UsageAnalytics['trend'] = []
  if (range === 'today') {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${dayKey(today)}T${pad(hour)}`
      buckets.push({ key, label: `${pad(hour)}:00`, total: trend.get(key) ?? 0 })
    }
  } else if (range === '7d' || range === '30d') {
    for (const date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
      const key = dayKey(date)
      buckets.push({ key, label: key.slice(5), total: trend.get(key) ?? 0 })
    }
  } else {
    const first = [...trend.keys()].sort()[0]
    if (first) {
      const [year, month] = first.split('-').map(Number)
      const date = new Date(year, month - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 1)
      while (date <= last && buckets.length < 10000) {
        const key = monthKey(date)
        buckets.push({ key, label: key, total: trend.get(key) ?? 0 })
        date.setMonth(date.getMonth() + 1)
      }
      if (date <= last) throw new Error('统计时间范围过大。')
    }
  }
  return {
    total: total.tokens,
    estimatedCost: total.pricedRecords ? total.cost : null,
    unpricedRecords: total.unpricedRecords,
    sessionCount: total.sessions.size,
    turnCount: turnCount(total.turns),
    activeDays: days.size,
    models: resultModels,
    trend: buckets,
    skippedFiles: scan.skippedFiles,
    skippedRecords: scan.skippedRecords,
  }
}
