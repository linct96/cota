import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import type { AccountProfile } from '../../shared/accounts'
import { oauthFileSchema, providersFileSchema, storedAccountSchema } from './schema'
import type { OAuthFile, ProvidersFile } from './schema'

export interface StoredAccount extends Omit<AccountProfile, 'isActive'> {
  auth: string
  sortOrder: number
}

type Contents = { providers: string | null; oauth: string | null }
type Revision = Contents
type FileStamp = { size: number; mtimeMs: number; ctimeMs: number; ino: number }
type Stamps = { providers: FileStamp | null; oauth: FileStamp | null }
type Credentials = OAuthFile['credentials']

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

function revisionOf(contents: Contents): Revision {
  return { providers: checksum(contents.providers), oauth: checksum(contents.oauth) }
}

function sameRevision(a: Revision, b: Revision): boolean {
  return a.providers === b.providers && a.oauth === b.oauth
}

function stampOf(path: string): FileStamp | null {
  try {
    const stat = statSync(path)
    return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  return (
    a?.size === b?.size &&
    a?.mtimeMs === b?.mtimeMs &&
    a?.ctimeMs === b?.ctimeMs &&
    a?.ino === b?.ino
  )
}

function sameStamps(a: Stamps, b: Stamps): boolean {
  return sameStamp(a.providers, b.providers) && sameStamp(a.oauth, b.oauth)
}

// A just-written file may still have a coarse timestamp. Compare its bytes
// for a short period; once settled, stat is enough for ordinary reads.
function settled(stamp: FileStamp | null): boolean {
  return stamp === null || Date.now() - Math.max(stamp.mtimeMs, stamp.ctimeMs) > 2_000
}

function sameCredentials(a: Credentials, b: Credentials): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  )
}

// File locks are shared by both stores, always acquired in the same order.
// Non-cooperating editors are additionally detected by a full-file hash
// immediately before each rename.
function withLocks(paths: string[], action: () => void): void {
  const releases: (() => void)[] = []
  try {
    for (const path of [...new Set(paths)].sort()) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try {
        releases.push(lockSync(path, { realpath: false }))
      } catch (error) {
        throw new Error(
          (error as NodeJS.ErrnoException).code === 'ELOCKED'
            ? '账号配置正在写入，请稍后重试。'
            : '无法锁定账号配置文件，请检查目录权限。',
          { cause: error },
        )
      }
    }
    action()
  } finally {
    for (const release of releases.reverse()) {
      try {
        release()
      } catch {
        console.warn('无法释放账号配置锁。')
      }
    }
  }
}

// Both files are independently written through an fsynced temporary file.
// A staged OAuth superset keeps every provider's credentials available while
// an operation spanning both files is in progress (or interrupted by a crash).
function writeAtomic(path: string, contents: string, assertUnchanged?: () => void): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    assertUnchanged?.()
    renameSync(temporary, path)
    // Some platforms cannot fsync directories; the file is synced above.
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
    // Cleanup must not mask a write error or report a committed write as rolled back.
    try {
      if (descriptor !== undefined) closeSync(descriptor)
    } catch {
      console.warn('无法关闭账号配置临时文件：' + temporary)
    }
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('无法清理账号配置临时文件：' + temporary)
    }
  }
}

