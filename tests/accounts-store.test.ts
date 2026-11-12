import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredAccount } from '../src/main/accounts/store'

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

import { AccountStore } from '../src/main/accounts/store'

let root: string
let path: string

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cota-providers-'))
  path = join(root, 'providers.json')
  mockEncryption.available = true
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('Cortana providers.json store', () => {
  it('starts empty and persists encrypted credentials with private permissions', () => {
    const store = new AccountStore(path)
    expect(store.list()).toEqual([])
    store.save(account('first'))
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('TOP-SECRET')
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      accounts: [{ id: 'first', authEncrypted: { scheme: 'electron-safeStorage' } }],
    })
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(new AccountStore(path).get('first')).toEqual(account('first'))
  })

  it('handles updates, removal and persistent ordering', () => {
    const store = new AccountStore(path)
    store.save(account('first'))
    store.save({ ...account('second'), sortOrder: -1 })
    expect(store.list().map((entry) => entry.id)).toEqual(['second', 'first'])
    store.save({ ...store.get('first'), alias: 'renamed' })
    expect(new AccountStore(path).get('first').alias).toBe('renamed')
    store.remove('second')
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['first'])
  })

  it('commits a batch once and reads staged changes in the transaction', () => {
    const store = new AccountStore(path)
    store.transaction(() => {
      store.save(account('a'))
      expect(store.get('a').id).toBe('a')
      store.save(account('b'))
      store.remove('a')
    })
    expect(new AccountStore(path).list().map((entry) => entry.id)).toEqual(['b'])
    expect(() => store.transaction(() => store.transaction(() => {}))).toThrow('嵌套')
  })

  it('rolls back a failed transaction without modifying the file', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const before = readFileSync(path, 'utf8')
    expect(() =>
      store.transaction(() => {
        store.save(account('b'))
        throw new Error('abort')
      }),
    ).toThrow('abort')
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(store.list().map((entry) => entry.id)).toEqual(['a'])
  })

  it('keeps corrupt and unsupported files intact rather than resetting them', () => {
    for (const raw of ['not-json', '{"schemaVersion":2,"accounts":[]}', '{"schemaVersion":1,"accounts":"bad"}']) {
      writeFileSync(path, raw)
      const store = new AccountStore(path)
      expect(() => store.list()).toThrow('账号配置文件无效')
      expect(readFileSync(path, 'utf8')).toBe(raw)
    }
  })

  it('rejects external modifications and reloads their contents on retry', () => {
    const store = new AccountStore(path)
    store.save(account('a'))
    const other = new AccountStore(path)
    other.save(account('b'))
    expect(() => store.save(account('c'))).toThrow('其他程序修改')
    expect(store.list().map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('refuses to save when secure encryption is unavailable', () => {
    const store = new AccountStore(path)
    mockEncryption.available = false
    expect(() => store.save(account('a'))).toThrow('系统凭据加密不可用')
    expect(store.list()).toEqual([])
  })
})
