import * as fs from 'node:fs'
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateUsage } from '../../../src/main/analytics/aggregate'
import { ModelPrices, fetchModelPrices } from '../../../src/main/analytics/pricing'
import { scanSessions } from '../../../src/main/analytics/sessions'
import * as sessionCache from '../../../src/main/analytics/session-cache'
import type { AccountProduct } from '../../../src/shared/accounts'
import { UsageAnalyticsService, sessionRoots } from '../../../src/main/analytics/service'
import type { ModelPrice } from '../../../src/shared/usage-analytics'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Worker: vi.fn(
      class extends EventEmitter {
        terminate = vi.fn(() => Promise.resolve(0))
      },
    ),
  }
})

let root: string
const now = new Date(2025, 0, 10, 12)
const timestamp = new Date(2025, 0, 10, 10).toISOString()
const price: ModelPrice = {
  provider: 'openai',
  model: 'model-a',
  input: 2,
  output: 10,
  cacheRead: 0.2,
  cacheWrite: 2.5,
}

async function jsonl(path: string, rows: unknown[], tail = '') {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n${tail}`)
}

async function cachedScan(product: AccountProduct, roots: string[]) {
  const expected = await scanSessions(product, roots)
  const cache = join(root, 'cache', `${product}.json`)
  expect(await scanSessions(product, roots, cache)).toEqual(expected)
  const read = vi.mocked(fs.createReadStream).mockClear()
  expect(await scanSessions(product, roots, cache)).toEqual(expected)
  expect(read).not.toHaveBeenCalled()
  return expected
}

beforeEach(async () => {
  vi.mocked(Worker).mockClear()
  root = await mkdtemp(join(tmpdir(), 'cota-analytics-'))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(root, { recursive: true, force: true })
})

describe('local usage analytics', () => {
  it('deduplicates Codex cumulative snapshots and archived copies', async () => {
    const snapshot = (input: number, output: number, cached: number, reasoning: number) => ({
      type: 'event_msg',
      timestamp,
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: input,
            output_tokens: output,
            cached_input_tokens: cached,
            reasoning_output_tokens: reasoning,
          },
        },
      },
    })
    const rows = [
      { type: 'session_meta', payload: { id: 'session', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'model-a', turn_id: 'turn' } },
      snapshot(100, 10, 20, 3),
      snapshot(100, 10, 20, 3),
      snapshot(160, 20, 40, 4),
    ]
    await jsonl(join(root, 'sessions', 'one.jsonl'), rows, '{incomplete')
    await jsonl(join(root, 'archived_sessions', 'one.jsonl'), rows)
    const scan = await cachedScan('codex', [
      join(root, 'sessions'),
      join(root, 'archived_sessions'),
    ])
    const result = aggregateUsage(scan, 'today', [price], now)
    expect(result.total).toEqual({
      input: 160,
      output: 20,
      cacheRead: 40,
      cacheWrite: 0,
      reasoning: 4,
      total: 180,
    })
    expect(result.sessionCount).toBe(1)
    expect(result.turnCount).toBe(1)
    expect(result.skippedRecords).toBe(1)
    expect(result.unpricedRecords).toBe(0)
    expect(result.estimatedCost).toBeCloseTo((120 * 2 + 20 * 10 + 40 * 0.2) / 1_000_000)
    expect(result.trend[10].total).toBe(180)
  })

  it('keeps the final Claude message usage and counts cache as input once', async () => {
    const row = (fresh: number, output: number) => ({
      type: 'assistant',
      timestamp,
      sessionId: 'claude-session',
      message: {
        id: 'message',
        model: 'claude-a',
        usage: {
          input_tokens: fresh,
          output_tokens: output,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 10,
        },
        content: 'private content',
      },
    })
    await jsonl(join(root, 'projects', 'project', 'session.jsonl'), [row(2, 3), row(8, 5)])
    const scan = await cachedScan('claude', [join(root, 'projects')])
    const result = aggregateUsage(scan, '7d', [], now)
    expect(result.total).toEqual({
      input: 98,
      output: 5,
      cacheRead: 80,
      cacheWrite: 10,
      reasoning: null,
      total: 103,
    })
    expect(result.models[0].model).toBe('claude-a')
    expect(result.unpricedRecords).toBe(1)
    expect(result.estimatedCost).toBeNull()
    expect(JSON.stringify(result)).not.toContain('private content')
  })

  it('uses Pi recorded cost where available and prices only the remaining usage', async () => {
    const usage = { input: 10, output: 5, cacheRead: 20, cacheWrite: 5, totalTokens: 40 }
    const row = (id: string, cost: number) => ({
      type: 'message',
      id,
      timestamp,
      message: {
        role: 'assistant',
        provider: 'openai-codex',
        model: 'model-a',
        usage: { ...usage, cost: { total: cost } },
      },
    })
    await jsonl(join(root, 'sessions', 'project', 'session.jsonl'), [
      { type: 'session', id: 'pi-session' },
      row('a', 0.001),
      row('b', 0),
    ])
    const result = aggregateUsage(
      await cachedScan('pi', [join(root, 'sessions')]),
      'today',
      [price],
      now,
    )
    expect(result.total).toEqual({
      input: 70,
      output: 10,
      cacheRead: 40,
      cacheWrite: 10,
      reasoning: null,
      total: 80,
    })
    expect(result.estimatedCost).toBeCloseTo(
      0.001 + (10 * 2 + 5 * 10 + 20 * 0.2 + 5 * 2.5) / 1_000_000,
    )
    expect(result.unpricedRecords).toBe(0)
    const unpriced = aggregateUsage(
      await scanSessions('pi', [join(root, 'sessions')]),
      'today',
      [],
      now,
    )
    expect(unpriced.estimatedCost).toBe(0.001)
    expect(unpriced.unpricedRecords).toBe(1)
  })

  it('attributes native Pi compactions without changing recorded tokens or cost', async () => {
    const examples = [
      {
        model: 'gpt-6.1-terra',
        input: 40675,
        output: 4868,
        reasoning: 2982,
        totalTokens: 45543,
        cost: 0.065015,
      },
      {
        model: 'gpt-6.1-sol',
        input: 44255,
        output: 3988,
        reasoning: 332,
        totalTokens: 48243,
        cost: 0.12839,
      },
    ]
    for (const { model, cost, ...usage } of examples) {
      await jsonl(join(root, `${model}.jsonl`), [
        { type: 'session', id: model },
        {
          type: 'model_change',
          id: 'selection',
          parentId: null,
          provider: 'openai',
          modelId: model,
        },
        {
          type: 'message',
          id: 'response',
          parentId: 'selection',
          message: {
            role: 'assistant',
            provider: 'openai',
            model,
            api: 'openai-responses',
          },
        },
        { type: 'message', id: 'tool', parentId: 'response', message: { role: 'toolResult' } },
        {
          type: 'compaction',
          id: 'summary',
          parentId: 'tool',
          timestamp,
          fromHook: false,
          usage: { ...usage, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
        },
      ])
    }
    const result = aggregateUsage(await cachedScan('pi', [root]), 'today', [], now)
    expect(result.total).toEqual({
      input: 84930,
      output: 8856,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 3314,
      total: 93786,
    })
    expect(result.estimatedCost).toBeCloseTo(0.193405, 10)
    expect(result.sessionCount).toBe(2)
    expect(result.turnCount).toBe(2)
    expect(result.unpricedRecords).toBe(0)
    expect(result.skippedRecords).toBe(0)
    for (const example of examples) {
      expect(result.models.find((item) => item.model === example.model)).toMatchObject({
        provider: 'openai',
        tokens: { total: example.totalTokens },
        estimatedCost: example.cost,
        sessionCount: 1,
        turnCount: 1,
      })
    }
    expect(result.models).toHaveLength(2)
  })

  it('keeps Pi compaction attribution on its parent branch across model switches', async () => {
    const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }
    const selection = (id: string, parentId: string | null, provider: string, modelId: string) => ({
      type: 'model_change',
      id,
      parentId,
      provider,
      modelId,
    })
    const response = (id: string, parentId: string, provider: string, model: string) => ({
      type: 'message',
      id,
      parentId,
      message: { role: 'assistant', provider, model, api: 'openai-responses' },
    })
    const compaction = (id: string, parentId: string) => ({
      type: 'compaction',
      id,
      parentId,
      timestamp,
      usage,
    })
    await jsonl(join(root, 'session.jsonl'), [
      { type: 'session', id: 'branches' },
      selection('select-a', null, 'openai', 'model-a'),
      response('a', 'select-a', 'openai', 'model-a'),
      selection('select-b', 'a', 'other', 'model-b'),
      response('b', 'select-b', 'other', 'model-b'),
      compaction('summary-b', 'b'),
      compaction('summary-a', 'a'),
      compaction('summary-b-again', 'summary-b'),
    ])
    const scan = await scanSessions('pi', [root])
    expect(
      scan.records.map((record) => [record.turn, record.parts[0].provider, record.parts[0].model]),
    ).toEqual([
      ['summary-b', 'other', 'model-b'],
      ['summary-a', 'openai', 'model-a'],
      ['summary-b-again', 'other', 'model-b'],
    ])
    const result = aggregateUsage(scan, 'today', [price], now)
    expect(result.total.total).toBe(45)
    expect(result.models.find((item) => item.model === 'model-a')?.estimatedCost).toBeCloseTo(
      0.00007,
      10,
    )
  })

  it('leaves unconfirmed, routed and extension Pi summaries unattributed', async () => {
    const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }
    const summary = (id: string, parentId: string | null, extra = {}) => ({
      type: 'compaction',
      id,
      parentId,
      timestamp,
      usage,
      ...extra,
    })
    await jsonl(join(root, 'session.jsonl'), [
      { type: 'session', id: 'uncertain' },
      {
        type: 'model_change',
        id: 'select',
        parentId: null,
        provider: 'openai',
        modelId: 'model-a',
      },
      {
        type: 'message',
        id: 'a',
        parentId: 'select',
        message: {
          role: 'assistant',
          provider: 'openai',
          model: 'model-a',
          api: 'openai-responses',
        },
      },
      summary('hook', 'a', { fromHook: true }),
      summary('missing', 'not-found'),
      summary('root', null),
      summary('branch', 'a', { type: 'branch_summary', fromId: 'a' }),
      { type: 'model_change', id: 'switch', parentId: 'a', provider: 'other', modelId: 'model-b' },
      summary('no-response', 'switch'),
      { type: 'model_change', id: 'virtual', parentId: 'a', provider: 'openai', modelId: 'router' },
      {
        type: 'message',
        id: 'virtual-response',
        parentId: 'virtual',
        message: { role: 'assistant', provider: 'openai', model: 'router', api: 'pi-virtual' },
      },
      summary('virtual-summary', 'virtual-response'),
      {
        type: 'message',
        id: 'routed-response',
        parentId: 'virtual',
        message: {
          role: 'assistant',
          provider: 'openai',
          model: 'model-a',
          api: 'openai-responses',
        },
      },
      summary('routed-summary', 'routed-response'),
      {
        type: 'message',
        id: 'legacy-response',
        parentId: 'select',
        message: { role: 'assistant', provider: 'openai', model: 'model-a' },
      },
      summary('unconfirmed-api', 'legacy-response'),
    ])
    const result = aggregateUsage(await scanSessions('pi', [root]), 'today', [price], now)
    expect(result.total.total).toBe(120)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]).toMatchObject({
      provider: '',
      model: '未知模型',
      tokens: { total: 120 },
    })
    expect(result.unpricedRecords).toBe(8)
    expect(result.estimatedCost).toBeNull()
    expect(result.skippedRecords).toBe(0)
  })

  it('deduplicates Grok prompt snapshots and retains unknown-model remainder', async () => {
    const row = (input: number) => ({
      params: {
        sessionId: 'grok-session',
        _meta: { agentTimestampMs: new Date(timestamp).getTime() },
        update: {
          prompt_id: 'prompt',
          usage: {
            inputTokens: input,
            outputTokens: 20,
            cachedReadTokens: 10,
            numTurns: 2,
            modelUsage: {
              'grok-a': { inputTokens: 80, outputTokens: 15, cachedReadTokens: 10, modelCalls: 1 },
            },
          },
        },
      },
    })
    await jsonl(join(root, 'sessions', 'project', 'updates.jsonl'), [row(90), row(100)])
    const result = aggregateUsage(
      await cachedScan('grok', [join(root, 'sessions')]),
      'today',
      [],
      now,
    )
    expect(result.total.total).toBe(120)
    expect(result.turnCount).toBe(2)
    expect(result.models.map((item) => [item.model, item.tokens.total])).toEqual([
      ['grok-a', 95],
      ['未知模型', 25],
    ])
    expect(result.unpricedRecords).toBe(2)
  })

  it('does not attribute an inconsistent Grok model breakdown or treat it as priced', async () => {
    await jsonl(join(root, 'updates.jsonl'), [
      {
        params: {
          sessionId: 'session',
          _meta: { agentTimestampMs: new Date(timestamp).getTime() },
          update: {
            prompt_id: 'prompt',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              modelUsage: { 'model-a': { inputTokens: 20, outputTokens: 5, cachedReadTokens: 0 } },
            },
          },
        },
      },
    ])
    const result = aggregateUsage(
      await scanSessions('grok', [root]),
      'today',
      [{ ...price, provider: 'xai' }],
      now,
    )
    expect(result.total.total).toBe(15)
    expect(result.models.map((item) => [item.model, item.tokens.total])).toEqual([['未知模型', 15]])
    expect(result.unpricedRecords).toBe(1)
    expect(result.skippedRecords).toBe(1)
  })

  it('uses local day boundaries, excludes future days and preserves null breakdowns', async () => {
    const row = (id: string, day: number) => ({
      type: 'message',
      id,
      timestamp: new Date(2025, 0, day, 10).toISOString(),
      message: {
        role: 'assistant',
        provider: 'openai',
        model: 'model-a',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      },
    })
    await jsonl(join(root, 'session.jsonl'), [
      { type: 'session', id: 'date' },
      row('a', 4),
      row('b', 3),
      row('c', 11),
      {
        type: 'message',
        id: 'invalid',
        timestamp,
        message: {
          role: 'assistant',
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        },
      },
    ])
    const result = aggregateUsage(await scanSessions('pi', [root]), '7d', [price], now)
    expect(result.total.total).toBe(2)
    expect(result.skippedRecords).toBe(1)
    expect(result.trend).toHaveLength(7)
    expect(result.trend[0].total).toBe(2)
  })

  it('normalizes Pi separate reasoning tokens when totalTokens includes reasoning', async () => {
    const row = (id: string, usage: Record<string, number>) => ({
      type: 'message',
      id,
      timestamp,
      message: { role: 'assistant', provider: 'cliproxyapi', model: 'gemini-a', usage },
    })
    await jsonl(join(root, 'session.jsonl'), [
      { type: 'session', id: 'reasoning' },
      row('separate-gt', {
        input: 100,
        output: 15,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 231,
        totalTokens: 346,
      }),
      row('separate-le', {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 20,
        totalTokens: 170,
      }),
      row('mismatch', {
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 30,
        totalTokens: 110,
      }),
    ])
    const scan = await scanSessions('pi', [root])
    expect(scan.skippedRecords).toBe(1)
    expect(scan.records.map((item) => item.tokens)).toEqual([
      { input: 100, output: 246, cacheRead: 0, cacheWrite: 0, reasoning: 231, total: 346 },
      { input: 100, output: 70, cacheRead: 0, cacheWrite: 0, reasoning: 20, total: 170 },
    ])
  })

  it('ignores oversized lines without usage and counts oversized usage lines as skipped', async () => {
    const padding = 'a'.repeat(8 * 1024 * 1024 + 32)
    await jsonl(join(root, 'session.jsonl'), [
      { type: 'session', id: 'oversized' },
      {
        type: 'message',
        id: 'image',
        timestamp,
        message: { role: 'toolResult', content: padding },
      },
      {
        type: 'message',
        id: 'with-usage',
        timestamp,
        message: {
          role: 'assistant',
          content: padding,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        },
      },
    ])
    const scan = await scanSessions('pi', [root])
    expect(scan.records).toHaveLength(0)
    expect(scan.skippedRecords).toBe(1)
  })

  it('resolves configured homes without exposing paths through the result', () => {
    const env = {
      CODEX_HOME: join(root, 'codex'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      PI_CODING_AGENT_DIR: '~/pi-alt',
      GROK_HOME: join(root, 'grok'),
    }
    expect(sessionRoots('codex', root, env)).toEqual([
      join(root, 'codex', 'sessions'),
      join(root, 'codex', 'archived_sessions'),
    ])
    expect(sessionRoots('claude', root, env)).toEqual([join(root, 'claude', 'projects')])
    expect(sessionRoots('pi', root, env)).toEqual([join(root, 'pi-alt', 'sessions')])
    expect(sessionRoots('grok', root, env)).toEqual([join(root, 'grok', 'sessions')])
  })
})

describe('session parsing cache', () => {
  const row = (id: string, input = 10, day = 10) => ({
    type: 'message',
    id,
    timestamp: new Date(2025, 0, day, 10).toISOString(),
    message: {
      role: 'assistant',
      provider: 'openai',
      model: 'model-a',
      content: 'private chat body',
      usage: { input, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: input + 5 },
    },
  })

  it('reparses only changed files, prunes deletions and reaggregates ranges and prices', async () => {
    const roots = [join(root, 'sessions')]
    const cache = join(root, 'cache', 'pi.json')
    const a = join(roots[0], 'a.jsonl')
    const b = join(roots[0], 'b.jsonl')
    await jsonl(a, [row('a')])
    await jsonl(b, [row('b', 20, 9)])
    const first = await scanSessions('pi', roots, cache)
    expect(aggregateUsage(first, 'today', [price], now).total.total).toBe(15)
    const read = vi.mocked(fs.createReadStream).mockClear()
    const warm = await scanSessions('pi', roots, cache)
    expect(read).not.toHaveBeenCalled()
    expect(aggregateUsage(warm, '7d', [price], now).total.total).toBe(40)
    expect(aggregateUsage(warm, 'today', [{ ...price, input: 4 }], now).estimatedCost).toBeCloseTo(
      0.00009,
    )
    expect(aggregateUsage(warm, 'today', [price], new Date(2025, 0, 11, 12)).total.total).toBe(0)

    const before = await lstat(a)
    await jsonl(a, [row('a', 30)])
    await utimes(a, before.atime, before.mtime)
    expect((await lstat(a)).size).toBe(before.size)
    let scan = await scanSessions('pi', roots, cache)
    expect(read.mock.calls.map(([path]) => path)).toEqual([a])
    expect(scan.records.find((record) => record.turn === 'a')?.tokens.total).toBe(35)
    read.mockClear()

    await appendFile(a, `${JSON.stringify(row('new'))}\n`)
    await jsonl(join(roots[0], 'c.jsonl'), [row('c')])
    await rm(b)
    scan = await scanSessions('pi', roots, cache)
    expect(
      read.mock.calls
        .map(([path]) => path)
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual([a, join(roots[0], 'c.jsonl')])
    expect(
      scan.records.map((record) => record.turn).sort((left, right) => left.localeCompare(right)),
    ).toEqual(['a', 'c', 'new'])
    const stored = await readFile(cache, 'utf8')
    expect(stored).not.toContain('private chat body')
    expect(stored).not.toContain(b)
    if (process.platform !== 'win32') expect((await lstat(cache)).mode & 0o777).toBe(0o600)
  })

  it('rebuilds damaged, incompatible and mismatched caches instead of trusting them', async () => {
    const roots = [join(root, 'sessions')]
    const cache = join(root, 'cache.json')
    await jsonl(join(roots[0], 'a.jsonl'), [row('a')], '{incomplete')
    const expected = await scanSessions('pi', roots, cache)
    const original = JSON.parse(await readFile(cache, 'utf8'))
    const invalid = structuredClone(original)
    invalid.files[0][1].records[0][1].tokens.input = -1
    const read = vi.mocked(fs.createReadStream).mockClear()
    for (const content of [
      '{broken',
      JSON.stringify({ ...original, version: 99 }),
      JSON.stringify({ ...original, roots: [join(root, 'other')] }),
      JSON.stringify({ ...original, product: 'codex' }),
      JSON.stringify(invalid),
    ]) {
      await writeFile(cache, content)
      read.mockClear()
      expect(await scanSessions('pi', roots, cache)).toEqual(expected)
      expect(read).toHaveBeenCalledOnce()
    }
    read.mockClear()
    expect(await scanSessions('pi', roots, cache)).toEqual(expected)
    expect(read).not.toHaveBeenCalled()
    expect(expected.skippedRecords).toBe(1)
  })

  it('does not cache a session that changes during parsing or reuse an unreadable changed file', async () => {
    const roots = [join(root, 'sessions')]
    const cache = join(root, 'cache.json')
    const source = join(roots[0], 'a.jsonl')
    await jsonl(source, [row('a')])
    const fingerprint = vi
      .spyOn(sessionCache, 'sessionFingerprint')
      .mockResolvedValueOnce('before')
      .mockResolvedValueOnce('after')
    expect((await scanSessions('pi', roots, cache)).records).toHaveLength(1)
    expect(JSON.parse(await readFile(cache, 'utf8')).files).toEqual([])
    fingerprint.mockRestore()
    await scanSessions('pi', roots, cache)

    await jsonl(source, [row('a', 30)])
    const read = vi.mocked(fs.createReadStream).mockImplementationOnce(() => {
      throw new Error('unreadable')
    })
    expect(await scanSessions('pi', roots, cache)).toEqual({
      records: [],
      skippedFiles: 1,
      skippedRecords: 0,
    })
    read.mockRestore()
    expect((await scanSessions('pi', roots, cache)).records[0].tokens.total).toBe(35)
  })

  it('still returns statistics when the cache directory is not writable', async () => {
    await jsonl(join(root, 'a.jsonl'), [row('a')])
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'not a directory')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await scanSessions('pi', [root], join(blocked, 'pi.json'))).records).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith('无法保存统计缓存，本次统计仍可用。')
  })
})

describe('clearing analytics cache', () => {
  it('clears every Agent cache without touching sessions, prices or another profile', async () => {
    const directory = join(root, 'cache', 'usage-analytics')
    const other = join(root, 'other-profile', 'usage-analytics', 'pi.json')
    const source = join(root, 'sessions', 'one.jsonl')
    const pricing = join(root, 'model-pricing.json')
    await jsonl(source, [{ private: 'session contents' }])
    await mkdir(directory, { recursive: true })
    await mkdir(join(other, '..'), { recursive: true })
    await writeFile(other, 'other profile')
    const prices = new ModelPrices(pricing)
    await prices.save(price, false)
    for (const product of ['pi', 'codex', 'claude', 'grok'])
      await writeFile(join(directory, `${product}.json`), 'cached usage')
    const service = new UsageAnalyticsService(prices, directory)
    const clearing = service.clearCache()
    expect(service.clearCache()).toBe(clearing)
    await clearing
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(source, 'utf8')).toContain('session contents')
    expect(await prices.list()).toEqual([price])
    expect(await readFile(other, 'utf8')).toBe('other profile')
    await expect(service.clearCache()).resolves.toBeUndefined()
    service.dispose()
  })

  it('waits for active and cancelled workers before deleting, then releases queued queries', async () => {
    const directory = join(root, 'cache')
    await mkdir(directory)
    await writeFile(join(directory, 'pi.json'), 'old cache')
    const prices = new ModelPrices(join(root, 'prices.json'))
    vi.spyOn(prices, 'list').mockResolvedValue([])
    const service = new UsageAnalyticsService(prices, directory)
    const empty = aggregateUsage(
      { records: [], skippedFiles: 0, skippedRecords: 0 },
      'all',
      [],
      now,
    )
    const first = service.query('pi', 'today').catch((error: Error) => error.message)
    await vi.waitFor(() => expect(Worker).toHaveBeenCalledTimes(1))
    const oldWorker = vi.mocked(Worker).mock.instances[0]
    let finishStopping!: (code: number) => void
    const stopping = new Promise<number>((resolve) => {
      finishStopping = resolve
    })
    vi.mocked(oldWorker).terminate.mockReturnValue(stopping)
    const second = service.query('codex', '7d')
    await vi.waitFor(() => expect(Worker).toHaveBeenCalledTimes(2))
    const clearing = service.clearCache()
    const queued = service.query('pi', 'all')
    vi.mocked(Worker).mock.instances[1].emit('message', { ok: true, value: empty })
    await second
    expect(Worker).toHaveBeenCalledTimes(2)
    expect(await readFile(join(directory, 'pi.json'), 'utf8')).toBe('old cache')
    await writeFile(join(directory, 'pi.json'), 'late worker write')
    finishStopping(0)
    await clearing
    expect(await first).toBe('统计已取消。')
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await vi.waitFor(() => expect(Worker).toHaveBeenCalledTimes(3))
    vi.mocked(Worker).mock.instances[2].emit('message', { ok: true, value: empty })
    expect(await queued).toEqual(empty)
    service.dispose()
  })

  it('reports deletion failures, permits retry and does not run queued queries after disposal', async () => {
    const blocked = join(root, 'blocked')
    const directory = join(blocked, 'cache')
    await writeFile(blocked, 'not a directory')
    const service = new UsageAnalyticsService(new ModelPrices(join(root, 'prices.json')), directory)
    await expect(service.clearCache()).rejects.toThrow('无法清除统计分析缓存')
    await rm(blocked)
    await mkdir(directory, { recursive: true })
    const clearing = service.clearCache()
    const queued = service.query('pi', 'today')
    service.dispose()
    await clearing
    await expect(queued).rejects.toThrow('统计已取消。')
    expect(Worker).not.toHaveBeenCalled()
  })
})

describe('model pricing', () => {
  it('saves atomically, rejects accidental replacement and does not overwrite imported prices', async () => {
    const store = new ModelPrices(join(root, 'prices.json'))
    await store.save(price, false)
    await expect(store.save({ ...price, input: 9 }, false)).rejects.toThrow('已存在')
    expect(
      await store.import([
        { ...price, input: 9 },
        { ...price, model: 'model-b' },
      ]),
    ).toBe(1)
    expect(await store.list()).toEqual([price, { ...price, model: 'model-b' }])
    await store.save({ ...price, input: 3 }, true)
    await store.remove({ provider: 'openai', model: 'model-b' })
    expect((await store.list())[0].input).toBe(3)
  })

  it('keeps an unreadable pricing file intact', async () => {
    const path = join(root, 'prices.json')
    await writeFile(path, '{broken')
    const store = new ModelPrices(path)
    await expect(store.save(price, false)).rejects.toThrow('原文件已保留')
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })

  it('imports missing model prices as unknown rather than free', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            openai: {
              models: { 'model-a': { cost: { input: 2, output: 10, cache_read: 0.2 } } },
            },
          }),
        ),
      ),
    )
    expect(await fetchModelPrices()).toEqual([
      {
        provider: 'openai',
        model: 'model-a',
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: null,
      },
    ])
    expect(fetch).toHaveBeenCalledOnce()
  })
})
