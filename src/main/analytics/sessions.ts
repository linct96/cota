import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, parse } from 'node:path'
import type { AccountProduct } from '../../shared/accounts'
import type { UsageTokens } from '../../shared/usage-analytics'
import { object } from '../accounts/files'
import { readSessionCache, sessionFingerprint, writeSessionCache } from './session-cache'
import type { CachedSession } from './session-cache'

export interface UsagePart {
  provider: string
  model: string
  tokens: UsageTokens
  cost: number | null
  turns: number
}

export interface UsageRecord {
  timestamp: number
  session: string
  turn: string
  tokens: UsageTokens
  parts: UsagePart[]
  turns: number
}

export interface SessionScan {
  records: UsageRecord[]
  skippedFiles: number
  skippedRecords: number
}

const MAX_LINE_BYTES = 8 * 1024 * 1024
const MAX_RECORDS = 500_000
const USAGE_KEY = Buffer.from('usage"')
const string = (value: unknown) =>
  typeof value === 'string' && value.length <= 200 && !/[\0\r\n]/.test(value) ? value : ''
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const time = (value: unknown): number | null => {
  const result =
    typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(new Date(result).getTime()) ? result : null
}
const key = (...values: string[]) => JSON.stringify(values)

function tokens(
  input: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
  reasoning: number | null,
  total?: number | null,
): UsageTokens | null {
  if (input === null || output === null || !Number.isSafeInteger(input + output)) return null
  if (
    (cacheRead !== null && cacheRead > input) ||
    (cacheWrite !== null && cacheWrite > input) ||
    (cacheRead !== null && cacheWrite !== null && cacheRead + cacheWrite > input) ||
    (reasoning !== null && reasoning > output)
  )
    return null
  return { input, output, cacheRead, cacheWrite, reasoning, total: total ?? input + output }
}

function codexTokens(value: unknown): UsageTokens | null {
  const usage = object(value)
  return tokens(
    count(usage.input_tokens),
    count(usage.output_tokens),
    count(usage.cached_input_tokens),
    count(usage.cache_write_input_tokens) ?? 0,
    count(usage.reasoning_output_tokens),
  )
}

function claudeTokens(value: unknown): UsageTokens | null {
  const usage = object(value)
  const fresh = count(usage.input_tokens)
  const read = count(usage.cache_read_input_tokens) ?? 0
  const write = count(usage.cache_creation_input_tokens) ?? 0
  return tokens(
    fresh === null ? null : fresh + read + write,
    count(usage.output_tokens),
    read,
    write,
    null,
  )
}

function piTokens(value: unknown): UsageTokens | null {
  const usage = object(value)
  const fresh = count(usage.input)
  const read = count(usage.cacheRead)
  const write = count(usage.cacheWrite)
  const rawOutput = count(usage.output)
  const reasoning = count(usage.reasoning)
  const total = count(usage.totalTokens)
  const input = fresh === null || read === null || write === null ? null : fresh + read + write
  // 部分代理/版本（如早期 cliproxyapi-codex-responses）上报的 output 不含 reasoning，totalTokens = input + output + reasoning
  const output =
    input !== null &&
    rawOutput !== null &&
    reasoning !== null &&
    total !== null &&
    reasoning > 0 &&
    total === input + rawOutput + reasoning
      ? rawOutput + reasoning
      : rawOutput
  return tokens(input, output, read, write, reasoning, total)
}

function grokTokens(value: unknown): UsageTokens | null {
  const usage = object(value)
  return tokens(
    count(usage.inputTokens),
    count(usage.outputTokens),
    count(usage.cachedReadTokens),
    0,
    count(usage.reasoningTokens),
  )
}

function delta(current: UsageTokens, previous?: UsageTokens): UsageTokens | null {
  if (!previous) return current
  if (current.input < previous.input || current.output < previous.output) return null
  const difference = (value: number | null, before: number | null) =>
    value === null || before === null || value < before ? null : value - before
  return tokens(
    current.input - previous.input,
    current.output - previous.output,
    difference(current.cacheRead, previous.cacheRead),
    difference(current.cacheWrite, previous.cacheWrite),
    difference(current.reasoning, previous.reasoning),
  )
}

