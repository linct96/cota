import { lstat, readFile } from 'node:fs/promises'
import { z } from 'zod'
import { accountProductSchema } from '../../shared/accounts'
import type { AccountProduct } from '../../shared/accounts'
import type { UsageRecord } from './sessions'
import { writePrivate } from '../accounts/files'

const count = z.number().int().nonnegative()
const tokens = z.strictObject({
  input: count,
  output: count,
  cacheRead: count.nullable(),
  cacheWrite: count.nullable(),
  reasoning: count.nullable(),
  total: count,
})
const record = z.strictObject({
  timestamp: z.number().finite(),
  session: z.string(),
  turn: z.string(),
  tokens,
  parts: z.array(
    z.strictObject({
      provider: z.string().max(200),
      model: z.string().max(200),
      tokens,
      cost: z.number().finite().nonnegative().nullable(),
      turns: count,
    }),
  ),
  turns: count,
})
const cacheSchema = z.strictObject({
  // Bump when session parsing or deduplication rules change.
  version: z.literal(1),
  product: accountProductSchema,
  roots: z.array(z.string()),
  files: z.array(
    z.tuple([
      z.string(),
      z.strictObject({
        fingerprint: z.string(),
        records: z.array(z.tuple([z.string(), record])).max(500_000),
        skippedRecords: count,
      }),
    ]),
  ),
})

export interface CachedSession {
  fingerprint: string
  records: [string, UsageRecord][]
  skippedRecords: number
}

export async function sessionFingerprint(path: string): Promise<string> {
  const info = await lstat(path, { bigint: true })
  if (!info.isFile()) throw new Error('会话不是普通文件。')
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

export async function readSessionCache(
  path: string | undefined,
  product: AccountProduct,
  roots: string[],
): Promise<Map<string, CachedSession>> {
  if (path) {
    try {
      const cache = cacheSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (cache.product === product && JSON.stringify(cache.roots) === JSON.stringify(roots))
        return new Map(cache.files)
    } catch {
      // Missing, incompatible or damaged caches are rebuilt from the source files.
    }
  }
  return new Map()
}

export async function writeSessionCache(
  path: string,
  product: AccountProduct,
  roots: string[],
  files: Map<string, CachedSession>,
): Promise<void> {
  try {
    await writePrivate(path, JSON.stringify({ version: 1, product, roots, files: [...files] }))
  } catch {
    console.warn('无法保存统计缓存，本次统计仍可用。')
  }
}
