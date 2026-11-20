import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { z } from 'zod'
import { hostingAccountNameSchema, hostingHostSchema } from '../../shared/code-hosting'
import type {
  HostingAccountsCacheEntry,
  HostingAccountsCacheSnapshot,
  HostingProvider,
} from '../../shared/code-hosting'
import { writePrivate } from '../accounts/files'

const accountSchema = z
  .object({
    host: hostingHostSchema,
    account: hostingAccountNameSchema,
    active: z.boolean(),
    status: z.enum(['connected', 'error']),
  })
  .strict()
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('detected'), accounts: z.array(accountSchema) }).strict(),
  z.object({ status: z.literal('disconnected'), message: z.string().max(2000) }).strict(),
  z.object({ status: z.literal('cli-unavailable'), message: z.string().max(2000) }).strict(),
])
const entrySchema = z
  .object({
    result: resultSchema.optional(),
    failed: z.boolean(),
    cliUnavailable: z.boolean().optional(),
    // 兼容旧版缓存，重新检测时不再屏蔽本机登录。
    removed: z.unknown().optional(),
  })
  .strict()
  .refine((entry) => entry.result !== undefined || entry.failed)
  .transform(({ removed: _removed, ...entry }) => entry)
const fileSchema = z
  .object({
    version: z.literal(1),
    entries: z.object({ github: entrySchema.optional(), gitlab: entrySchema.optional() }).strict(),
  })
  .strict()
const maxFileSize = 16 * 1024 * 1024

export class HostingAccountsCache {
  private entries: HostingAccountsCacheSnapshot['entries'] = {}
  private error?: string
  private blocked = false
  private loading?: Promise<void>
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly file?: string) {}

  private async load(): Promise<void> {
    if (!this.file) return
    try {
      const before = await lstat(this.file)
      if (!before.isFile() || before.size > maxFileSize) throw new Error('Invalid cache file')
      const handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const current = await handle.stat()
        if (
          !current.isFile() ||
          current.size > maxFileSize ||
          before.dev !== current.dev ||
          before.ino !== current.ino
        )
          throw new Error('Invalid cache file')
        const content = await handle.readFile('utf8')
        if (Buffer.byteLength(content) > maxFileSize) throw new Error('Invalid cache file')
        this.entries = fileSchema.parse(JSON.parse(content)).entries
      } finally {
        await handle.close()
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
      this.blocked = true
      this.error = `无法读取代码托管缓存，请检查 ${this.file}；检测结果无法持久保存。`
    }
  }

  private initialize(): Promise<void> {
    return (this.loading ||= this.load())
  }

  async read(): Promise<HostingAccountsCacheSnapshot> {
    await this.initialize()
    await this.queue
    return structuredClone({
      entries: this.entries,
      ...(this.error ? { error: this.error } : {}),
    })
  }

  async update(
    provider: HostingProvider,
    change: (previous: HostingAccountsCacheEntry | undefined) => HostingAccountsCacheEntry,
  ): Promise<void> {
    await this.initialize()
    const operation = this.queue.then(async () => {
      const entry = entrySchema.parse(change(structuredClone(this.entries[provider])))
      this.entries = { ...this.entries, [provider]: entry }
      if (!this.file || this.blocked) return
      try {
        const content = `${JSON.stringify({ version: 1, entries: this.entries })}\n`
        if (Buffer.byteLength(content) > maxFileSize) throw new Error('Cache is too large')
        await writePrivate(this.file, content)
        this.error = undefined
      } catch {
        this.error = `无法保存代码托管缓存，请检查 ${this.file} 所在目录。`
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
