import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { AccountService } from '../../../src/main/accounts/service'
import { AccountCredentials } from '../../../src/main/accounts/credentials'
import { normalizeCredential, wrapCredential } from '../../../src/main/accounts/credential-data'
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

function siwc(subject: string, clientId: string, version = 'old', expires = 9e12) {
  const payload = Buffer.from(JSON.stringify({ sub: subject, jti: version })).toString('base64url')
  return {
    type: 'oauth',
    access: `header.${payload}.signature`,
    refresh: `refresh-${clientId}-${version}`,
    expires,
    clientId,
    scopes: ['offline_access', 'chatgpt.tokens.use.direct'],
  }
}

function siwcAccount(entry: ReturnType<typeof siwc>): StoredAccount {
  return {
    ...account('siwc'),
    product: 'pi',
    providerKey: 'openai',
    auth: JSON.stringify({ kind: 'pi', auth: { openai: entry } }),
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
        return { restore: async () => {}, restartRequired: false }
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
      const { restore, restartRequired } = await credentials.apply(
        {
          ...account('a'),
          product,
          providerKey: product === 'pi' ? 'openai-codex' : '',
          auth: auth[product],
        },
        revision,
      )
      expect(restartRequired).toBe(false)
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
      .mockResolvedValue({ restore: () => Promise.resolve(), restartRequired: false })
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

  it('does not block other account operations during background refresh and preserves concurrent edits', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, usageUpdatedAt: 456 }
    })
    const automatic = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await started.promise
    await service.rename({ id: 'a', alias: '新别名' })
    await service.rename({ id: 'b', alias: '账号 B' })
    expect(new AccountStore(path).get('a').alias).toBe('新别名')
    expect(new AccountStore(path).get('b').alias).toBe('账号 B')
    finish.resolve()
    expect(await automatic).toBe(true)
    const saved = new AccountStore(path).get('a')
    expect(saved.alias).toBe('新别名')
    expect(saved.usageUpdatedAt).toBe(456)
    await service.close()
  })

  it('does not resurrect an account removed during a background refresh', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, usageUpdatedAt: 789 }
    })
    const automatic = service.refreshAutomatically('a', { allowed: () => true, due: () => true })
    await started.promise
    await service.remove('a')
    expect((await service.list('codex')).profiles.map((entry) => entry.id)).toEqual(['b'])
    finish.resolve()
    expect(await automatic).toBe(false)
    expect((await service.list('codex')).profiles.map((entry) => entry.id)).toEqual(['b'])
    await service.close()
  })
})