function restore(path: string, contents: string | null, assertUnchanged: () => void): void {
  if (contents !== null) {
    writeAtomic(path, contents, assertUnchanged)
    return
  }
  assertUnchanged()
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export class AccountStore {
  private readonly oauthPath: string
  private accounts?: StoredAccount[]
  private credentials?: Credentials
  private draft?: StoredAccount[]
  private contents?: Contents
  private revision?: Revision
  private stamps?: Stamps

  constructor(private readonly path: string) {
    this.oauthPath = join(dirname(path), 'OAuth.json')
  }

  private observe(): Stamps {
    return { providers: stampOf(this.path), oauth: stampOf(this.oauthPath) }
  }

  private readPair(): { contents: Contents; stamps: Stamps } {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.observe()
      const contents = {
        providers: readOptional(this.path),
        oauth: readOptional(this.oauthPath),
      }
      const after = this.observe()
      if (sameStamps(before, after)) return { contents, stamps: after }
    }
    throw new Error('账号配置正在被其他程序修改，请稍后重试。')
  }

  private invalidate(): void {
    this.accounts = undefined
    this.credentials = undefined
    this.contents = undefined
    this.revision = undefined
    this.stamps = undefined
  }

  private load(): StoredAccount[] {
    const now = this.observe()
    if (
      this.accounts &&
      this.stamps &&
      sameStamps(this.stamps, now) &&
      settled(now.providers) &&
      settled(now.oauth)
    )
      return this.accounts

    const { contents, stamps } = this.readPair()
    const revision = revisionOf(contents)
    if (this.accounts && this.revision && sameRevision(this.revision, revision)) {
      this.stamps = stamps
      return this.accounts
    }

    this.invalidate()
    try {
      const providers: ProvidersFile =
        contents.providers === null
          ? { schemaVersion: 1, accounts: [] }
          : providersFileSchema.parse(JSON.parse(contents.providers))
      const vault: OAuthFile =
        contents.oauth === null
          ? { schemaVersion: 2, credentials: {} }
          : oauthFileSchema.parse(JSON.parse(contents.oauth))
      const accounts = providers.accounts.map((account) => {
        if (!Object.hasOwn(vault.credentials, account.id))
          throw new Error('OAuth.json 缺少账号 ' + account.id + ' 的认证信息。')
        return storedAccountSchema.parse({
          ...account,
          auth: vault.credentials[account.id],
        })
      })
      this.accounts = accounts
      this.credentials = { ...vault.credentials }
      this.contents = contents
      this.revision = revision
      this.stamps = stamps
      return accounts
    } catch (error) {
      throw new Error(
        '账号配置或认证文件无效、缺失或版本不兼容，原文件已保留：' +
          this.path +
          ' / ' +
          this.oauthPath,
        { cause: error },
      )
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
    const before = this.accounts ?? this.load()
    const oldCredentials = this.credentials!
    const oldContents = this.contents!
    const previousRevision = this.revision!
    const normalized = accounts.map((account) => storedAccountSchema.parse(account))
    const metadata = normalized.map(({ auth: _auth, ...account }) => account)
    const previousMetadata = before.map(({ auth: _auth, ...account }) => account)
    const providers: ProvidersFile = providersFileSchema.parse({
      schemaVersion: 1,
      accounts: metadata,
    })
    const providersChanged =
      oldContents.providers === null ||
      JSON.stringify(metadata) !== JSON.stringify(previousMetadata)

    const nextCredentials: Credentials = Object.fromEntries(
      normalized.map((account) => [account.id, account.auth]),
    )

    // First write a superset of old and new credentials, then providers.json,
    // finally remove stale credentials. Every crash point remains readable:
    // providers.json never references a credential absent from OAuth.json.
    const staged: Credentials = { ...oldCredentials, ...nextCredentials }
    const stageChanged = !sameCredentials(oldCredentials, staged)
    const cleanupNeeded = !sameCredentials(staged, nextCredentials)
    const providersText = JSON.stringify(providers, null, 2) + '\n'
    const stageText =
      JSON.stringify(oauthFileSchema.parse({ schemaVersion: 2, credentials: staged }), null, 2) +
      '\n'
    const finalText =
      JSON.stringify(
        oauthFileSchema.parse({ schemaVersion: 2, credentials: nextCredentials }),
        null,
        2,
      ) + '\n'

    let expected = { ...previousRevision }
    let stagedWritten = false
    let providersWritten = false
    withLocks([this.path, this.oauthPath], () => {
      const assertUnchanged = () => {
        const actual = revisionOf({
          providers: readOptional(this.path),
          oauth: readOptional(this.oauthPath),
        })
        if (!sameRevision(actual, expected)) {
          this.invalidate()
          throw new Error('账号配置或认证文件已被其他程序修改，请刷新后重试。')
        }
      }
      const write = (which: keyof Contents, value: string) => {
        assertUnchanged()
        writeAtomic(which === 'providers' ? this.path : this.oauthPath, value, assertUnchanged)
        expected = { ...expected, [which]: checksum(value) }
      }

      assertUnchanged()
      try {
        if (stageChanged) {
          write('oauth', stageText)
          stagedWritten = true
        }
        if (providersChanged) {
          write('providers', providersText)
          providersWritten = true
        }
        if (cleanupNeeded) write('oauth', finalText)
      } catch (error) {
        // Roll back in reverse dependency order when possible. If a crash
        // or uncooperative writer intervened, retain the staged superset:
        // it is preferable to deleting a credential still in use.
        let canRestoreOAuth = true
        if (providersWritten) {
          try {
            assertUnchanged()
            restore(this.path, oldContents.providers, assertUnchanged)
            expected.providers = checksum(oldContents.providers)
          } catch {
            canRestoreOAuth = false
            console.warn('无法恢复原账号配置；保留现有认证数据。')
          }
        }
        if (stagedWritten && canRestoreOAuth) {
          try {
            assertUnchanged()
            restore(this.oauthPath, oldContents.oauth, assertUnchanged)
            expected.oauth = checksum(oldContents.oauth)
          } catch {
            console.warn('无法恢复原认证文件，请检查 OAuth.json。')
          }
        }
        this.invalidate()
        throw error
      }
    })

    this.accounts = structuredClone(normalized)
    this.credentials = nextCredentials
    this.contents = {
      providers: providersChanged ? providersText : oldContents.providers,
      oauth: stageChanged || cleanupNeeded ? finalText : oldContents.oauth,
    }
    this.revision = expected
    this.stamps = this.observe()
  }

  private change(action: (accounts: StoredAccount[]) => void): void {
    if (this.draft) {
      action(this.draft)
      return
    }
    const next = structuredClone(this.accounts ?? this.load())
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
    const draft = structuredClone(this.accounts ?? this.load())
    this.draft = draft
    try {
      action()
      this.persist(draft)
    } finally {
      this.draft = undefined
    }
  }

  close(): void {
    this.invalidate()
    this.draft = undefined
  }
}
