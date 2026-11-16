import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountService } from '../../../src/main/accounts/service'
import { AccountCredentials, normalizeCredential } from '../../../src/main/accounts/credentials'
import { AccountStore } from '../../../src/main/accounts/store'
import type { StoredAccount } from '../../../src/main/accounts/store'
import * as network from '../../../src/main/accounts/network'

vi.mock('../../../src/main/accounts/network', async (importOriginal) => {
  const actual = await importOriginal<typeof network>()
  return {
    ...actual,
    refreshCredential: vi.fn((value: StoredAccount) => Promise.resolve(value)),
    refreshAccountUsage: vi.fn((value: StoredAccount) => Promise.resolve(value)),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function account(id: string): StoredAccount {
  return {
    id,
    product: 'codex',
    providerKey: '',
    accountType: 'oauth',
    alias: id,
    email: '',
    accountId: id,
    planType: '',
    apiBaseUrl: null,
    auth: JSON.stringify({
      kind: 'codex',
      auth: { tokens: { access_token: `access-${id}`, account_id: id } },
    }),
    usagePrimary: null,
    usageSecondary: null,
    usageUpdatedAt: null,
    updatedAt: 1,
    lastUsedAt: null,
    needsReauthorization: false,
    sortOrder: id === 'a' ? 0 : 1,
  }
}

let root: string
let path: string
let service: AccountService
let readCurrent: ReturnType<typeof vi.fn<AccountCredentials['current']>>
let readRevision: ReturnType<typeof vi.fn<AccountCredentials['revision']>>
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cota-account-service-'))
  path = join(root, 'providers.json')
  const store = new AccountStore(path)
  store.save(account('a'))
  store.save(account('b'))
  service = new AccountService(path, () => {})
  readCurrent = vi.fn<AccountCredentials['current']>().mockResolvedValue([])
  readRevision = vi.fn<AccountCredentials['revision']>().mockResolvedValue('stable-revision')
  vi.spyOn(AccountCredentials.prototype, 'current').mockImplementation(readCurrent)
  vi.spyOn(AccountCredentials.prototype, 'revision').mockImplementation(readRevision)
  vi.mocked(network.refreshCredential)
    .mockReset()
    .mockImplementation((value) => Promise.resolve(value))
  vi.mocked(network.refreshAccountUsage)
    .mockReset()
    .mockImplementation((value) => Promise.resolve(value))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

describe('account snapshots during queued operations', () => {
  it('reads fresh snapshots while different account refreshes remain serial', async () => {
    const firstStarted = deferred<void>()
    const secondStarted = deferred<void>()
    const finishFirst = deferred<void>()
    const finishSecond = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      if (value.id === 'a') {
        firstStarted.resolve()
        await finishFirst.promise
      } else {
        secondStarted.resolve()
        await finishSecond.promise
      }
      return { ...value, usageUpdatedAt: 123 }
    })

    const first = service.refresh('a')
    await firstStarted.promise
    const second = service.refresh('b')
    const initial = await service.list('codex')
    expect(initial.profiles.map((profile) => profile.usageUpdatedAt)).toEqual([null, null])
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)

    finishFirst.resolve()
    await first
    await secondStarted.promise
    const afterFirst = await service.list('codex')
    expect(afterFirst.profiles.map((profile) => profile.usageUpdatedAt)).toEqual([123, null])
    finishSecond.resolve()
    await second
    expect((await service.list('codex')).profiles.map((profile) => profile.usageUpdatedAt)).toEqual(
      [123, 123],
    )
    await service.close()
  })

  it('persists rotated credentials even if an earlier snapshot read is slow', async () => {
    const reading = deferred<void>()
    const finishRead = deferred<void>()
    readCurrent.mockImplementationOnce(async () => {
      reading.resolve()
      await finishRead.promise
      return []
    })
    vi.mocked(network.refreshCredential).mockImplementation((value) =>
      Promise.resolve({
        ...value,
        auth: JSON.stringify({
          kind: 'codex',
          auth: { tokens: { access_token: 'renewed', account_id: 'a' } },
        }),
      }),
    )
    const listing = service.list('codex')
    await reading.promise
    await service.refresh('a')
    expect(new AccountStore(path).get('a').auth).toContain('renewed')
    finishRead.resolve()
    await listing
    expect(readCurrent).toHaveBeenCalledTimes(3)
    await service.close()
  })

  it.each(['refresh', 'switch'] as const)(
    'does not expose a partially applied credential during %s',
    async (operation) => {
      const applying = deferred<void>()
      const finishApply = deferred<void>()
      let currentAuth = account('a').auth
      readCurrent.mockImplementation((product) =>
        Promise.resolve(
          product === 'codex' ? [normalizeCredential('codex', JSON.parse(currentAuth))] : [],
        ),
      )
      vi.mocked(network.refreshCredential).mockImplementation((value) =>
        Promise.resolve({
          ...value,
          auth: JSON.stringify({
            kind: 'codex',
            auth: { tokens: { access_token: 'renewed', account_id: 'a' } },
          }),
        }),
      )
      vi.spyOn(AccountCredentials.prototype, 'apply').mockImplementation(async (value) => {
        currentAuth = '{}'
        applying.resolve()
        await finishApply.promise
        currentAuth = value.auth
        return async () => {}
      })

      const operationPromise =
        operation === 'refresh' ? service.refresh('a') : service.switch({ id: 'a' })
      await applying.promise
      let listed = false
      const listing = service.list('codex').then((result) => {
        listed = true
        return result
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(listed).toBe(false)
      expect((await service.list('pi')).profiles).toEqual([])
      finishApply.resolve()
      await operationPromise
      const result = await listing
      expect(result.authState).toBe('managed')
      expect(result.profiles.find((profile) => profile.id === 'a')?.isActive).toBe(true)
      await service.close()
    },
  )

  it('rejects a queued forced switch if the confirmed login changed', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    const external = normalizeCredential('codex', {
      tokens: { access_token: 'external', account_id: 'external' },
    })
    readCurrent.mockResolvedValue([external])
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return value
    })
    const apply = vi.spyOn(AccountCredentials.prototype, 'apply')
    const refreshing = service.refresh('b')
    await started.promise
    const status = await service.list('codex')
    expect(status.authState).toBe('unmanaged')
    const switching = expect(
      service.switch({ id: 'a', force: true, authRevision: status.authRevision }),
    ).rejects.toThrow('当前 CLI 登录已变化')
    readRevision.mockResolvedValue('changed-revision')
    finish.resolve()
    await refreshing
    await switching
    expect(apply).not.toHaveBeenCalled()
    await service.close()
  })

  it('fails closed for forced switching without a verifiable revision', async () => {
    await expect(service.switch({ id: 'a', force: true })).rejects.toThrow('无法验证当前 CLI 登录')
    readRevision.mockRejectedValue(new Error('unreadable'))
    readCurrent.mockResolvedValue([
      normalizeCredential('codex', {
        tokens: { access_token: 'external', account_id: 'external' },
      }),
    ])
    const status = await service.list('codex')
    expect(status.authState).toBe('unmanaged')
    expect(status.authRevision).toBeUndefined()
    await expect(service.switch({ id: 'a', force: true, authRevision: 'old' })).rejects.toThrow(
      '无法验证当前 CLI 登录',
    )
    await service.close()
  })

  it('keeps rotated credentials and releases readers when applying them fails', async () => {
    const current = normalizeCredential('codex', JSON.parse(account('a').auth))
    readCurrent.mockResolvedValue([current])
    vi.mocked(network.refreshCredential).mockImplementation((value) =>
      Promise.resolve({
        ...value,
        auth: JSON.stringify({
          kind: 'codex',
          auth: { tokens: { access_token: 'renewed', account_id: 'a' } },
        }),
      }),
    )
    vi.spyOn(AccountCredentials.prototype, 'apply').mockRejectedValue(new Error('写入失败'))
    await expect(service.refresh('a')).rejects.toThrow('写入失败')
    expect(new AccountStore(path).get('a').auth).toContain('renewed')
    expect((await service.list('codex')).profiles).toHaveLength(2)
    await service.close()
  })

  it('keeps the queue usable and exposes reauthorization after a refresh fails', async () => {
    vi.mocked(network.refreshAccountUsage).mockImplementation((value) =>
      value.id === 'a'
        ? Promise.reject(new network.AccountNetworkError('认证失败', 401))
        : Promise.resolve({ ...value, usageUpdatedAt: 123 }),
    )
    const first = expect(service.refresh('a')).rejects.toThrow('认证失败')
    const second = service.refresh('b')
    await first
    await second
    const profiles = (await service.list('codex')).profiles
    expect(profiles.find((profile) => profile.id === 'a')?.needsReauthorization).toBe(true)
    expect(profiles.find((profile) => profile.id === 'b')?.usageUpdatedAt).toBe(123)
    await service.close()
  })

  it.each(['auth.json', 'config.toml'])(
    'checks %s again immediately before applying a forced switch',
    async (changed) => {
      vi.restoreAllMocks()
      const home = join(root, 'codex')
      mkdirSync(home)
      const authPath = join(home, 'auth.json')
      const configPath = join(home, 'config.toml')
      writeFileSync(authPath, account('a').auth)
      writeFileSync(configPath, 'model = "old"\n')
      const credentials = new AccountCredentials(root, () => home)
      const revision = await credentials.revision('codex')
      const changedPath = join(home, changed)
      const replacement = changed === 'auth.json' ? account('b').auth : 'model = "new"\n'
      writeFileSync(changedPath, replacement)
      await expect(credentials.apply(account('a'), revision)).rejects.toThrow('当前 CLI 登录已变化')
      expect(readFileSync(changedPath, 'utf8')).toBe(replacement)
      await service.close()
    },
  )

  it.each(['codex', 'claude', 'pi', 'grok'] as const)(
    'accepts an unchanged %s revision and can restore its files',
    async (product) => {
      vi.restoreAllMocks()
      const codexHome = join(root, 'codex')
      const claudeHome = join(root, '.claude')
      const piHome = join(root, 'pi')
      const grokHome = join(root, 'grok')
      for (const directory of [codexHome, claudeHome, piHome, grokHome]) mkdirSync(directory)
      vi.stubEnv('PI_CODING_AGENT_DIR', piHome)
      vi.stubEnv('GROK_HOME', grokHome)
      for (const file of [
        join(codexHome, 'auth.json'),
        join(claudeHome, 'settings.json'),
        join(piHome, 'auth.json'),
        join(grokHome, 'auth.json'),
      ])
        writeFileSync(file, '{}')
      writeFileSync(join(codexHome, 'config.toml'), '')
      writeFileSync(join(grokHome, 'config.toml'), '')
      const auth = {
        codex: account('a').auth,
        claude: JSON.stringify({
          kind: 'claude',
          auth: { env: { CLAUDE_CODE_OAUTH_TOKEN: 'token' } },
        }),
        pi: JSON.stringify({
          kind: 'pi',
          auth: {
            'openai-codex': { type: 'oauth', access: 'token', refresh: 'refresh', expires: 1 },
          },
        }),
        grok: JSON.stringify({
          kind: 'grok',
          auth: {
            'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': {
              auth_mode: 'oidc',
              key: 'token',
            },
          },
        }),
      }
      const credentials = new AccountCredentials(root, () => codexHome)
      const revision = await credentials.revision(product)
      const restore = await credentials.apply(
        {
          ...account('a'),
          product,
          providerKey: product === 'pi' ? 'openai-codex' : '',
          auth: auth[product],
        },
        revision,
      )
      expect(await credentials.revision(product)).not.toBe(revision)
      await restore()
      expect(await credentials.revision(product)).toBe(revision)
      await service.close()
    },
  )

  it('pauses an expired account without a refresh token for reauthorization', async () => {
    const actual = await vi.importActual<typeof network>('../../../src/main/accounts/network')
    vi.mocked(network.refreshCredential).mockImplementation(actual.refreshCredential)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      service.refreshAutomatically('a', { allowed: () => true, due: () => true }),
    ).rejects.toBeInstanceOf(network.AccountReauthorizationError)
    expect(fetch).not.toHaveBeenCalled()
    expect(new AccountStore(path).get('a').needsReauthorization).toBe(true)
    await service.close()
  })

  it('clears reauthorization status after a successful manual refresh', async () => {
    new AccountStore(path).save({ ...account('a'), needsReauthorization: true })
    await service.refresh('a')
    expect(new AccountStore(path).get('a').needsReauthorization).toBe(false)
    await service.close()
  })

  it('joins a manual refresh to an in-flight automatic refresh', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return value
    })
    const automatic = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await started.promise
    const manual = service.refresh('a')
    finish.resolve()
    expect(await automatic).toBe(true)
    await manual
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)
    await service.close()
  })

  it('does not start a queued automatic refresh after it is disabled', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return value
    })
    const manual = service.refresh('a')
    await started.promise
    let enabled = true
    const automatic = service.refreshAutomatically('b', {
      allowed: () => enabled,
      due: () => true,
    })
    enabled = false
    finish.resolve()
    await manual
    expect(await automatic).toBe(false)
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)
    await service.close()
  })

  it('still runs a manual request that joins an automatic request cancelled before network access', async () => {
    const recording = deferred<void>()
    const finishRecording = deferred<() => Promise<void>>()
    const undo = vi.fn(() => Promise.resolve())
    service.setRefreshAttemptRecorder(() => {
      recording.resolve()
      return finishRecording.promise
    })
    let enabled = true
    const automatic = service.refreshAutomatically('a', {
      allowed: () => enabled,
      due: () => true,
    })
    await recording.promise
    enabled = false
    const manual = service.refresh('a')
    finishRecording.resolve(undo)
    expect(await automatic).toBe(false)
    await manual
    expect(undo).toHaveBeenCalledOnce()
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)
    await service.close()
  })

  it('skips automatic refresh when another account shares its refresh token', async () => {
    const store = new AccountStore(path)
    store.save({
      ...account('a'),
      auth: JSON.stringify({
        kind: 'codex',
        auth: { tokens: { access_token: 'access-a', refresh_token: 'shared', account_id: 'a' } },
      }),
    })
    store.save({
      ...account('pi'),
      product: 'pi',
      providerKey: 'openai-codex',
      auth: JSON.stringify({
        kind: 'pi',
        auth: {
          'openai-codex': {
            type: 'oauth',
            access: 'pi-access',
            refresh: 'shared',
            expires: 9e12,
          },
        },
      }),
    })
    await expect(
      service.refreshAutomatically('a', { allowed: () => true, due: () => true }),
    ).rejects.toThrow('多个账号共用刷新令牌')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    await service.close()
  })

  it('does not overwrite an externally changed account before automatic refresh', async () => {
    const recording = deferred<void>()
    const finishRecording = deferred<() => Promise<void>>()
    service.setRefreshAttemptRecorder(() => {
      recording.resolve()
      return finishRecording.promise
    })
    const refreshing = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await recording.promise
    const store = new AccountStore(path)
    store.save({ ...store.get('a'), alias: '外部修改' })
    finishRecording.resolve(() => Promise.resolve())
    await expect(refreshing).rejects.toThrow('账号配置已变化')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    expect(new AccountStore(path).get('a').alias).toBe('外部修改')
    await service.close()
  })

  it('keeps protected credentials when switching away from a conflicted account', async () => {
    const store = new AccountStore(path)
    store.save({
      ...account('a'),
      auth: JSON.stringify({
        kind: 'codex',
        auth: {
          tokens: { access_token: 'new-access', refresh_token: 'new-refresh', account_id: 'a' },
        },
      }),
      needsReauthorization: true,
    })
    readCurrent.mockResolvedValue([normalizeCredential('codex', JSON.parse(account('a').auth))])
    const apply = vi
      .spyOn(AccountCredentials.prototype, 'apply')
      .mockResolvedValue(() => Promise.resolve())
    await expect(service.switch({ id: 'b' })).rejects.toThrow('当前 CLI 凭据与已保存凭据不一致')
    expect(apply).not.toHaveBeenCalled()
    expect(new AccountStore(path).get('a').auth).toContain('new-refresh')
    await service.close()
  })

  it('does not clear protected credentials when CLI state is unreadable', async () => {
    new AccountStore(path).save({ ...account('a'), needsReauthorization: true })
    readCurrent.mockRejectedValue(new Error('无法读取 CLI 认证'))
    await expect(service.refresh('a')).rejects.toThrow('无法读取 CLI 认证')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    expect(new AccountStore(path).get('a').needsReauthorization).toBe(true)
    await service.close()
  })

  it('fails closed for unreadable CLI credentials during automatic refresh', async () => {
    readCurrent.mockRejectedValue(new Error('无法读取 CLI 认证'))
    await expect(
      service.refreshAutomatically('a', { allowed: () => true, due: () => true }),
    ).rejects.toThrow('无法读取 CLI 认证')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    await service.close()
  })

  it('preserves a rotated token and unrelated external edits during renewal', async () => {
    const started = deferred<void>()
    const finish = deferred<StoredAccount>()
    vi.mocked(network.refreshCredential).mockImplementation(() => {
      started.resolve()
      return finish.promise
    })
    const refreshing = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await started.promise
    const external = new AccountStore(path)
    external.save({ ...external.get('a'), alias: '外部修改' })
    finish.resolve({
      ...account('a'),
      auth: JSON.stringify({
        kind: 'codex',
        auth: {
          tokens: { access_token: 'rotated', refresh_token: 'new-refresh', account_id: 'a' },
        },
      }),
    })
    expect(await refreshing).toBe(true)
    const saved = new AccountStore(path).get('a')
    expect(saved.alias).toBe('外部修改')
    expect(saved.auth).toContain('new-refresh')
    await service.close()
  })

  it('does not overwrite externally replaced credentials after a token refresh', async () => {
    const started = deferred<void>()
    const finish = deferred<StoredAccount>()
    vi.mocked(network.refreshCredential).mockImplementation(() => {
      started.resolve()
      return finish.promise
    })
    const refreshing = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await started.promise
    const external = new AccountStore(path)
    external.save({
      ...external.get('a'),
      auth: JSON.stringify({
        kind: 'codex',
        auth: { tokens: { access_token: 'external', account_id: 'a' } },
      }),
    })
    finish.resolve({
      ...account('a'),
      auth: JSON.stringify({
        kind: 'codex',
        auth: { tokens: { access_token: 'rotated', account_id: 'a' } },
      }),
    })
    await expect(refreshing).rejects.toThrow('无法安全保存新凭据')
    expect(new AccountStore(path).get('a').auth).toContain('external')
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
    await service.close()
  })

  it('preserves rotated credentials when automatic CLI writeback detects a changed revision', async () => {
    const current = normalizeCredential('codex', JSON.parse(account('a').auth))
    readCurrent.mockResolvedValue([current])
    vi.mocked(network.refreshCredential).mockImplementation((value) =>
      Promise.resolve({
        ...value,
        auth: JSON.stringify({
          kind: 'codex',
          auth: { tokens: { access_token: 'rotated', account_id: 'a' } },
        }),
      }),
    )
    const updateCurrent = vi
      .spyOn(AccountCredentials.prototype, 'updateCurrent')
      .mockRejectedValue(new Error('当前 CLI 登录已变化'))
    await expect(
      service.refreshAutomatically('a', { allowed: () => true, due: () => true }),
    ).rejects.toThrow('当前 CLI 登录已变化')
    expect(updateCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      'stable-revision',
      undefined,
    )
    expect(new AccountStore(path).get('a').auth).toContain('rotated')
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
    await service.close()
  })

  it('waits for in-flight reads on close and rejects new reads', async () => {
    const reading = deferred<void>()
    const finishRead = deferred<void>()
    readCurrent.mockImplementation(async () => {
      reading.resolve()
      await finishRead.promise
      return []
    })
    const listing = service.list('codex')
    await reading.promise
    let closed = false
    const closing = service.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(service.list('pi')).rejects.toThrow('账号服务正在关闭')
    finishRead.resolve()
    await listing
    await closing
    expect(closed).toBe(true)
  })
})
