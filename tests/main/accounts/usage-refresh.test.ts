import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { DEFAULT_USAGE_REFRESH_SETTINGS } from '../../../src/shared/accounts'
import type { AccountProduct, AccountUsageRefreshStatus } from '../../../src/shared/accounts'
import { AccountCredentials } from '../../../src/main/accounts/credentials'
import { GROK_AUTH_KEY, normalizeCredential } from '../../../src/main/accounts/credential-data'
import { AccountService } from '../../../src/main/accounts/service'
import { AccountOAuth } from '../../../src/main/accounts/oauth'
import { AccountStore } from '../../../src/main/accounts/store'
import type { StoredAccount } from '../../../src/main/accounts/store'
import { AccountUsageScheduler } from '../../../src/main/accounts/usage-refresh'
import * as network from '../../../src/main/accounts/network'

vi.mock('../../../src/main/accounts/network', async (importOriginal) => {
  const actual = await importOriginal<typeof network>()
  return {
    ...actual,
    refreshCredential: vi.fn((value: StoredAccount) => Promise.resolve(value)),
    refreshAccountUsage: vi.fn((value: StoredAccount) =>
      Promise.resolve({ ...value, usageUpdatedAt: Date.now() }),
    ),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function account(
  id: string,
  product: AccountProduct,
  extra: Partial<StoredAccount> = {},
): StoredAccount {
  const providerKey = extra.providerKey ?? (product === 'pi' ? 'openai-codex' : '')
  const nativeAuth =
    product === 'codex'
      ? extra.accountType === 'relay'
        ? { auth_mode: 'apikey', OPENAI_API_KEY: `sk-${id}` }
        : {
            tokens: {
              access_token: `access-${id}`,
              refresh_token: `refresh-${id}`,
              account_id: id,
            },
          }
      : product === 'claude'
        ? { env: { CLAUDE_CODE_OAUTH_TOKEN: `token-${id}` } }
        : product === 'pi'
          ? {
              [providerKey]: {
                type: 'oauth',
                access: `access-${id}`,
                refresh: `refresh-${id}`,
                expires: 9e12,
                accountId: id,
              },
            }
          : {
              [GROK_AUTH_KEY]: {
                auth_mode: 'oidc',
                user_id: id,
                key: `access-${id}`,
                refresh_token: `refresh-${id}`,
              },
            }
  const kind = product
  return {
    id,
    product,
    providerKey,
    accountType: 'oauth',
    alias: id,
    email: '',
    accountId: id,
    planType: '',
    apiBaseUrl: null,
    auth: JSON.stringify({ kind, auth: nativeAuth }),
    usagePrimary: null,
    usageSecondary: null,
    usageUpdatedAt: null,
    updatedAt: 1,
    lastUsedAt: null,
    needsReauthorization: false,
    sortOrder: 0,
    ...extra,
  }
}

let root: string
let stateFile: string
let service: AccountService
let scheduler: AccountUsageScheduler | undefined
let now: number
let readCurrent: ReturnType<typeof vi.fn<AccountCredentials['current']>>
let events: AccountUsageRefreshStatus[]
let waiters: Map<string, ReturnType<typeof deferred<AccountUsageRefreshStatus>>>

function waitForAccount(id: string) {
  const waiter = deferred<AccountUsageRefreshStatus>()
  waiters.set(id, waiter)
  return waiter.promise
}

function createScheduler(enabled = true) {
  scheduler = new AccountUsageScheduler(
    service,
    stateFile,
    { ...DEFAULT_USAGE_REFRESH_SETTINGS, enabled },
    () => true,
    (event) => {
      events.push(event)
      if (!event.refreshing) waiters.get(event.id)?.resolve(event)
    },
  )
  return scheduler
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cota-usage-refresh-'))
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'pi'))
  vi.stubEnv('GROK_HOME', join(root, 'grok'))
  vi.stubEnv('CODEX_HOME', join(root, 'codex'))
  stateFile = join(root, 'runtime', 'usage.json')
  service = new AccountService(join(root, 'providers.json'), () => {})
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  readCurrent = vi.fn<AccountCredentials['current']>().mockResolvedValue([])
  vi.spyOn(AccountCredentials.prototype, 'current').mockImplementation(readCurrent)
  vi.spyOn(AccountCredentials.prototype, 'revision').mockResolvedValue('stable')
  vi.mocked(network.refreshCredential)
    .mockReset()
    .mockImplementation((value) => Promise.resolve(value))
  vi.mocked(network.refreshAccountUsage)
    .mockReset()
    .mockImplementation((value) => Promise.resolve({ ...value, usageUpdatedAt: Date.now() }))
  events = []
  waiters = new Map()
})