async function readLines(
  path: string,
  visit: (value: unknown, index: number) => void,
): Promise<number> {
  let parts: Buffer[] = []
  let length = 0
  let oversized = false
  let oversizedHasUsage = false
  let oversizedTail: Buffer = Buffer.alloc(0)
  let skipped = 0
  let index = 0
  const scanUsage = (part: Buffer) => {
    if (oversizedHasUsage || !part.length) return
    const windowSize = USAGE_KEY.length - 1
    const boundary = Buffer.concat([oversizedTail, part.subarray(0, windowSize)])
    if (boundary.includes(USAGE_KEY) || part.includes(USAGE_KEY)) {
      oversizedHasUsage = true
      oversizedTail = Buffer.alloc(0)
      return
    }
    const combined = part.length >= windowSize ? part : Buffer.concat([oversizedTail, part])
    oversizedTail = Buffer.from(combined.subarray(-windowSize))
  }
  const finish = () => {
    // 无 usage 字段的超长行（如内联图片 toolResult）不影响统计，跳过时不计入异常提示
    if (oversized) {
      if (oversizedHasUsage) skipped++
    } else if (length) {
      const line = Buffer.concat(parts, length).toString('utf8').trim()
      if (line) {
        try {
          visit(JSON.parse(line), index)
        } catch (error) {
          if (error instanceof SyntaxError) skipped++
          else throw error
        }
      }
    }
    index++
    parts = []
    length = 0
    oversized = false
    oversizedHasUsage = false
    oversizedTail = Buffer.alloc(0)
  }
  const append = (part: Buffer) => {
    if (oversized) {
      scanUsage(part)
      return
    }
    length += part.length
    if (length > MAX_LINE_BYTES) {
      oversized = true
      for (const prev of parts) scanUsage(prev)
      parts = []
      scanUsage(part)
    } else parts.push(part)
  }
  for await (const raw of createReadStream(path)) {
    const chunk = raw as Buffer
    let start = 0
    let end = chunk.indexOf(10, start)
    while (end >= 0) {
      append(chunk.subarray(start, end))
      finish()
      start = end + 1
      end = chunk.indexOf(10, start)
    }
    if (start < chunk.length) append(chunk.subarray(start))
  }
  finish()
  return skipped
}

function addRecord(records: Map<string, UsageRecord>, id: string, record: UsageRecord): void {
  const previous = records.get(id)
  if (
    !previous ||
    record.tokens.total > previous.tokens.total ||
    (record.tokens.total === previous.tokens.total && record.timestamp > previous.timestamp)
  )
    records.set(id, record)
  if (records.size > MAX_RECORDS) throw new Error('会话记录过多，无法完成统计。')
}