describe('Pi OpenAI credentials', () => {
  function setupPi(entry = siwc('current-user', 'current-client')) {
    vi.restoreAllMocks()
    const piHome = join(root, 'pi')
    mkdirSync(piHome)
    vi.stubEnv('PI_CODING_AGENT_DIR', piHome)
    const authPath = join(piHome, 'auth.json')
    const source = {
      openai: entry,
      'openai-codex': {
        type: 'oauth',
        access: 'codex-access',
        refresh: 'codex-refresh',
        expires: 9e12,
        accountId: 'codex-account',
      },
      other: { type: 'api_key', key: 'unrelated' },
    }
    writeFileSync(authPath, JSON.stringify(source))
    return { authPath, source }
  }

  async function addSiwc(entry: ReturnType<typeof siwc>) {
    await service.add({
      product: 'pi',
      mode: 'credential',
      credential: JSON.stringify({ openai: entry }),
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    return (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai' && profile.accountId === 'target-user',
    )!
  }

  it.each(['openai', 'openai-codex', 'xai'] as const)(
    'deactivates only %s, saves its rotated credential, and can switch it back',
    async (provider) => {
      const { authPath, source } = setupPi()
      const initial = {
        ...source,
        xai: {
          type: 'oauth',
          access: 'xai-access',
          refresh: 'xai-refresh',
          expires: 9e12,
          accountId: 'xai-account',
        },
      }
      writeFileSync(authPath, JSON.stringify(initial))
      expect(await service.importCurrent('pi')).toBe(3)
      const target = (await service.list('pi')).profiles.find(
        (profile) => profile.providerKey === provider,
      )!
      const rotated =
        provider === 'openai'
          ? siwc('current-user', 'current-client', 'rotated', 9e12 + 1000)
          : {
              ...initial[provider],
              access: `${provider}-access-rotated`,
              refresh: `${provider}-refresh-rotated`,
              expires: 9e12 + 1000,
            }
      const current = { ...initial, [provider]: rotated }
      writeFileSync(authPath, JSON.stringify(current))

      await service.deactivate(target.id)
      const { [provider]: _removed, ...remaining } = current
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(remaining)
      expect(JSON.parse(new AccountStore(path).get(target.id).auth).auth[provider]).toEqual(rotated)
      const after = (await service.list('pi')).profiles
      expect(after.find((profile) => profile.id === target.id)?.isActive).toBe(false)
      expect(
        after.filter((profile) => profile.id !== target.id).every((item) => item.isActive),
      ).toBe(true)

      await service.switch({ id: target.id })
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(current)
      expect(
        (await service.list('pi')).profiles.find((item) => item.id === target.id)?.isActive,
      ).toBe(true)
      await service.close()
    },
  )

  it.each(['openai', 'openai-codex'] as const)(
    'keeps %s accounts mutually exclusive without changing other providers',
    async (provider) => {
      const { authPath, source } = setupPi()
      await service.importCurrent('pi')
      const previous = (await service.list('pi')).profiles.find(
        (profile) => profile.providerKey === provider,
      )!
      const nextCredential =
        provider === 'openai'
          ? siwc('target-user', 'target-client')
          : { ...source['openai-codex'], accountId: 'another-account', access: 'another-access' }
      await service.add({
        product: 'pi',
        mode: 'credential',
        credential: JSON.stringify({ [provider]: nextCredential }),
        alias: 'another',
        apiBaseUrl: '',
        apiKey: '',
      })
      const next = (await service.list('pi')).profiles.find(
        (profile) => profile.alias === 'another',
      )!
      await service.switch({ id: next.id })
      const switched = (await service.list('pi')).profiles
      expect(switched.find((item) => item.id === previous.id)?.isActive).toBe(false)
      expect(switched.find((item) => item.id === next.id)?.isActive).toBe(true)
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
        ...source,
        [provider]: nextCredential,
      })
      await service.deactivate(next.id)
      expect(
        (await service.list('pi')).profiles.filter((item) => item.providerKey === provider),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: previous.id, isActive: false })]),
      )
      expect(
        (await service.list('pi')).profiles.some(
          (item) => item.providerKey === provider && item.isActive,
        ),
      ).toBe(false)
      await service.close()
    },
  )

  it('leaves an empty Pi auth file and the saved account after its last login is deactivated', async () => {
    const { authPath, source } = setupPi()
    writeFileSync(authPath, JSON.stringify({ 'openai-codex': source['openai-codex'] }))
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles[0]
    await service.deactivate(target.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({})
    const status = await service.list('pi')
    expect(status.authState).toBe('missing')
    expect(status.profiles).toEqual([expect.objectContaining({ id: target.id, isActive: false })])
    await expect(service.deactivate(target.id)).rejects.toThrow('当前 Pi 登录已变化')
    await service.close()
  })

  it('rejects inactive or non-Pi accounts and preserves unrelated API keys', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const siwcProfile = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const external = { ...source, openai: { type: 'api_key', key: 'unrelated-api-key' } }
    writeFileSync(authPath, JSON.stringify(external))
    await expect(service.deactivate(siwcProfile.id)).rejects.toThrow('当前 Pi 登录已变化')
    await expect(service.deactivate('a')).rejects.toThrow('仅支持取消激活 Pi')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
    const codex = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai-codex',
    )!
    await service.deactivate(codex.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      openai: external.openai,
      other: source.other,
    })
    await service.close()
  })

  it('does not deactivate a different account that became active after listing', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const external = { ...source, openai: siwc('other-user', 'other-client') }
    writeFileSync(authPath, JSON.stringify(external))
    await expect(service.deactivate(target.id)).rejects.toThrow('当前 Pi 登录已变化')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
    await service.close()
  })

  it.skipIf(process.platform === 'win32')(
    'does not replace a symlinked Pi auth file when deactivating',
    async () => {
      const { authPath, source } = setupPi()
      await service.importCurrent('pi')
      const target = (await service.list('pi')).profiles.find(
        (profile) => profile.providerKey === 'openai-codex',
      )!
      const actualPath = `${authPath}.target`
      renameSync(authPath, actualPath)
      symlinkSync('auth.json.target', authPath)
      await expect(service.deactivate(target.id)).rejects.toThrow('认证文件是符号链接')
      expect(lstatSync(authPath).isSymbolicLink()).toBe(true)
      expect(JSON.parse(readFileSync(actualPath, 'utf8'))).toEqual(source)
      await service.close()
    },
  )

  it('does not replace a newer saved token with an older Pi token', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const store = new AccountStore(path)
    const saved = store.get(target.id)
    const rotated = siwc('current-user', 'current-client', 'newer', 9e12 + 1000)
    store.save({ ...saved, auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }) })
    await expect(service.deactivate(target.id)).rejects.toThrow('无法确认最新的 Pi 令牌')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    expect(new AccountStore(path).get(target.id).auth).toContain(rotated.refresh)
    await service.close()
  })

  it('does not rewrite an unchanged saved credential during deactivation', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const store = (service as unknown as { store: AccountStore }).store
    const save = vi.spyOn(store, 'save')
    await service.deactivate(target.id)
    expect(save).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      'openai-codex': source['openai-codex'],
      other: source.other,
    })
    await service.close()
  })

  it('does not remove the Pi login if saving the rotated token fails', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const current = {
      ...source,
      openai: siwc('current-user', 'current-client', 'new', 9e12 + 1000),
    }
    writeFileSync(authPath, JSON.stringify(current))
    const store = (service as unknown as { store: AccountStore }).store
    vi.spyOn(store, 'save').mockImplementation(() => {
      throw new Error('save failed')
    })
    await expect(service.deactivate(target.id)).rejects.toThrow('save failed')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(current)
    await service.close()
  })

  it('preserves an external Pi change after saving a rotated token', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const rotated = siwc('current-user', 'current-client', 'new', 9e12 + 1000)
    writeFileSync(authPath, JSON.stringify({ ...source, openai: rotated }))
    const external = { ...source, openai: siwc('external-user', 'external-client') }
    const store = (service as unknown as { store: AccountStore }).store
    const save = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation((value) => {
      save(value)
      writeFileSync(authPath, JSON.stringify(external))
    })
    await expect(service.deactivate(target.id)).rejects.toThrow('当前 Pi 登录已变化')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
    expect(new AccountStore(path).get(target.id).auth).toContain(rotated.refresh)
    await service.close()
  })

  it('waits for an in-flight refresh before deactivating the Pi account', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai-codex',
    )!
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return value
    })
    const refreshing = service.refresh(target.id)
    await started.promise
    const deactivating = service.deactivate(target.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    finish.resolve()
    await refreshing
    await deactivating
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      openai: source.openai,
      other: source.other,
    })
    await service.close()
  })

  it('does not deactivate while Pi holds the auth lock', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (profile) => profile.providerKey === 'openai',
    )!
    const release = await lock(authPath)
    try {
      await expect(service.deactivate(target.id)).rejects.toThrow('Pi 正在更新认证信息')
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    } finally {
      await release()
    }
    await service.close()
  })

  it('imports current SIWC alongside Codex and updates the same registration after rotation', async () => {
    const { authPath, source } = setupPi()
    expect(await service.importCurrent('pi')).toBe(2)
    const first = await service.list('pi')
    const profile = first.profiles.find((item) => item.providerKey === 'openai')!
    expect(first.authState).toBe('managed')
    expect(profile.isActive).toBe(true)
    expect(profile.email).toBe('')
    expect(first.profiles.map((item) => item.providerKey).sort()).toEqual([
      'openai',
      'openai-codex',
    ])

    source.openai = siwc('current-user', 'current-client', 'rotated')
    writeFileSync(authPath, JSON.stringify(source))
    expect(await service.importCurrent('pi')).toBe(2)
    const second = await service.list('pi')
    expect(second.profiles.find((item) => item.providerKey === 'openai')?.id).toBe(profile.id)
    expect(new AccountStore(path).get(profile.id).auth).toContain('refresh-current-client-rotated')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    await service.close()
  })

  it('keeps separate SIWC registrations distinct even if their access token is identical', async () => {
    const first = siwc('target-user', 'client-a')
    const second = { ...first, clientId: 'client-b', refresh: 'different-refresh' }
    await addSiwc(first)
    await addSiwc(second)
    expect((await service.list('pi')).profiles).toHaveLength(2)
    await service.close()
  })

  it.each([{ clientId: '' }, { scopes: ['openid'] }])(
    'rejects incomplete SIWC credentials: %j',
    (invalid) => {
      expect(() =>
        normalizeCredential('pi', { openai: { ...siwc('user', 'client'), ...invalid } }),
      ).toThrow('Pi OpenAI SIWC')
    },
  )

  it('accepts opaque access tokens and reimports the same client registration', async () => {
    const entry = { ...siwc('user', 'opaque-client'), access: 'opaque-access' }
    const add = (credential: typeof entry) =>
      service.add({
        product: 'pi',
        mode: 'credential',
        credential: JSON.stringify({ openai: credential }),
        alias: '',
        apiBaseUrl: '',
        apiKey: '',
      })
    await add(entry)
    const first = (await service.list('pi')).profiles[0]
    expect(first.accountId).toBe('')
    await add({ ...entry, access: 'new-opaque-access', refresh: 'new-refresh' })
    const profiles = (await service.list('pi')).profiles
    expect(profiles).toHaveLength(1)
    expect(profiles[0].id).toBe(first.id)
    await service.close()
  })

  it('does not merge known different users of the same SIWC registration', async () => {
    await addSiwc(siwc('target-user', 'client'))
    await service.add({
      product: 'pi',
      mode: 'credential',
      credential: JSON.stringify({ openai: siwc('another-user', 'client') }),
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    expect((await service.list('pi')).profiles).toHaveLength(2)
    await service.close()
  })

  async function addApiKey(key = 'sk-test', alias = 'OpenAI Key') {
    await service.add({
      product: 'pi',
      mode: 'api_key',
      apiKey: key,
      alias,
      credential: '',
      apiBaseUrl: '',
    })
    return (await service.list('pi')).profiles.find((item) => item.alias === alias)!
  }

  it('imports and deduplicates API keys beside OAuth without exposing keys in profiles', async () => {
    const { authPath, source } = setupPi()
    const mixed = { ...source, openai: { type: 'api_key', key: 'sk-test' } }
    writeFileSync(authPath, JSON.stringify(mixed))
    expect(await service.importCurrent('pi')).toBe(2)
    const first = (await service.list('pi')).profiles.find((item) => item.accountType === 'relay')!
    expect(first).toMatchObject({
      providerKey: 'openai',
      isActive: true,
      apiBaseUrl: 'https://api.openai.com/v1',
    })
    expect(JSON.stringify(await service.list('pi'))).not.toContain('sk-test')
    const legacyStore = new AccountStore(path)
    legacyStore.save({ ...legacyStore.get(first.id), apiBaseUrl: null })
    legacyStore.close()
    expect(
      (await service.list('pi')).profiles.find((item) => item.id === first.id)?.apiBaseUrl,
    ).toBe('https://api.openai.com/v1')
    const added = await addApiKey()
    expect(added.id).toBe(first.id)
    await service.add({
      product: 'pi',
      mode: 'credential',
      credential: JSON.stringify({ openai: mixed.openai }),
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    expect((await service.list('pi')).profiles).toHaveLength(2)
    expect(new AccountStore(path).get(first.id).accountType).toBe('relay')
    const codex = (await service.list('pi')).profiles.find(
      (item) => item.providerKey === 'openai-codex',
    )!
    await service.switch({ id: codex.id })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(mixed)
    await service.close()
    service = new AccountService(path, () => {})
    expect((await service.list('pi')).profiles.find((item) => item.id === first.id)?.isActive).toBe(
      true,
    )
    await service.close()
  })

  it('switches between keys and SIWC, preserves other providers, and deactivates only the chosen key', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const original = (await service.list('pi')).profiles.find(
      (item) => item.providerKey === 'openai',
    )!
    const first = await addApiKey()
    const second = await addApiKey('sk-another', 'Another Key')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const [target, expected] of [
      [first, { type: 'api_key', key: 'sk-test' }],
      [second, { type: 'api_key', key: 'sk-another' }],
    ] as const) {
      await expect(service.switch({ id: target.id })).resolves.toEqual({ restartRequired: false })
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({ ...source, openai: expected })
      expect(
        (await service.list('pi')).profiles
          .filter((item) => item.providerKey === 'openai' && item.isActive)
          .map((item) => item.id),
      ).toEqual([target.id])
    }
    expect(network.refreshCredential).not.toHaveBeenCalled()
    await expect(service.refresh(second.id)).rejects.toThrow()
    expect(
      await service.refreshAutomatically(second.id, { allowed: () => true, due: () => true }),
    ).toBe(false)
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
    await expect(service.switch({ id: original.id })).resolves.toEqual({ restartRequired: false })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    await service.switch({ id: first.id })
    await service.deactivate(first.id)
    const { openai: _removed, ...remaining } = source
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(remaining)
    expect(
      (await service.list('pi')).profiles.filter(
        (item) => item.providerKey === 'openai' && item.isActive,
      ),
    ).toEqual([])
    await service.switch({ id: first.id })
    await service.rename({ id: first.id, alias: 'Renamed' })
    await service.remove(first.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      ...source,
      openai: { type: 'api_key', key: 'sk-test' },
    })
    expect(fetch).not.toHaveBeenCalled()
    await service.close()
  })

  it('refuses even forced replacement of an unsaved key until it has been imported', async () => {
    const { authPath, source } = setupPi()
    const current = { ...source, openai: { type: 'api_key', key: 'sk-external' } }
    writeFileSync(authPath, JSON.stringify(current))
    const target = await addApiKey()
    const { authRevision } = await service.list('pi')
    await expect(service.switch({ id: target.id, force: true, authRevision })).rejects.toThrow(
      '请先导入',
    )
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(current)
    await service.importCurrent('pi')
    await service.switch({ id: target.id })
    expect(JSON.parse(readFileSync(authPath, 'utf8')).openai.key).toBe('sk-test')
    await service.close()
  })

  it('does not remove a different API key installed externally', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addApiKey()
    await service.switch({ id: target.id })
    const external = { ...source, openai: { type: 'api_key', key: 'sk-external' } }
    writeFileSync(authPath, JSON.stringify(external))
    await expect(service.deactivate(target.id)).rejects.toThrow('当前 Pi 登录已变化')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
    await service.close()
  })

  it.each([
    { type: 'api_key', key: '!echo secret' },
    { type: 'api_key', key: '$OPENAI_API_KEY' },
    { type: 'api_key', key: '${OPENAI_API_KEY}' },
    { type: 'api_key', key: 'sk-test', env: { SECRET: 'value' } },
    { type: 'api_key', key: '' },
    { type: 'api_key', key: 'sk test' },
    { type: 'api_key' },
    { type: 'unknown', key: 'sk-test' },
  ])(
    'rejects unsupported OpenAI credential configurations without overwriting them: %j',
    async (entry) => {
      const { authPath, source } = setupPi()
      const target = await addApiKey()
      const external = { ...source, openai: entry }
      writeFileSync(authPath, JSON.stringify(external))
      await expect(service.importCurrent('pi')).resolves.toBe(1)
      await expect(
        service.switch({
          id: target.id,
          force: true,
          authRevision: (await service.list('pi')).authRevision,
        }),
      ).rejects.toThrow()
      await expect(
        service.add({
          product: 'pi',
          mode: 'credential',
          credential: JSON.stringify({ openai: entry }),
          alias: '',
          apiBaseUrl: '',
          apiKey: '',
        }),
      ).rejects.toThrow()
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
      await service.close()
    },
  )

  it('imports and switches supported Pi accounts without touching unrelated unsupported providers', async () => {
    const { authPath, source } = setupPi()
    const modelsPath = join(authPath, '..', 'models.json')
    const xai = { type: 'api_key', key: 'unmanaged-xai-key' }
    const auth = { ...source, xai }
    const models = JSON.stringify({ providers: { xai: { api: 'unsupported-protocol' } } })
    writeFileSync(authPath, JSON.stringify(auth))
    writeFileSync(modelsPath, models)

    await expect(service.importCurrent('pi')).resolves.toBe(2)
    const target = await addApiKey()
    await service.switch({ id: target.id })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      ...auth,
      openai: { type: 'api_key', key: 'sk-test' },
    })
    expect(readFileSync(modelsPath, 'utf8')).toBe(models)
    await service.deactivate(target.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8')).xai).toEqual(xai)
    expect(readFileSync(modelsPath, 'utf8')).toBe(models)
    await service.close()
  })

  it('validates manual keys at the IPC boundary and rejects other providers', async () => {
    setupPi()
    for (const key of ['', '!echo secret', '$OPENAI_API_KEY', 'sk test']) {
      await expect(addApiKey(key)).rejects.toThrow()
    }
    expect(() =>
      service.add({
        product: 'codex',
        mode: 'api_key',
        apiKey: 'sk-test',
        alias: '',
        credential: '',
        apiBaseUrl: '',
      }),
    ).toThrow('仅支持 Pi')
    expect(() => normalizeCredential('pi', { xai: { type: 'api_key', key: 'sk-test' } })).toThrow(
      '仅支持',
    )
    await service.close()
  })

  it('restores the previous login if final API key metadata cannot be saved', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addApiKey()
    const store = (service as unknown as { store: AccountStore }).store
    const save = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation((value) => {
      if (value.id === target.id && value.lastUsedAt !== null) throw new Error('metadata failed')
      return save(value)
    })
    await expect(service.switch({ id: target.id })).rejects.toThrow('metadata failed')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    expect(new AccountStore(path).get(target.id).accountType).toBe('relay')
    await service.close()
  })

  it('writes a custom provider to native Pi files, imports models-only keys, and clears fallback authentication', async () => {
    const { authPath, source } = setupPi()
    const modelsPath = join(authPath, '..', 'models.json')
    const config = {
      name: 'Relay Service',
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: [{ id: 'relay-model' }],
    }
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: { relay: { ...config, apiKey: 'relay-old' } },
        marker: 'preserved',
      }),
    )
    expect(await service.importCurrent('pi')).toBe(3)
    const imported = (await service.list('pi')).profiles.find(
      (item) => item.providerKey === 'relay',
    )!
    expect(imported).toMatchObject({
      isActive: true,
      accountType: 'relay',
      alias: 'Relay Service',
      apiBaseUrl: config.baseUrl,
    })
    await expect(service.deactivate(imported.id)).rejects.toThrow('备用 Key')
    await expect(service.switch({ id: imported.id })).resolves.toEqual({ restartRequired: true })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      ...source,
      relay: { type: 'api_key', key: 'relay-old' },
    })
    expect(JSON.parse(readFileSync(modelsPath, 'utf8'))).toEqual({
      providers: { relay: config },
      marker: 'preserved',
    })
    await service.deactivate(imported.id)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    expect(
      (await service.list('pi')).profiles.find((item) => item.id === imported.id)?.isActive,
    ).toBe(false)
    await expect(service.switch({ id: imported.id })).resolves.toEqual({ restartRequired: false })
    expect(
      (await service.list('pi')).profiles.find((item) => item.id === imported.id)?.isActive,
    ).toBe(true)
    await service.close()
    service = new AccountService(path, () => {})
    expect(
      (await service.list('pi')).profiles.find((item) => item.id === imported.id)?.apiBaseUrl,
    ).toBe(config.baseUrl)
    await service.close()
  })

  it('adds custom providers with explicit protocol and models and activates both files without changing other providers', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    await service.add({
      product: 'pi',
      mode: 'provider',
      providerKey: 'my-relay',
      api: 'openai-responses',
      modelIds: 'model-a,model-b',
      apiBaseUrl: 'https://relay.example/v1/',
      apiKey: 'relay-key',
      alias: 'Relay',
      credential: '',
    })
    const target = (await service.list('pi')).profiles.find((item) => item.alias === 'Relay')!
    expect(target).toMatchObject({
      providerKey: 'my-relay',
      isActive: false,
      apiBaseUrl: 'https://relay.example/v1',
    })
    await expect(service.switch({ id: target.id })).resolves.toEqual({ restartRequired: true })
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({
      ...source,
      'my-relay': { type: 'api_key', key: 'relay-key' },
    })
    expect(JSON.parse(readFileSync(join(authPath, '..', 'models.json'), 'utf8'))).toEqual({
      providers: {
        'my-relay': {
          baseUrl: 'https://relay.example/v1',
          api: 'openai-responses',
          models: [{ id: 'model-a' }, { id: 'model-b' }],
        },
      },
    })
    expect(JSON.stringify(await service.list('pi'))).not.toContain('relay-key')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    await expect(service.switch({ id: target.id })).resolves.toEqual({ restartRequired: false })
    await service.add({
      product: 'pi',
      mode: 'provider',
      providerKey: 'my-relay',
      api: 'openai-completions',
      modelIds: 'model-c',
      apiBaseUrl: 'https://relay.example/v1',
      apiKey: 'relay-key',
      alias: 'Updated Relay',
      credential: '',
    })
    const updated = (await service.list('pi')).profiles.find(
      (item) => item.alias === 'Updated Relay',
    )!
    await expect(service.switch({ id: updated.id })).resolves.toEqual({ restartRequired: true })
    expect(
      JSON.parse(readFileSync(join(authPath, '..', 'models.json'), 'utf8')).providers['my-relay'],
    ).toEqual({
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: [{ id: 'model-c' }],
    })
    await service.close()
  })

  it('keeps identical keys at different endpoints distinct and restores the official endpoint for SIWC', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const siwcProfile = (await service.list('pi')).profiles.find(
      (item) => item.providerKey === 'openai',
    )!
    const relay = {
      product: 'pi',
      mode: 'api_key',
      apiKey: 'same-key',
      apiBaseUrl: 'https://relay.example/v1',
      alias: 'Relay',
      credential: '',
    }
    await service.add(relay)
    await service.add({ ...relay, alias: 'Official', apiBaseUrl: 'https://api.openai.com/v1' })
    const profiles = (await service.list('pi')).profiles
    const target = profiles.find((item) => item.alias === 'Relay')!
    expect(profiles.filter((item) => item.accountType === 'relay')).toHaveLength(2)
    const modelsPath = join(authPath, '..', 'models.json')
    await expect(service.switch({ id: target.id })).resolves.toEqual({ restartRequired: true })
    expect(JSON.parse(readFileSync(modelsPath, 'utf8')).providers.openai.baseUrl).toBe(
      relay.apiBaseUrl,
    )
    expect(
      (await service.list('pi')).profiles.find((item) => item.id === target.id)?.isActive,
    ).toBe(true)
    await expect(service.switch({ id: siwcProfile.id })).resolves.toEqual({ restartRequired: true })
    expect(JSON.parse(readFileSync(modelsPath, 'utf8')).providers.openai).toBeUndefined()
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    await service.close()
  })

  it('imports a combined Pi auth/models JSON and honors auth.json over models.json keys', async () => {
    const { authPath } = setupPi()
    const providerConfig = {
      baseUrl: 'https://relay.example/v1',
      api: 'openai-responses',
      models: [{ id: 'relay-model' }],
    }
    await service.add({
      product: 'pi',
      mode: 'credential',
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
      credential: JSON.stringify({
        auth: { relay: { type: 'api_key', key: 'primary-key' } },
        models: { providers: { relay: { ...providerConfig, apiKey: 'fallback-key' } } },
      }),
    })
    const target = (await service.list('pi')).profiles.find((item) => item.providerKey === 'relay')!
    expect(new AccountStore(path).get(target.id).auth).toContain('primary-key')
    expect(new AccountStore(path).get(target.id).auth).not.toContain('fallback-key')
    expect(readFileSync(authPath, 'utf8')).not.toContain('primary-key')
    await service.close()
  })

  it('detects model configuration changes during authorization and preserves the external file', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
    const modelsPath = join(authPath, '..', 'models.json')
    const started = deferred<void>(),
      finish = deferred<void>()
    vi.mocked(network.refreshCredential).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return value
    })
    const switching = expect(service.switch({ id: target.id })).rejects.toThrow()
    await started.promise
    const external = { providers: { openai: { baseUrl: 'https://external.example/v1' } } }
    writeFileSync(modelsPath, JSON.stringify(external))
    finish.resolve()
    await switching
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    expect(JSON.parse(readFileSync(modelsPath, 'utf8'))).toEqual(external)
    await service.close()
  })

  it('rolls back both Pi files when the final account save fails', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    await service.add({
      product: 'pi',
      mode: 'provider',
      providerKey: 'relay',
      api: 'openai-responses',
      modelIds: 'model-a',
      apiBaseUrl: 'https://relay.example/v1',
      apiKey: 'relay-key',
      alias: 'Relay',
      credential: '',
    })
    const target = (await service.list('pi')).profiles.find((item) => item.alias === 'Relay')!
    const store = (service as unknown as { store: AccountStore }).store
    const save = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation((value) => {
      if (value.id === target.id && value.lastUsedAt !== null) throw new Error('metadata failed')
      return save(value)
    })
    await expect(service.switch({ id: target.id })).rejects.toThrow('metadata failed')
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    expect(() => readFileSync(join(authPath, '..', 'models.json'), 'utf8')).toThrow()
    await service.close()
  })

  it('refuses advanced routing, malformed files and mismatched fallback keys without changing either file', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addApiKey()
    const modelsPath = join(authPath, '..', 'models.json')
    for (const config of [
      { providers: 'invalid' },
      { providers: { openai: { headers: { Authorization: 'secret' } } } },
      {
        providers: {
          openai: { models: [{ id: 'model', baseUrl: 'https://external.example/v1' }] },
        },
      },
      { providers: { openai: { apiKey: 'unmanaged-fallback' } } },
    ]) {
      const content = JSON.stringify(config)
      writeFileSync(modelsPath, content)
      await expect(service.switch({ id: target.id })).rejects.toThrow()
      expect(readFileSync(modelsPath, 'utf8')).toBe(content)
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    }
    await service.close()
  })

  it('refreshes SIWC using its issued client without changing the saved provider config', async () => {
    const actual = await vi.importActual<typeof network>('../../../src/main/accounts/network')
    const entry = siwc('target-user', 'issued-client', 'old', 1)
    const rotated = siwc('target-user', 'issued-client', 'new')
    const config = { providerConfig: { modelOverrides: { 'gpt-5.4': { name: 'Work model' } } } }
    const saved = {
      ...siwcAccount(entry),
      auth: wrapCredential('pi', { openai: entry, $cota: config }),
    }
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          access_token: rotated.access,
          refresh_token: rotated.refresh,
          expires_in: 3600,
          scope: 'offline_access chatgpt.tokens.use.direct',
        }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const refreshed = await actual.refreshCredential(saved)
    const body = fetch.mock.calls[0][1]?.body as URLSearchParams
    expect(fetch.mock.calls[0][0]).toBe('https://auth.openai.com/api/accounts/oauth/token')
    expect(body.get('client_id')).toBe('issued-client')
    expect(body.get('refresh_token')).toBe(entry.refresh)
    expect(body.get('resource')).toBe('https://api.openai.com/v1')
    expect(JSON.parse(refreshed.auth).auth).toEqual({
      $cota: config,
      openai: {
        ...entry,
        access: rotated.access,
        refresh: rotated.refresh,
        expires: 100_000 + 3_420_000,
      },
    })
    await expect(actual.refreshAccountUsage(refreshed)).rejects.toThrow('暂不支持额度查询')
    expect(fetch).toHaveBeenCalledOnce()
    await service.close()
  })

  it('holds the Pi lock across token rotation and preserves unrelated providers', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
    const started = deferred<void>()
    const finish = deferred<void>()
    const rotated = siwc('target-user', 'target-client', 'new')
    vi.mocked(network.refreshCredential).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }) }
    })
    const switching = service.switch({ id: target.id })
    await started.promise
    await expect(lock(authPath, { realpath: false })).rejects.toMatchObject({ code: 'ELOCKED' })
    finish.resolve()
    await switching
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({ ...source, openai: rotated })
    expect(new AccountStore(path).get(target.id).auth).toContain(rotated.refresh)
    await service.close()
  })

  it.skipIf(process.platform === 'win32')(
    'uses the same Pi lock through a symlinked agent directory',
    async () => {
      const { authPath } = setupPi()
      const alias = join(root, 'pi-alias')
      symlinkSync(join(root, 'pi'), alias, 'dir')
      vi.stubEnv('PI_CODING_AGENT_DIR', alias)
      await service.importCurrent('pi')
      const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
      const release = await lock(authPath)
      try {
        await expect(service.switch({ id: target.id })).rejects.toThrow('Pi 正在更新认证信息')
        expect(network.refreshCredential).not.toHaveBeenCalled()
      } finally {
        await release()
      }
      await service.close()
    },
  )

  it.skipIf(process.platform === 'win32')(
    'does not replace a symlinked Pi auth file when switching SIWC',
    async () => {
      const { authPath, source } = setupPi()
      const targetPath = `${authPath}.target`
      renameSync(authPath, targetPath)
      symlinkSync('auth.json.target', authPath)
      await service.importCurrent('pi')
      const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
      await expect(service.switch({ id: target.id })).rejects.toThrow('认证文件是符号链接')
      expect(lstatSync(authPath).isSymbolicLink()).toBe(true)
      expect(JSON.parse(readFileSync(targetPath, 'utf8'))).toEqual(source)
      expect(network.refreshCredential).not.toHaveBeenCalled()
      await service.close()
    },
  )

  it('retains rotated tokens without overwriting an externally changed Pi login', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
    const started = deferred<void>()
    const finish = deferred<void>()
    const rotated = siwc('target-user', 'target-client', 'new')
    vi.mocked(network.refreshCredential).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }) }
    })
    const switching = expect(service.switch({ id: target.id })).rejects.toThrow(
      '授权期间检测到 CLI 登录变更',
    )
    await started.promise
    const external = { ...source, openai: siwc('external-user', 'external-client') }
    writeFileSync(authPath, JSON.stringify(external))
    finish.resolve()
    await switching
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(external)
    expect(new AccountStore(path).get(target.id).auth).toContain(rotated.refresh)
    await service.close()
  })

  it.each(['identity', 'scope'] as const)(
    'retains rotated tokens but refuses a changed SIWC %s',
    async (changed) => {
      const { authPath, source } = setupPi()
      await service.importCurrent('pi')
      const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
      const rotated =
        changed === 'identity'
          ? siwc('another-user', 'target-client', 'new')
          : { ...siwc('target-user', 'target-client', 'new'), scopes: ['openid'] }
      vi.mocked(network.refreshCredential).mockImplementation((value) =>
        Promise.resolve({
          ...value,
          auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }),
        }),
      )
      await expect(service.switch({ id: target.id })).rejects.toThrow('授权不匹配')
      const saved = new AccountStore(path).get(target.id)
      expect(saved.auth).toContain(rotated.refresh)
      expect(saved.needsReauthorization).toBe(true)
      expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
      await service.close()
    },
  )

  it('preserves unrelated account edits made during SIWC renewal', async () => {
    setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
    const started = deferred<void>()
    const finish = deferred<void>()
    const rotated = siwc('target-user', 'target-client', 'new')
    vi.mocked(network.refreshCredential).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }) }
    })
    const switching = service.switch({ id: target.id })
    await started.promise
    const external = new AccountStore(path)
    external.save({ ...external.get(target.id), alias: '外部修改' })
    finish.resolve()
    await switching
    const saved = new AccountStore(path).get(target.id)
    expect(saved.alias).toBe('外部修改')
    expect(saved.auth).toContain(rotated.refresh)
    await service.close()
  })

  it('keeps the active rotated token if saving final account metadata fails', async () => {
    const { authPath } = setupPi(siwc('current-user', 'current-client', 'old', 1))
    await service.importCurrent('pi')
    const target = (await service.list('pi')).profiles.find(
      (item) => item.providerKey === 'openai',
    )!
    const rotated = siwc('current-user', 'current-client', 'new')
    vi.mocked(network.refreshCredential).mockImplementation((value) =>
      Promise.resolve({
        ...value,
        auth: JSON.stringify({ kind: 'pi', auth: { openai: rotated } }),
      }),
    )
    const store = (service as unknown as { store: AccountStore }).store
    const save = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation((value) => {
      if (value.id === target.id && value.lastUsedAt !== null) throw new Error('metadata failed')
      return save(value)
    })
    await expect(service.switch({ id: target.id })).rejects.toThrow('登录令牌已更新')
    expect(JSON.parse(readFileSync(authPath, 'utf8')).openai).toEqual(rotated)
    expect(new AccountStore(path).get(target.id).auth).toContain(rotated.refresh)
    await service.close()
  })

  it('marks an invalid SIWC grant for reauthorization without replacing the active login', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc(siwc('target-user', 'target-client', 'old', 1))
    const actual = await vi.importActual<typeof network>('../../../src/main/accounts/network')
    vi.mocked(network.refreshCredential).mockImplementation(actual.refreshCredential)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 })),
    )
    await expect(service.switch({ id: target.id })).rejects.toThrow('账号认证失败')
    expect(new AccountStore(path).get(target.id).needsReauthorization).toBe(true)
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    await service.close()
  })

  it('does not switch two SIWC records that share a refresh token', async () => {
    const { authPath, source } = setupPi()
    await service.importCurrent('pi')
    const target = await addSiwc({
      ...siwc('target-user', 'target-client'),
      refresh: source.openai.refresh,
    })
    await expect(service.switch({ id: target.id })).rejects.toThrow('多个账号共用刷新令牌')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual(source)
    await service.close()
  })

  it('does not request quota for SIWC accounts', async () => {
    const target = await addSiwc(siwc('target-user', 'target-client'))
    await expect(service.refresh(target.id)).rejects.toThrow('暂不支持额度查询')
    expect(
      await service.refreshAutomatically(target.id, { allowed: () => true, due: () => true }),
    ).toBe(false)
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
    await service.close()
  })
})