afterEach(async () => {
  await scheduler?.close()
  scheduler = undefined
  await service.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

describe('refresh after saving credentials', () => {
  it('refreshes a new account once even when periodic refresh is disabled', async () => {
    const started = deferred<StoredAccount>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve(value)
      await finish.promise
      return { ...value, usageUpdatedAt: now }
    })
    await createScheduler(false).start()
    await service.add({
      product: 'codex',
      mode: 'credential',
      credential: account('new', 'codex').auth,
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    const saved = (await service.list('codex')).profiles[0]
    const finished = waitForAccount(saved.id)
    expect((await started.promise).id).toBe(saved.id)
    expect(saved.usageUpdatedAt).toBeNull()
    finish.resolve()
    expect((await finished).error).toBeUndefined()
    expect((await service.list('codex')).profiles[0].usageUpdatedAt).toBe(now)

    const scanned = deferred<void>()
    const list = service.list.bind(service)
    vi.spyOn(service, 'list').mockImplementation(async (product) => {
      const status = await list(product)
      if (product === 'grok') scanned.resolve()
      return status
    })
    scheduler?.configure(DEFAULT_USAGE_REFRESH_SETTINGS)
    await scanned.promise
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
    scheduler?.configure({ ...DEFAULT_USAGE_REFRESH_SETTINGS, enabled: false })
    now += 60 * 60_000
    scheduler?.wake()
    await scheduler?.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
  })

  it('refreshes after browser authorization saves the account', async () => {
    const queried = deferred<StoredAccount>()
    vi.mocked(network.refreshAccountUsage).mockImplementation((value) => {
      queried.resolve(value)
      return Promise.resolve({ ...value, usageUpdatedAt: now })
    })
    vi.spyOn(AccountOAuth.prototype, 'start').mockImplementation(function (
      this: AccountOAuth,
      product,
      alias,
    ) {
      const oauth = this as unknown as {
        save: (
          product: AccountProduct,
          auth: Record<string, unknown>,
          alias: string,
        ) => Promise<void>
      }
      return oauth.save(product, JSON.parse(account('oauth', 'codex').auth), alias)
    })
    await createScheduler(false).start()
    await service.startOAuth('codex', '授权账号')
    expect((await queried.promise).alias).toBe('授权账号')
    await scheduler?.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
  })

  it('refreshes each supported Pi credential after a multi-account import', async () => {
    mkdirSync(join(root, 'pi'), { recursive: true })
    const entries = [account('openai', 'pi'), account('xai', 'pi', { providerKey: 'xai' })].map(
      (item) => normalizeCredential('pi', JSON.parse(item.auth)),
    )
    readCurrent.mockImplementation((product) => Promise.resolve(product === 'pi' ? entries : []))
    const queried = deferred<void>()
    let count = 0
    vi.mocked(network.refreshAccountUsage).mockImplementation((value) => {
      if (++count === 2) queried.resolve()
      return Promise.resolve({ ...value, usageUpdatedAt: now })
    })
    await createScheduler(false).start()
    expect(await service.importCurrent('pi')).toBe(2)
    await queried.promise
    await scheduler?.close()
    expect(
      vi.mocked(network.refreshAccountUsage).mock.calls.map(([value]) => value.providerKey),
    ).toEqual(['openai-codex', 'xai'])
  })

  it('does not refresh unsupported or unsuccessfully imported credentials', async () => {
    const entries = [account('openai', 'pi'), account('xai', 'pi', { providerKey: 'xai' })].map(
      (item) => normalizeCredential('pi', JSON.parse(item.auth)),
    )
    entries[1] = { ...entries[1], auth: '{' }
    readCurrent.mockResolvedValue(entries)
    await createScheduler(false).start()
    await expect(service.importCurrent('pi')).rejects.toThrow()
    expect((await service.list('pi')).profiles).toEqual([])
    await service.add({
      product: 'claude',
      mode: 'credential',
      credential: account('claude', 'claude').auth,
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    await service.add({
      product: 'pi',
      mode: 'credential',
      credential: JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'opaque-access',
          refresh: 'refresh',
          expires: 9e12,
          clientId: 'client',
          scopes: ['chatgpt.tokens.use.direct'],
        },
      }),
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    await service.add({
      product: 'codex',
      mode: 'relay',
      credential: '',
      alias: '',
      apiBaseUrl: 'https://example.com',
      apiKey: 'api-key',
    })
    await scheduler?.close()
    expect(events).toEqual([])
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
  })

  it('preserves the last quota and does not retry on a failed reimport when disabled', async () => {
    const previous = { usedPercent: 42, windowMinutes: 300, resetsAt: null }
    const item = account('existing', 'codex', { usagePrimary: previous, usageUpdatedAt: now })
    new AccountStore(join(root, 'providers.json')).save(item)
    readCurrent.mockResolvedValue([normalizeCredential('codex', JSON.parse(item.auth))])
    vi.mocked(network.refreshAccountUsage).mockRejectedValue(new Error('额度服务不可用'))
    await createScheduler(false).start()
    const finished = waitForAccount(item.id)
    expect(await service.importCurrent('codex')).toBe(1)
    expect((await finished).error).toBe('额度服务不可用')
    const saved = new AccountStore(join(root, 'providers.json')).get(item.id)
    expect(saved.usagePrimary).toEqual(previous)
    expect(saved.usageUpdatedAt).toBe(now)
    now += 60 * 60_000
    scheduler?.wake()
    await scheduler?.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
  })

  it('does not start a saved-account refresh after shutdown', async () => {
    const reading = deferred<void>()
    const finishReading = deferred<ReturnType<typeof normalizeCredential>[]>()
    readCurrent.mockImplementation(() => {
      reading.resolve()
      return finishReading.promise
    })
    const instance = createScheduler()
    await instance.start()
    await reading.promise
    await service.add({
      product: 'codex',
      mode: 'credential',
      credential: account('new', 'codex').auth,
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    const closing = instance.close()
    finishReading.resolve([])
    await closing
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
  })

  it('keeps shared refresh-token protection for an immediate refresh', async () => {
    const codex = account('codex', 'codex', {
      auth: JSON.stringify({
        kind: 'codex',
        auth: { tokens: { access_token: 'access', refresh_token: 'shared', account_id: 'codex' } },
      }),
    })
    const pi = account('pi', 'pi', {
      auth: JSON.stringify({
        kind: 'pi',
        auth: {
          'openai-codex': { type: 'oauth', access: 'pi-access', refresh: 'shared', expires: 9e12 },
        },
      }),
    })
    const store = new AccountStore(join(root, 'providers.json'))
    store.save(codex)
    store.save(pi)
    await createScheduler(false).start()
    const finished = waitForAccount(codex.id)
    await service.add({
      product: 'codex',
      mode: 'credential',
      credential: codex.auth,
      alias: '',
      apiBaseUrl: '',
      apiKey: '',
    })
    expect((await finished).error).toContain('多个账号共用刷新令牌')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
  })

  it('merges an immediate refresh into a queued periodic refresh using the saved credentials', async () => {
    const item = account('existing', 'codex', { usageUpdatedAt: now - 31 * 60_000 })
    new AccountStore(join(root, 'providers.json')).save(item)
    const updated = JSON.parse(item.auth)
    updated.auth.tokens.access_token = 'new-access'
    updated.auth.tokens.refresh_token = 'new-refresh'
    const credential = normalizeCredential('codex', updated)
    const reading = deferred<void>()
    const finishImport = deferred<(typeof credential)[]>()
    let reads = 0
    readCurrent.mockImplementation(async () => {
      if (++reads === 1) {
        reading.resolve()
        return finishImport.promise
      }
      return [credential]
    })
    const instance = createScheduler(false)
    await instance.start()
    const importing = service.importCurrent('codex')
    await reading.promise
    const queued = deferred<void>()
    const refresh = service.refreshAutomatically.bind(service)
    vi.spyOn(service, 'refreshAutomatically').mockImplementation((id, automatic) => {
      queued.resolve()
      return refresh(id, automatic)
    })
    instance.configure(DEFAULT_USAGE_REFRESH_SETTINGS)
    await queued.promise
    const finished = waitForAccount(item.id)
    instance.configure({ ...DEFAULT_USAGE_REFRESH_SETTINGS, enabled: false })
    finishImport.resolve([credential])
    expect(await importing).toBe(1)
    expect((await finished).error).toBeUndefined()
    await instance.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
    const queried = vi.mocked(network.refreshAccountUsage).mock.calls[0][0]
    expect(queried.id).toBe(item.id)
    expect(queried.auth).toContain('new-access')
  })

  it('runs the saved-account request if a joined periodic refresh was skipped', async () => {
    const item = account('existing', 'codex', { usageUpdatedAt: now - 31 * 60_000 })
    new AccountStore(join(root, 'providers.json')).save(item)
    readCurrent.mockResolvedValue([normalizeCredential('codex', JSON.parse(item.auth))])
    const instance = createScheduler(false)
    await instance.start()
    const queued = deferred<void>()
    const skipped = deferred<boolean>()
    const refresh = service.refreshAutomatically.bind(service)
    vi.spyOn(service, 'refreshAutomatically')
      .mockImplementationOnce(() => {
        queued.resolve()
        return skipped.promise
      })
      .mockImplementation(refresh)
    instance.configure(DEFAULT_USAGE_REFRESH_SETTINGS)
    await queued.promise
    const finished = waitForAccount(item.id)
    await service.importCurrent('codex')
    skipped.resolve(false)
    expect((await finished).error).toBeUndefined()
    await instance.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledOnce()
    expect(events.filter((event) => event.id === item.id).map((event) => event.refreshing)).toEqual(
      [true, false],
    )
  })
})

describe('background account usage refresh', () => {
  it('refreshes due supported OAuth accounts with separate active and inactive intervals', async () => {
    const store = new AccountStore(join(root, 'providers.json'))
    const active = account('active', 'codex', { usageUpdatedAt: now - 5 * 60_000 })
    for (const item of [
      active,
      account('recent', 'codex', { usageUpdatedAt: now - 29 * 60_000 }),
      account('inactive', 'codex', { usageUpdatedAt: now - 30 * 60_000 }),
      account('relay', 'codex', { accountType: 'relay' }),
      account('expired', 'codex', { needsReauthorization: true }),
      account('pi-openai', 'pi'),
      account('pi-xai', 'pi', { providerKey: 'xai' }),
      account('pi-unsupported', 'pi', { providerKey: 'other' }),
      account('grok', 'grok'),
      account('claude', 'claude'),
    ])
      store.save(item)
    readCurrent.mockImplementation((product) =>
      Promise.resolve(
        product === 'codex' ? [normalizeCredential('codex', JSON.parse(active.auth))] : [],
      ),
    )

    const finished = waitForAccount('grok')
    await createScheduler().start()
    await finished
    await scheduler?.close()
    expect(vi.mocked(network.refreshAccountUsage).mock.calls.map(([value]) => value.id)).toEqual([
      'active',
      'inactive',
      'pi-openai',
      'pi-xai',
      'grok',
    ])
    expect(events.filter((event) => event.error)).toEqual([])
    const saved = readFileSync(stateFile, 'utf8')
    expect(Object.keys(JSON.parse(saved).attempts)).toEqual([
      'active',
      'inactive',
      'pi-openai',
      'pi-xai',
      'grok',
    ])
    expect(saved).not.toContain('refresh-active')
    expect(saved).not.toContain('access-active')
  })

  it('refreshes when a quota reset time has passed without spamming before the interval', async () => {
    const resetAt = now - 5_000
    new AccountStore(join(root, 'providers.json')).save(
      account('reset-due', 'codex', {
        usageUpdatedAt: now - 60_000,
        usagePrimary: { usedPercent: 90, windowMinutes: 300, resetsAt: resetAt },
      }),
    )

    const finished = waitForAccount('reset-due')
    await createScheduler().start()
    await finished
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)

    now += 10_000
    const scanned = deferred<void>()
    const list = service.list.bind(service)
    vi.spyOn(service, 'list').mockImplementation(async (product) => {
      const result = await list(product)
      if (product === 'grok') scanned.resolve()
      return result
    })
    scheduler?.wake()
    await scanned.promise
    await scheduler?.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)
  })

  it('checks when enabled and on wake, then stays stopped after exit', async () => {
    new AccountStore(join(root, 'providers.json')).save(account('active', 'codex'))
    const instance = createScheduler(false)
    await instance.start()
    expect(network.refreshAccountUsage).not.toHaveBeenCalled()
    let finished = waitForAccount('active')
    instance.configure(DEFAULT_USAGE_REFRESH_SETTINGS)
    await finished
    now += 31 * 60_000
    finished = waitForAccount('active')
    instance.wake()
    await finished
    await instance.close()
    now += 31 * 60_000
    instance.wake()
    await Promise.resolve()
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(2)
  })

  it('stops scheduling when disabled but lets an in-flight refresh finish', async () => {
    const store = new AccountStore(join(root, 'providers.json'))
    store.save(account('first', 'codex'))
    store.save(account('second', 'codex'))
    const started = deferred<void>()
    const finish = deferred<void>()
    vi.mocked(network.refreshAccountUsage).mockImplementation(async (value) => {
      started.resolve()
      await finish.promise
      return { ...value, usageUpdatedAt: Date.now() }
    })
    const completed = waitForAccount('first')
    await createScheduler().start()
    await started.promise
    scheduler?.configure({ ...DEFAULT_USAGE_REFRESH_SETTINGS, enabled: false })
    finish.resolve()
    await completed
    await scheduler?.close()
    expect(vi.mocked(network.refreshAccountUsage).mock.calls.map(([value]) => value.id)).toEqual([
      'first',
    ])
    expect(new AccountStore(join(root, 'providers.json')).get('first').usageUpdatedAt).toBe(now)
  })

  it('persists failed attempt times across restarts and retries only when due', async () => {
    const item = account('active', 'codex')
    new AccountStore(join(root, 'providers.json')).save(item)
    readCurrent.mockImplementation((product) =>
      Promise.resolve(
        product === 'codex' ? [normalizeCredential('codex', JSON.parse(item.auth))] : [],
      ),
    )
    vi.mocked(network.refreshCredential).mockRejectedValue(new Error('服务不可用'))
    let finished = waitForAccount('active')
    await createScheduler().start()
    expect((await finished).error).toBe('服务不可用')
    await scheduler?.close()
    expect(network.refreshCredential).toHaveBeenCalledTimes(1)

    now += 10_000
    const scanned = deferred<void>()
    const list = service.list.bind(service)
    vi.spyOn(service, 'list').mockImplementation(async (product) => {
      const result = await list(product)
      if (product === 'grok') scanned.resolve()
      return result
    })
    await createScheduler().start()
    await scanned.promise
    await scheduler?.close()
    expect(network.refreshCredential).toHaveBeenCalledTimes(1)

    now += 5 * 60_000
    finished = waitForAccount('active')
    await createScheduler().start()
    expect((await finished).error).toBe('服务不可用')
    expect(network.refreshCredential).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['HTTP 401', new network.AccountNetworkError('请重新授权', 401)],
    ['invalid_grant', new network.AccountNetworkError('请重新授权', 400, true)],
  ])('preserves the last quota and pauses automatic retries after %s', async (_name, failure) => {
    const previous = { usedPercent: 42, windowMinutes: 300, resetsAt: null }
    new AccountStore(join(root, 'providers.json')).save(
      account('active', 'codex', { usagePrimary: previous, usageUpdatedAt: now - 31 * 60_000 }),
    )
    vi.mocked(network.refreshAccountUsage).mockRejectedValue(failure)
    const finished = waitForAccount('active')
    await createScheduler().start()
    expect((await finished).error).toBe('请重新授权')
    await scheduler?.close()
    const saved = new AccountStore(join(root, 'providers.json')).get('active')
    expect(saved.needsReauthorization).toBe(true)
    expect(saved.usagePrimary).toEqual(previous)

    now += 60 * 60_000
    const scanned = deferred<void>()
    const list = service.list.bind(service)
    vi.spyOn(service, 'list').mockImplementation(async (product) => {
      const result = await list(product)
      if (product === 'grok') scanned.resolve()
      return result
    })
    await createScheduler().start()
    await scanned.promise
    await scheduler?.close()
    expect(network.refreshAccountUsage).toHaveBeenCalledTimes(1)
  })

  it('recognizes invalid_grant without exposing the response body', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'secret-value' }),
          {
            status: 400,
          },
        ),
      )
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', fakeFetch)
    const invalid = await network
      .requestJSON('https://example.invalid')
      .catch((error: unknown) => error)
    expect(invalid).toMatchObject({ status: 400, reauthorizationRequired: true })
    expect((invalid as Error).message).not.toContain('secret-value')
    const ordinary = await network
      .requestJSON('https://example.invalid')
      .catch((error: unknown) => error)
    expect(ordinary).toMatchObject({ status: 400, reauthorizationRequired: false })
  })

  it('waits for Pi credential ownership instead of racing another Pi process', async () => {
    const item = account('pi', 'pi')
    new AccountStore(join(root, 'providers.json')).save(item)
    const piHome = join(root, 'pi')
    mkdirSync(piHome)
    const release = await lock(join(piHome, 'auth.json'), { realpath: false })
    try {
      const finished = waitForAccount('pi')
      await createScheduler().start()
      expect((await finished).error).toContain('Pi 正在更新认证信息')
      expect(network.refreshCredential).not.toHaveBeenCalled()
    } finally {
      await release()
    }
  })

  it.each(['codex', 'grok'] as const)(
    'updates %s credentials without rewriting CLI configuration',
    async (product) => {
      const item = account('active', product)
      if (product === 'grok') {
        const envelope = JSON.parse(item.auth)
        item.auth = JSON.stringify({
          ...envelope,
          auth: {
            [GROK_AUTH_KEY]: { ...envelope.auth[GROK_AUTH_KEY], user_id: 'active' },
          },
        })
      }
      new AccountStore(join(root, 'providers.json')).save(item)
      const home = join(root, product)
      mkdirSync(home)
      const configPath = join(home, 'config.toml')
      const config = '# 保留注释和排版\nmodel = "test-model" # untouched\n'
      writeFileSync(configPath, config)
      const authPath = join(home, 'auth.json')
      const original = JSON.parse(item.auth).auth
      writeFileSync(authPath, JSON.stringify(original))
      vi.restoreAllMocks()
      vi.mocked(network.refreshCredential).mockImplementation((value) => {
        const envelope = JSON.parse(value.auth)
        const auth = envelope.auth
        if (product === 'codex')
          auth.tokens = { ...auth.tokens, access_token: 'new-access', refresh_token: 'new-refresh' }
        else Object.assign(auth[GROK_AUTH_KEY], { key: 'new-access', refresh_token: 'new-refresh' })
        return Promise.resolve({ ...value, auth: JSON.stringify(envelope) })
      })
      expect(
        await service.refreshAutomatically('active', { allowed: () => true, due: () => true }),
      ).toBe(true)
      expect(readFileSync(configPath, 'utf8')).toBe(config)
      const saved = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(
        product === 'codex' ? saved.tokens.refresh_token : saved[GROK_AUTH_KEY].refresh_token,
      ).toBe('new-refresh')
    },
  )

  it('keeps external CLI changes and the rotated token if configuration changes during renewal', async () => {
    const item = account('active', 'codex')
    new AccountStore(join(root, 'providers.json')).save(item)
    const home = join(root, 'codex')
    mkdirSync(home)
    const configPath = join(home, 'config.toml')
    const authPath = join(home, 'auth.json')
    const nativeAuth = JSON.stringify(JSON.parse(item.auth).auth)
    writeFileSync(configPath, 'model = "before"\n')
    writeFileSync(authPath, nativeAuth)
    vi.restoreAllMocks()
    const started = deferred<void>()
    const finish = deferred<StoredAccount>()
    vi.mocked(network.refreshCredential).mockImplementation(() => {
      started.resolve()
      return finish.promise
    })
    const refreshing = service.refreshAutomatically('active', {
      allowed: () => true,
      due: () => true,
    })
    await started.promise
    writeFileSync(configPath, 'model = "after"\n')
    finish.resolve({
      ...item,
      auth: JSON.stringify({
        kind: 'codex',
        auth: {
          tokens: { access_token: 'rotated', refresh_token: 'new-refresh', account_id: 'active' },
        },
      }),
    })
    await expect(refreshing).rejects.toThrow('当前 CLI 登录已变化')
    expect(readFileSync(configPath, 'utf8')).toBe('model = "after"\n')
    expect(readFileSync(authPath, 'utf8')).toBe(nativeAuth)
    const stored = new AccountStore(join(root, 'providers.json')).get('active')
    expect(stored.auth).toContain('new-refresh')
    expect(stored.needsReauthorization).toBe(true)
    await expect(service.refresh('active')).rejects.toThrow('请先导入当前登录或重新授权')
    expect(network.refreshCredential).toHaveBeenCalledTimes(1)
    expect(new AccountStore(join(root, 'providers.json')).get('active').auth).toContain(
      'new-refresh',
    )
  })

  it('protects a rotated Pi credential when the authentication lock is compromised', async () => {
    const item = account('pi', 'pi')
    new AccountStore(join(root, 'providers.json')).save(item)
    vi.spyOn(AccountCredentials.prototype, 'withPiLock').mockImplementation((action) =>
      action(() => {
        throw new Error('Pi 认证锁已失效')
      }),
    )
    vi.mocked(network.refreshCredential).mockImplementation((value) => {
      const envelope = JSON.parse(value.auth)
      return Promise.resolve({
        ...value,
        auth: JSON.stringify({
          ...envelope,
          auth: {
            'openai-codex': { ...envelope.auth['openai-codex'], refresh: 'rotated-refresh' },
          },
        }),
      })
    })
    await expect(
      service.refreshAutomatically('pi', { allowed: () => true, due: () => true }),
    ).rejects.toThrow('Pi 认证锁已失效')
    const saved = new AccountStore(join(root, 'providers.json')).get('pi')
    expect(saved.auth).toContain('rotated-refresh')
    expect(saved.needsReauthorization).toBe(true)
  })

  it('persists and applies rotated Pi credentials while holding its shared lock', async () => {
    const item = account('pi', 'pi')
    new AccountStore(join(root, 'providers.json')).save(item)
    const piHome = join(root, 'pi')
    mkdirSync(piHome)
    const authPath = join(piHome, 'auth.json')
    writeFileSync(authPath, JSON.stringify(JSON.parse(item.auth).auth))
    vi.restoreAllMocks()
    vi.mocked(network.refreshCredential).mockImplementation((value) => {
      const envelope = JSON.parse(value.auth)
      return Promise.resolve({
        ...value,
        auth: JSON.stringify({
          ...envelope,
          auth: {
            'openai-codex': {
              ...envelope.auth['openai-codex'],
              access: 'rotated-access',
              refresh: 'rotated-refresh',
            },
          },
        }),
      })
    })
    expect(await service.refreshAutomatically('pi', { allowed: () => true, due: () => true })).toBe(
      true,
    )
    expect(JSON.parse(readFileSync(authPath, 'utf8'))['openai-codex'].refresh).toBe(
      'rotated-refresh',
    )
    expect(new AccountStore(join(root, 'providers.json')).get('pi').auth).toContain(
      'rotated-refresh',
    )
  })

  it('does not overwrite a malformed runtime file or start automatic requests', async () => {
    new AccountStore(join(root, 'providers.json')).save(account('active', 'codex'))
    const directory = join(root, 'runtime')
    mkdirSync(directory)
    writeFileSync(stateFile, '{broken')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const finished = waitForAccount('active')
    await createScheduler().start()
    expect((await finished).error).toContain('无法读取额度刷新记录')
    expect(network.refreshCredential).not.toHaveBeenCalled()
    expect(readFileSync(stateFile, 'utf8')).toBe('{broken')
  })
})
