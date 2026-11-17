import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateUsage } from '../../../src/main/analytics/aggregate'
import { ModelPrices, fetchModelPrices } from '../../../src/main/analytics/pricing'
import { scanSessions } from '../../../src/main/analytics/sessions'
import { sessionRoots } from '../../../src/main/analytics/service'
import type { ModelPrice } from '../../../src/shared/usage-analytics'

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

beforeEach(async () => {
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
    const scan = await scanSessions('codex', [
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
    const scan = await scanSessions('claude', [join(root, 'projects')])
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
      await scanSessions('pi', [join(root, 'sessions')]),
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
      await scanSessions('grok', [join(root, 'sessions')]),
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
