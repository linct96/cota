import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsyncSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import type * as FsModule from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { AccountStore } from '../src/main/accounts/store'
import type { StoredAccount } from '../src/main/accounts/store'

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof FsModule>()
  return {
    ...fs,
    fsyncSync: vi.fn(fs.fsyncSync),
    renameSync: vi.fn(fs.renameSync),
    unlinkSync: vi.fn(fs.unlinkSync),
  }
})

const mockEncryption = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockEncryption.available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from('sealed:' + value, 'utf8'),
    decryptString: (value: Buffer) => {
      const raw = value.toString('utf8')
      if (!raw.startsWith('sealed:')) throw new Error('Invalid credential')
      return raw.slice('sealed:'.length)
    },
  },
}))

let root: string
let path: string
let oauthPath: string

function account(id: string): StoredAccount {
  return {
    id,
    product: 'codex',
    providerKey: '',
    accountType: 'oauth',
    alias: id,
    email: 'user@example.com',
    accountId: 'abc',
    planType: 'plus',
    apiBaseUrl: null,
    auth: '{"tokens":{"access_token":"TOP-SECRET"}}',
    usagePrimary: null,
    usageSecondary: null,
    usageUpdatedAt: null,
    updatedAt: 100,
    lastUsedAt: null,
    sortOrder: 0,
    needsReauthorization: false,
  }
}