export async function scanSessions(
  product: AccountProduct,
  roots: string[],
  cachePath?: string,
): Promise<SessionScan> {
  const records = new Map<string, UsageRecord>()
  const cachedFiles = await readSessionCache(cachePath, product, roots)
  const nextCache = new Map<string, CachedSession>()
  let cacheChanged = false
  let skippedFiles = 0
  let skippedRecords = 0
  const directories = [...roots]
  while (directories.length) {
    const directory = directories.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skippedFiles++
      continue
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        skippedFiles++
        continue
      }
      if (
        !entry.isFile() ||
        (product === 'grok' ? entry.name !== 'updates.jsonl' : extname(entry.name) !== '.jsonl')
      )
        continue
      const fileRecords = new Map<string, UsageRecord>()
      const add = (id: string, record: UsageRecord) => {
        if (cachePath) addRecord(fileRecords, id, record)
        addRecord(records, id, record)
      }
      const skippedBefore = skippedRecords
      let session = path
      let model = ''
      let provider = ''
      let turn = ''
      let previous: UsageTokens | undefined
      const piModels = new Map<string, { provider: string; model: string; api: string }>()
      const topSession =
        product === 'claude' &&
        dirname(path).endsWith(`${process.platform === 'win32' ? '\\' : '/'}subagents`)
          ? basename(dirname(dirname(path)))
          : parse(path).name
      try {
        const fingerprint = cachePath ? await sessionFingerprint(path) : undefined
        const cached = cachedFiles.get(path)
        if (fingerprint && cached?.fingerprint === fingerprint) {
          nextCache.set(path, cached)
          for (const [id, record] of cached.records) addRecord(records, id, record)
          skippedRecords += cached.skippedRecords
          continue
        }
        cacheChanged = true
        const malformed = await readLines(path, (raw, index) => {
          const row = object(raw)
          const payload = object(row.payload)
          if (product === 'codex') {
            if (row.type === 'session_meta') {
              session = string(payload.id) || session
              provider = string(payload.model_provider) || provider
            } else if (row.type === 'turn_context') {
              model = string(payload.model)
              provider = string(payload.model_provider) || provider
              turn = string(payload.turn_id)
            } else if (row.type === 'event_msg' && payload.type === 'token_count') {
              const info = object(payload.info)
              if (!info.total_token_usage) {
                if (info.last_token_usage) skippedRecords++
                return
              }
              const current = codexTokens(info.total_token_usage)
              const timestamp = time(row.timestamp)
              if (!current || timestamp === null) {
                skippedRecords++
                return
              }
              const change = delta(current, previous)
              previous = current
              if (!change) {
                skippedRecords++
                return
              }
              if (!change.total) return
              const part = { provider, model, tokens: change, cost: null, turns: 1 }
              add(key(product, session, turn, JSON.stringify(current)), {
                timestamp,
                session,
                turn: turn || `event:${index}`,
                tokens: change,
                parts: [part],
                turns: 1,
              })
            }
            return
          }
          if (product === 'claude') {
            if (row.type !== 'assistant') return
            const message = object(row.message)
            if (!message.usage) return
            const id = string(message.id)
            const usage = claudeTokens(message.usage)
            const timestamp = time(row.timestamp)
            if (!id || !usage || timestamp === null) {
              skippedRecords++
              return
            }
            session = path.includes(
              `${process.platform === 'win32' ? '\\' : '/'}subagents${process.platform === 'win32' ? '\\' : '/'}`,
            )
              ? topSession
              : string(row.sessionId) || topSession
            const part = {
              provider: 'anthropic',
              model: string(message.model),
              tokens: usage,
              cost: null,
              turns: 1,
            }
            add(key(product, session, id), {
              timestamp,
              session,
              turn: id,
              tokens: usage,
              parts: [part],
              turns: 1,
            })
            return
          }
          if (product === 'pi') {
            if (row.type === 'session') {
              session = string(row.id) || session
              return
            }
            const message = object(row.message)
            const entryId = string(row.id)
            let piModel = piModels.get(string(row.parentId))
            if (row.type === 'model_change') {
              piModel = {
                provider: string(row.provider),
                model: string(row.modelId),
                api: '',
              }
            } else if (row.type === 'message' && message.role === 'assistant' && piModel) {
              // A routed response may name a different model than the branch selection.
              piModel = {
                ...piModel,
                api:
                  message.provider === piModel.provider && message.model === piModel.model
                    ? string(message.api)
                    : '',
              }
            }
            if (entryId && piModel) piModels.set(entryId, piModel)
            if (piModels.size > MAX_RECORDS) throw new Error('会话记录过多，无法完成统计。')
            const usageValue =
              row.type === 'message' &&
              (message.role === 'assistant' || message.role === 'toolResult')
                ? message.usage
                : row.type === 'compaction' || row.type === 'branch_summary'
                  ? row.usage
                  : undefined
            if (!usageValue) return
            const usage = piTokens(usageValue)
            const timestamp = time(row.timestamp) ?? time(message.timestamp)
            if (!usage || timestamp === null) {
              skippedRecords++
              return
            }
            if (!usage.total) {
              if (usage.input || usage.output) skippedRecords++
              return
            }
            const costValue = object(object(usageValue).cost).total
            const cost =
              typeof costValue === 'number' && Number.isFinite(costValue) && costValue > 0
                ? costValue
                : null
            const id = entryId || `${path}:${index}`
            const inferredModel =
              row.type === 'compaction' &&
              row.fromHook !== true &&
              piModel?.api &&
              piModel.api !== 'pi-virtual'
                ? piModel
                : undefined
            const part = {
              provider: string(message.provider) || inferredModel?.provider || '',
              model: string(message.model) || inferredModel?.model || '',
              tokens: usage,
              cost,
              turns: 1,
            }
            add(key(product, session, id), {
              timestamp,
              session,
              turn: id,
              tokens: usage,
              parts: [part],
              turns: 1,
            })
            return
          }
          const params = object(row.params)
          const update = object(params.update)
          const usageValue = object(update.usage)
          if (!update.usage) return
          const meta = object(params._meta)
          const timestamp =
            time(meta.agentTimestampMs) ??
            (typeof row.timestamp === 'number' ? time(row.timestamp * 1000) : time(row.timestamp))
          const id = string(update.prompt_id) || string(meta.eventId)
          const usage = grokTokens(usageValue)
          if (!usage || !id || timestamp === null) {
            skippedRecords++
            return
          }
          session = string(params.sessionId) || basename(dirname(path))
          const parts = Object.entries(object(usageValue.modelUsage)).flatMap(([name, value]) => {
            const item = grokTokens(value)
            return item
              ? [
                  {
                    provider: 'xai',
                    model: string(name),
                    tokens: item,
                    cost: null,
                    turns: count(object(value).modelCalls) ?? 1,
                  },
                ]
              : []
          })
          const partInput = parts.reduce((sum, part) => sum + part.tokens.input, 0)
          const partOutput = parts.reduce((sum, part) => sum + part.tokens.output, 0)
          if (
            partInput <= usage.input &&
            partOutput <= usage.output &&
            (partInput < usage.input || partOutput < usage.output)
          ) {
            const rest = tokens(
              usage.input - partInput,
              usage.output - partOutput,
              null,
              null,
              null,
            )!
            parts.push({ provider: '', model: '', tokens: rest, cost: null, turns: 0 })
          } else if (partInput > usage.input || partOutput > usage.output) {
            skippedRecords++
            parts.splice(0, parts.length, {
              provider: '',
              model: '',
              tokens: usage,
              cost: null,
              turns: 0,
            })
          }
          add(key(product, session, id), {
            timestamp,
            session,
            turn: id,
            tokens: usage,
            parts,
            turns: count(usageValue.numTurns) ?? 1,
          })
        })
        skippedRecords += malformed
        // A live session can change while it is being read; never cache that partial snapshot.
        if (fingerprint && fingerprint === (await sessionFingerprint(path).catch(() => undefined)))
          nextCache.set(path, {
            fingerprint,
            records: [...fileRecords],
            skippedRecords: skippedRecords - skippedBefore,
          })
      } catch (error) {
        if (error instanceof Error && error.message === '会话记录过多，无法完成统计。') throw error
        skippedFiles++
      }
    }
  }
  if (cachePath && (cacheChanged || cachedFiles.size !== nextCache.size))
    await writeSessionCache(cachePath, product, roots, nextCache)
  return { records: [...records.values()], skippedFiles, skippedRecords }
}
