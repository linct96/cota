import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { AccountProfile } from '../../shared/accounts'
import { providersFileSchema, storedAccountSchema } from './schema'
import type { ProvidersFile } from './schema'

export interface StoredAccount extends Omit<AccountProfile, 'isActive'> {
  auth: string
  sortOrder: number
}

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function checksum(contents: string | null): string | null {
  return contents === null ? null : createHash('sha256').update(contents).digest('hex')
}

// Persist an entire snapshot instead of saving individual accounts, so transactions
// are all-or-nothing. Temporary files and the destination must share a directory.
function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)
    // Some platforms cannot fsync directories; the file itself is synced above.
    try {
      const directory = openSync(dirname(path), 'r')
      try {
        fsyncSync(directory)
      } finally {
        closeSync(directory)
      }
    } catch {
      // Directory fsync is not available on every supported filesystem.
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export class AccountStore {
  private accounts?: StoredAccount[]
  private draft?: StoredAccount[]
  private revision: string | null = null

  constructor(private readonly path: string) {}

  private requireEncryption(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('系统凭据加密不可用，无法保存账号。请先启用系统凭据存储。')
  }

  private load(): StoredAccount[] {
    if (this.accounts) return this.accounts
    const contents = readOptional(this.path)
    if (contents === null) {
      this.accounts = []
      this.revision = null
      return this.accounts
    }
    try {
      const stored = providersFileSchema.parse(JSON.parse(contents))
      if (stored.accounts.length) this.requireEncryption()
      const accounts = stored.accounts.map(({ authEncrypted, ...account }) =>
        storedAccountSchema.parse({
          ...account,
          auth: safeStorage.decryptString(Buffer.from(authEncrypted.data, 'base64')),
        }),
      )
      this.accounts = accounts
      this.revision = checksum(contents)
      return accounts
    } catch (error) {
      throw new Error('账号配置文件无效或无法解密，原文件已保留：' + this.path, {
        cause: error,
      })
    }
  }

  list(): StoredAccount[] {
    return structuredClone(this.draft ?? this.load()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.updatedAt - b.updatedAt,
    )
  }

  get(id: string): StoredAccount {
    const account = this.list().find((entry) => entry.id === id)
    if (!account) throw new Error('账号不存在，请刷新后重试。')
    return account
  }

  private persist(accounts: StoredAccount[]): void {
    const normalized = accounts.map((account) => storedAccountSchema.parse(account))
    if (normalized.length) this.requireEncryption()
    const document: ProvidersFile = providersFileSchema.parse({
      schemaVersion: 1,
      accounts: normalized.map(({ auth, ...account }) => ({
        ...account,
        authEncrypted: {
          scheme: 'electron-safeStorage',
          encoding: 'base64',
          data: safeStorage.encryptString(auth).toString('base64'),
        },
      })),
    })
    const current = readOptional(this.path)
    if (checksum(current) !== this.revision) {
      // An external editor changed providers.json. Never overwrite it with stale data.
      this.accounts = undefined
      throw new Error('账号配置已被其他程序修改，请刷新后重试。')
    }
    const serialized = JSON.stringify(document, null, 2) + '\n'
    writeAtomic(this.path, serialized)
    this.accounts = structuredClone(normalized)
    this.revision = checksum(serialized)
  }

  private change(action: (accounts: StoredAccount[]) => void): void {
    if (this.draft) {
      action(this.draft)
      return
    }
    const next = structuredClone(this.load())
    action(next)
    this.persist(next)
  }

  save(account: StoredAccount): void {
    const valid = storedAccountSchema.parse(account)
    this.change((accounts) => {
      const index = accounts.findIndex((entry) => entry.id === valid.id)
      if (index === -1) accounts.push(valid)
      else accounts[index] = valid
    })
  }

  remove(id: string): void {
    this.change((accounts) => {
      const index = accounts.findIndex((entry) => entry.id === id)
      if (index !== -1) accounts.splice(index, 1)
    })
  }

  transaction(action: () => void): void {
    if (this.draft) throw new Error('不支持嵌套账号事务。')
    const draft = structuredClone(this.load())
    this.draft = draft
    try {
      action()
      this.persist(draft)
    } finally {
      this.draft = undefined
    }
  }

  close(): void {
    this.accounts = undefined
    this.draft = undefined
    this.revision = null
  }
}