function readVault(): { schemaVersion: number; credentials: Record<string, unknown> } {
  return JSON.parse(readFileSync(oauthPath, 'utf8'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cota-providers-'))
  path = join(root, 'providers.json')
  oauthPath = join(root, 'OAuth.json')
  mockEncryption.available = true
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('Cortana providers.json and OAuth.json store', () => {
  it('keeps provider metadata and encrypted credentials in separate private files', () => {
    const store = new AccountStore(path)
    expect(store.list()).toEqual([])
    store.save(account('first'))
    const raw = readFileSync(path, 'utf8')
    const vault = readFileSync(oauthPath, 'utf8')
    expect(raw).not.toContain('TOP-SECRET')
    expect(raw).not.toContain('authEncrypted')
    expect(raw).not.toContain('"auth"')
    expect(vault).not.toContain('TOP-SECRET')
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      accounts: [{ id: 'first', alias: 'first' }],
    })
    expect(JSON.parse(vault)).toMatchObject({
      schemaVersion: 1,
      credentials: { first: { scheme: 'electron-safeStorage', encoding: 'base64' } },
    })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(oauthPath).mode & 0o777).toBe(0o600)
    }
    expect(new AccountStore(path).get('first')).toEqual(account('first'))
  })

  it('writes only providers.json for metadata changes and only OAuth.json for auth changes', () => {
    const store = new AccountStore(path)
    store.save(account('first'))
    const vaultBefore = readFileSync(oauthPath, 'utf8')
    store.save({ ...store.get('first'), alias: 'renamed' })
    expect(readFileSync(oauthPath, 'utf8')).toBe(vaultBefore)
    const providersBefore = readFileSync(path, 'utf8')
    store.save({ ...store.get('first'), auth: '{"access_token":"NEW-SECRET"}' })
    expect(readFileSync(path, 'utf8')).toBe(providersBefore)
    expect(readFileSync(oauthPath, 'utf8')).not.toBe(vaultBefore)
    expect(new AccountStore(path).get('first')).toMatchObject({
      alias: 'renamed',
      auth: '{"access_token":"NEW-SECRET"}',
    })
  })

  it('supports ordering, deletion, and reading external file changes', () => {
    const store = new AccountStore(path)
    store.save(account('first'))
    store.save({ ...account('second'), sortOrder: -1 })
    expect(store.list().map((entry) => entry.id)).toEqual(['second', 'first'])
    store.remove('second')
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['first'])
    expect(Object.keys(readVault().credentials)).toEqual(['first'])
    unlinkSync(path)
    unlinkSync(oauthPath)
    expect(store.list()).toEqual([])
    store.save(account('third'))
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['third'])
  })

  it('commits a batch and exposes staged changes inside the transaction', () => {
    const store = new AccountStore(path)
    store.transaction(() => {
      store.save(account('a'))
      expect(store.get('a').id).toBe('a')
      store.save(account('b'))
      store.remove('a')
    })
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['b'])
    expect(Object.keys(readVault().credentials)).toEqual(['b'])
    expect(() => store.transaction(() => store.transaction(() => {}))).toThrow('嵌套')
  })

  it('rolls back a failed transaction and a failed credential write', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const before = readFileSync(path, 'utf8')
    const beforeOAuth = readFileSync(oauthPath, 'utf8')
    expect(() =>
      store.transaction(() => {
        store.save(account('b'))
        throw new Error('abort')
      }),
    ).toThrow('abort')
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(readFileSync(oauthPath, 'utf8')).toBe(beforeOAuth)

    const writeError = new Error('disk sync failed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw writeError
    })
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw new Error('cleanup failed')
    })
    expect(() => store.transaction(() => store.save(account('b')))).toThrow(writeError)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('无法清理'))
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(readFileSync(oauthPath, 'utf8')).toBe(beforeOAuth)
    expect(store.list().map((entry) => entry.id)).toEqual(['a'])
    store.save(account('b'))
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('rolls back staged credentials if writing providers.json fails', async () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const providersBefore = readFileSync(path, 'utf8')
    const oauthBefore = readFileSync(oauthPath, 'utf8')
    const real = await vi.importActual<typeof FsModule>('node:fs')
    vi.mocked(renameSync).mockImplementation((source, destination) => {
      if (destination === path) throw new Error('provider rename failed')
      real.renameSync(source, destination)
    })
    try {
      expect(() => store.save(account('b'))).toThrow('provider rename failed')
    } finally {
      vi.mocked(renameSync).mockImplementation(real.renameSync)
    }
    expect(readFileSync(path, 'utf8')).toBe(providersBefore)
    expect(readFileSync(oauthPath, 'utf8')).toBe(oauthBefore)
    expect(store.list().map((entry) => entry.id)).toEqual(['a'])
  })

  it('rolls back providers.json if removing credentials from OAuth.json fails', async () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    store.save(account('b'))
    const providersBefore = readFileSync(path, 'utf8')
    const oauthBefore = readFileSync(oauthPath, 'utf8')
    const real = await vi.importActual<typeof FsModule>('node:fs')
    vi.mocked(renameSync).mockImplementation((source, destination) => {
      if (destination === oauthPath) throw new Error('credential cleanup failed')
      real.renameSync(source, destination)
    })
    try {
      expect(() => store.remove('b')).toThrow('credential cleanup failed')
    } finally {
      vi.mocked(renameSync).mockImplementation(real.renameSync)
    }
    expect(readFileSync(path, 'utf8')).toBe(providersBefore)
    expect(readFileSync(oauthPath, 'utf8')).toBe(oauthBefore)
  })

  it('keeps corrupt, missing and unsupported files unchanged', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const providerGood = readFileSync(path, 'utf8')
    const oauthGood = readFileSync(oauthPath, 'utf8')
    for (const raw of [
      'not-json',
      '{"schemaVersion":2,"accounts":[]}',
      '{"schemaVersion":1,"accounts":"bad"}',
    ]) {
      writeFileSync(path, raw)
      expect(() => store.list()).toThrow('账号配置或认证文件无效')
      expect(() => store.save(account('b'))).toThrow('账号配置或认证文件无效')
      expect(readFileSync(path, 'utf8')).toBe(raw)
    }
    writeFileSync(path, providerGood)
    for (const raw of [
      'not-json',
      '{"schemaVersion":2,"credentials":{}}',
      '{"schemaVersion":1,"credentials":{}}',
    ]) {
      writeFileSync(oauthPath, raw)
      expect(() => store.list()).toThrow('账号配置或认证文件无效')
      expect(() => store.save(account('b'))).toThrow('账号配置或认证文件无效')
      expect(readFileSync(oauthPath, 'utf8')).toBe(raw)
    }
    unlinkSync(oauthPath)
    expect(() => store.list()).toThrow('账号配置或认证文件无效')
    writeFileSync(oauthPath, oauthGood)
    expect(store.list().map((entry) => entry.id)).toEqual(['a'])
  })

  it('detects edits to either file and never overwrites stale data', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const other = new AccountStore(path)
    other.save(account('b'))
    expect(() => store.save(account('c'))).toThrow('其他程序修改')
    expect(store.list().map((entry) => entry.id)).toEqual(['a', 'b'])
    other.save({ ...other.get('a'), auth: '{"token":"external"}' })
    expect(store.get('a').auth).toBe('{"token":"external"}')
    other.save({ ...other.get('a'), alias: 'external-edit' })
    expect(() => store.save(account('c'))).toThrow('其他程序修改')
    expect(store.get('a').alias).toBe('external-edit')
    expect(store.list().map((entry) => entry.id)).toEqual(['a', 'b'])

    const before = readFileSync(path, 'utf8')
    const beforeOAuth = readFileSync(oauthPath, 'utf8')
    const release = lockSync(path, { realpath: false })
    try {
      expect(() => store.save(account('c'))).toThrow('正在写入')
      expect(readFileSync(path, 'utf8')).toBe(before)
      expect(readFileSync(oauthPath, 'utf8')).toBe(beforeOAuth)
    } finally {
      release()
    }

    const external = '{"schemaVersion":1,"accounts":[]}\n'
    vi.mocked(fsyncSync).mockImplementationOnce(() => writeFileSync(path, external))
    expect(() => store.save(account('c'))).toThrow('其他程序修改')
    expect(readFileSync(path, 'utf8')).toBe(external)
    expect(store.list()).toEqual([])
    expect(readdirSync(root)).toEqual(['OAuth.json', 'providers.json'])
  })

  it('can read a safe staged OAuth superset after an interrupted addition', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const vault = readVault()
    vault.credentials.orphan = vault.credentials.a
    writeFileSync(oauthPath, JSON.stringify(vault, null, 2) + '\n')
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['a'])
    store.list() // Refresh the memoized snapshot after the external edit.
    store.save({ ...store.get('a'), alias: 'changed' })
    expect(Object.keys(readVault().credentials)).toEqual(['a'])
  })

  it('rechecks OAuth.json after the temp file is flushed, before replacing it', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const vault = readVault()
    vault.credentials.a = {
      scheme: 'electron-safeStorage',
      encoding: 'base64',
      data: Buffer.from('sealed:{"token":"EXTERNAL"}').toString('base64'),
    }
    const external = JSON.stringify(vault, null, 2) + '\n'
    vi.mocked(fsyncSync).mockImplementationOnce(() => writeFileSync(oauthPath, external))
    expect(() =>
      store.save({ ...store.get('a'), auth: '{"token":"INTERNAL"}' }),
    ).toThrow('其他程序修改')
    expect(readFileSync(oauthPath, 'utf8')).toBe(external)
    expect(store.get('a').auth).toBe('{"token":"EXTERNAL"}')
  })

  it('requires secure encryption before saving a credential', () => {
    const store = new AccountStore(path)
    mockEncryption.available = false
    expect(() => store.save(account('a'))).toThrow('系统凭据加密不可用')
    expect(store.list()).toEqual([])
  })
})
