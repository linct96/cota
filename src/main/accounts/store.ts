import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { safeStorage } from 'electron'
import { z } from 'zod'
import type { AccountProfile, AccountUsageWindow } from '../../shared/accounts'
import { accountProductSchema } from '../../shared/accounts'
import { object, text } from './files'
import { normalizeCredential } from './credentials'

export interface StoredAccount extends Omit<AccountProfile, 'isActive'> {
  auth: string
  sortOrder: number
}

const usageWindowSchema = z.object({
  usedPercent: z.number(),
  windowMinutes: z.number().nullable(),
  resetsAt: z.number().nullable(),
})

function parseUsage(value: unknown): AccountUsageWindow | null {
  try {
    return usageWindowSchema.safeParse(JSON.parse(String(value))).data ?? null
  } catch {
    return null
  }
}

export class AccountStore {
  private connection?: DatabaseSync
  constructor(private readonly path: string) {}

  private db(): DatabaseSync {
    if (!this.connection) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      const connection = new DatabaseSync(this.path)
      try {
        connection.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
          CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY, product TEXT NOT NULL, provider_key TEXT NOT NULL DEFAULT '',
            account_type TEXT NOT NULL CHECK(account_type IN ('oauth', 'relay')),
            alias TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '',
            plan_type TEXT NOT NULL DEFAULT '', api_base_url TEXT, auth_encrypted BLOB NOT NULL,
            usage_primary TEXT, usage_secondary TEXT, usage_updated_at INTEGER,
            updated_at INTEGER NOT NULL, last_used_at INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
            needs_reauthorization INTEGER NOT NULL DEFAULT 0, switch_unavailable TEXT
          );
          CREATE INDEX IF NOT EXISTS accounts_product_order ON accounts(product, sort_order);`)
        this.connection = connection
      } catch (error) {
        connection.close()
        throw error
      }
    }
    return this.connection
  }

  private requireEncryption(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('系统凭据加密不可用，无法保存账号。请先启用系统凭据存储。')
  }

  list(): StoredAccount[] {
    const rows = this.db().prepare('SELECT * FROM accounts ORDER BY sort_order, updated_at').all()
    return rows
      .filter((row) => accountProductSchema.safeParse(row.product).success)
      .map((row) => {
        this.requireEncryption()
        return {
          id: String(row.id),
          product: accountProductSchema.parse(row.product),
          providerKey: String(row.provider_key),
          accountType: row.account_type === 'relay' ? ('relay' as const) : ('oauth' as const),
          alias: String(row.alias),
          email: String(row.email),
          accountId: String(row.account_id),
          planType: String(row.plan_type),
          apiBaseUrl: row.api_base_url === null ? null : String(row.api_base_url),
          auth: safeStorage.decryptString(Buffer.from(row.auth_encrypted as Uint8Array)),
          usagePrimary: parseUsage(row.usage_primary),
          usageSecondary: parseUsage(row.usage_secondary),
          usageUpdatedAt: row.usage_updated_at === null ? null : Number(row.usage_updated_at),
          updatedAt: Number(row.updated_at),
          lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
          sortOrder: Number(row.sort_order),
          needsReauthorization: !!row.needs_reauthorization,
          ...(row.switch_unavailable ? { switchUnavailable: String(row.switch_unavailable) } : {}),
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.updatedAt - b.updatedAt)
  }

  get(id: string): StoredAccount {
    const account = this.list().find((entry) => entry.id === id)
    if (!account) throw new Error('账号不存在，请刷新后重试。')
    return account
  }

  save(account: StoredAccount): void {
    this.requireEncryption()
    this.db()
      .prepare(`INSERT INTO accounts (id, product, provider_key, account_type, alias, email, account_id,
      plan_type, api_base_url, auth_encrypted, usage_primary, usage_secondary, usage_updated_at, updated_at,
      last_used_at, sort_order, needs_reauthorization, switch_unavailable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET alias=excluded.alias, email=excluded.email, account_id=excluded.account_id,
      plan_type=excluded.plan_type, api_base_url=excluded.api_base_url, auth_encrypted=excluded.auth_encrypted,
      usage_primary=excluded.usage_primary, usage_secondary=excluded.usage_secondary,
      usage_updated_at=excluded.usage_updated_at, updated_at=excluded.updated_at,
      last_used_at=excluded.last_used_at, sort_order=excluded.sort_order,
      needs_reauthorization=excluded.needs_reauthorization, switch_unavailable=excluded.switch_unavailable`)
      .run(
        account.id,
        account.product,
        account.providerKey,
        account.accountType,
        account.alias,
        account.email,
        account.accountId,
        account.planType,
        account.apiBaseUrl,
        safeStorage.encryptString(account.auth),
        account.usagePrimary ? JSON.stringify(account.usagePrimary) : null,
        account.usageSecondary ? JSON.stringify(account.usageSecondary) : null,
        account.usageUpdatedAt,
        account.updatedAt,
        account.lastUsedAt,
        account.sortOrder,
        Number(account.needsReauthorization),
        account.switchUnavailable ?? null,
      )
  }

  transaction(action: () => void): void {
    const connection = this.db()
    connection.exec('BEGIN IMMEDIATE')
    try {
      action()
      connection.exec('COMMIT')
    } catch (error) {
      connection.exec('ROLLBACK')
      throw error
    }
  }

  remove(id: string): void {
    this.db().prepare('DELETE FROM accounts WHERE id=?').run(id)
  }
  close(): void {
    this.connection?.close()
    this.connection = undefined
  }
}

export const cortanaDatabase = () => join(homedir(), '.cortana', 'app.sqlite3')

// The original database is opened read-only. Importing never migrates its schema or modifies it.
export function readCortanaAccounts(path: string): StoredAccount[] {
  const connection = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = connection.prepare('SELECT * FROM accounts ORDER BY sort_order, created_at').all()
    const accounts = rows
      .filter((row) => accountProductSchema.safeParse(row.product).success)
      .map((row): StoredAccount => {
        const product = accountProductSchema.parse(row.product)
        const usage = (kind: string) => {
          const percent = row[`usage_${kind}_percent`]
          if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
          return {
            usedPercent: percent,
            windowMinutes: Number(row[`usage_${kind}_window_minutes`]) || null,
            resetsAt: Number(row[`usage_${kind}_resets_at`]) || null,
          }
        }
        const protocol = text(row.upstream_protocol) || 'openaiResponses'
        const auth = String(row.auth_json)
        const credential = object(JSON.parse(auth))
        let incompatiblePi = false
        if (product === 'pi' && row.account_type !== 'relay') {
          try {
            normalizeCredential(product, credential, text(row.provider_key))
          } catch {
            incompatiblePi = true
          }
        }
        const needsGateway =
          product === 'codex' &&
          row.account_type === 'relay' &&
          (protocol !== 'openaiResponses' || row.upstream_auth_mode === 'xApiKey')
        return {
          id: String(row.id),
          product,
          providerKey: text(row.provider_key),
          accountType: row.account_type === 'relay' ? 'relay' : 'oauth',
          alias: text(row.alias) || text(row.email) || '未命名账号',
          email: text(row.email),
          accountId: text(row.account_id),
          planType: text(row.plan_type),
          apiBaseUrl: text(row.api_base_url) || null,
          usagePrimary: usage('primary'),
          usageSecondary: usage('secondary'),
          usageUpdatedAt: Number(row.usage_updated_at) || null,
          updatedAt: Number(row.updated_at) || Date.now(),
          lastUsedAt: Number(row.last_used_at) || null,
          needsReauthorization: !!row.oauth_invalidated_at,
          sortOrder: Number(row.sort_order) || 0,
          auth,
          ...(needsGateway
            ? { switchUnavailable: '此账号依赖 Cortana 协议转换网关，待网关模块接入后可切换。' }
            : {}),
          ...(product === 'pi' && row.account_type === 'relay'
            ? { switchUnavailable: '此账号依赖自定义模型配置，待模型模块接入后可切换。' }
            : {}),
          ...(product === 'grok' && row.account_type === 'relay'
            ? { switchUnavailable: '此账号依赖 Grok 自定义模型配置，待模型模块接入后可切换。' }
            : {}),
          ...(incompatiblePi ? { switchUnavailable: '此 Pi 账号的凭据格式需要重新导入。' } : {}),
        }
      })
    return accounts
  } finally {
    connection.close()
  }
}
