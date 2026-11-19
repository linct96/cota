import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as shell from '../../../src/main/system/shell'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { agentCliCacheSchema } from '../../../src/shared/agent-cli'
import { AgentCliCacheStore } from '../../../src/main/agents/cli/cache'
import { AgentCliManagement } from '../../../src/main/agents/cli/management'
import type { ExecuteCliInstall } from '../../../src/main/agents/cli/install-terminal'
import { ConfigStore } from '../../../src/main/settings/config-store'
import { cliManagement } from './cli-install.fixture'

describe('Agent CLI cached management', () => {
  it('synchronizes all Agents when an earlier check used a different PATH', async () => {
    const { restarted } = await cliManagement()
    const nextBin = join(root, 'next-bin')
    await mkdir(nextBin)
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(nextBin, provider), '#!/bin/sh\n', { mode: 0o700 })
    let path = join(root, 'bin')
    mocks.login.mockImplementation((file: string, args: string[]) =>
      Promise.resolve({
        stdout:
          args[0] === '--version'
            ? file.startsWith(nextBin)
              ? '0.160.0'
              : '0.159.0'
            : `\0${path}\0`,
        stderr: '',
      }),
    )

    await restarted.inspect(DEFAULT_CONFIG.preferences, false, 'pi')
    path = nextBin
    await restarted.inspect(DEFAULT_CONFIG.preferences, false, 'codex')
    expect(restarted.read().entries.pi.executable).toBe(join(root, 'bin', 'pi'))

    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    const cache = restarted.read()
    for (const provider of ['pi', 'codex', 'claude'] as const)
      expect(cache.entries[provider]).toMatchObject({
        pathEnv: expect.stringContaining(nextBin),
        executable: join(nextBin, provider),
        version: '0.160.0',
      })
  })

  it.skipIf(process.platform === 'win32')('uses the Homebrew receipt to classify agy', async () => {
    const { restarted } = await cliManagement()
    const executable = join(root, 'bin', 'agy')
    await writeFile(executable, '#!/bin/sh\n', { mode: 0o700 })
    expect(await restarted.inspect(DEFAULT_CONFIG.preferences, false, 'agy')).toEqual([
      expect.objectContaining({ provider: 'agy', installMethod: 'unknown' }),
    ])

    const cache = restarted.read()
    const legacyCache = agentCliCacheSchema.parse({
      entries: { ...cache.entries, agy: { ...cache.entries.agy, installMethod: 'native' } },
    })
    expect(legacyCache.entries.agy.installMethod).toBe('unknown')

    const cask = join(root, 'Caskroom', 'antigravity-cli')
    const wrapper = join(cask, '0.159.0,123', '.homebrew-command-wrappers')
    const receipt = join(cask, '.metadata', 'INSTALL_RECEIPT.json')
    await mkdir(wrapper, { recursive: true })
    await mkdir(join(cask, '.metadata'))
    await writeFile(join(wrapper, 'agy'), '#!/bin/sh\n', { mode: 0o700 })
    await rm(executable)
    await symlink(join(wrapper, 'agy'), executable)
    await writeFile(receipt, JSON.stringify({ source: { tap: 'homebrew/cask' } }))
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ version: '0.160.0,456' }))
    expect(await restarted.inspect(DEFAULT_CONFIG.preferences, true, 'agy')).toEqual([
      expect.objectContaining({ installMethod: 'brew', latestVersion: '0.160.0' }),
    ])
    expect(fetch).toHaveBeenCalledWith(
      'https://formulae.brew.sh/api/cask/antigravity-cli.json',
      expect.anything(),
    )
  })

  it('keeps a version-check error when synchronizing an unchanged CLI', async () => {
    const { restarted } = await cliManagement()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ version: '0.160.0' }))
    await restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    expect(restarted.read().entries.pi.updateError).toBe('版本服务返回 500')
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    await restarted.inspect(DEFAULT_CONFIG.preferences, false, 'pi')
    expect(restarted.read().entries.pi.updateError).toBe('版本服务返回 500')
    await restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    expect(restarted.read().entries.pi.updateError).toBe('版本服务返回 503')
    await restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(restarted.read().entries.pi).toMatchObject({
      latestVersion: '0.160.0',
      updateAvailable: true,
    })
    expect(restarted.read().entries.pi.updateError).toBe(undefined)
  })

  it('does not restore a CLI invalidated while a check is pending', async () => {
    const { restarted } = await cliManagement()
    const executable = join(root, 'bin', 'pi')
    const findExecutable = shell.findExecutable
    let removed = false
    vi.spyOn(shell, 'findExecutable').mockImplementation((command, env) =>
      command === 'pi' && removed
        ? Promise.reject(new shell.ExecutableNotFoundError('missing pi'))
        : findExecutable(command, env),
    )
    let release!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const checking = restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    await vi.waitFor(() => expect(release).toBeDefined())
    await expect(
      restarted.run('pi', DEFAULT_CONFIG.preferences, async () => {
        await rm(executable)
        removed = true
        throw new Error('spawn failed')
      }),
    ).rejects.toThrow('CLI 已不存在')
    expect(restarted.read().entries.pi).not.toHaveProperty('executable')
    release(Response.json({ version: '0.160.0' }))
    await checking
    expect(restarted.read().entries.pi).not.toHaveProperty('executable')
  })

  it('merges out-of-order checks without losing another Agent result', async () => {
    const { cacheFile, restarted, publish } = await cliManagement()
    publish.mockClear()
    const replies = new Map<string, (response: Response) => void>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (url) =>
        new Promise((resolve) => {
          const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          replies.set(address.includes('pi-coding-agent') ? 'pi' : 'codex', resolve)
        }),
    )
    const pi = restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    const codex = restarted.inspect(DEFAULT_CONFIG.preferences, true, 'codex')
    await vi.waitFor(() => expect(replies.size).toBe(2))
    replies.get('codex')!(Response.json({ version: '0.161.0' }))
    await codex
    replies.get('pi')!(Response.json({ version: '0.160.0' }))
    await pi
    const cache = restarted.read()
    expect(cache.entries.pi.latestVersion).toBe('0.160.0')
    expect(cache.entries.codex.latestVersion).toBe('0.161.0')
    const [afterCodex, afterPi] = publish.mock.calls.map(([value]) => value.entries)
    expect(afterCodex.pi.latestVersion).toBeUndefined()
    expect(afterPi.pi.checkedAt).toBeGreaterThan(afterCodex.pi.checkedAt)
    expect(afterPi.codex).toEqual(afterCodex.codex)
    const restored = new AgentCliCacheStore(cacheFile)
    await restored.load()
    expect(restored.snapshot()).toEqual(cache)
  })

  it('commits independent PATH snapshots without retrying another Agent scan', async () => {
    const { restarted } = await cliManagement()
    const nextBin = join(root, 'next-bin')
    await mkdir(nextBin)
    for (const provider of ['pi', 'codex'])
      await writeFile(join(nextBin, provider), '#!/bin/sh\n', { mode: 0o700 })
    let path = join(root, 'bin')
    mocks.login.mockImplementation((file: string, args: string[]) =>
      Promise.resolve({
        stdout:
          args[0] === '--version'
            ? file.startsWith(nextBin)
              ? '0.160.0'
              : '0.159.0'
            : `\0${path}\0`,
        stderr: '',
      }),
    )
    let release!: (response: Response) => void
    let piFetches = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address.includes('pi-coding-agent') && piFetches++ === 0)
        return new Promise((resolve) => {
          release = resolve
        })
      return Promise.resolve(Response.json({ version: '0.160.0' }))
    })
    const pi = restarted.inspect(DEFAULT_CONFIG.preferences, true, 'pi')
    await vi.waitFor(() => expect(piFetches).toBe(1))
    path = nextBin
    await restarted.inspect(DEFAULT_CONFIG.preferences, true, 'codex')
    release(Response.json({ version: '0.160.0' }))
    await pi
    const cache = restarted.read()
    expect(cache.entries.pi).toMatchObject({
      pathEnv: expect.stringContaining(join(root, 'bin')),
      executable: join(root, 'bin', 'pi'),
      version: '0.159.0',
      latestVersion: '0.160.0',
    })
    expect(cache.entries.codex).toMatchObject({
      pathEnv: expect.stringContaining(nextBin),
      executable: join(nextBin, 'codex'),
    })
    const command = await restarted.run('pi', DEFAULT_CONFIG.preferences, (resolved) =>
      Promise.resolve(resolved),
    )
    expect(command.env.PATH).toBe(cache.entries.pi.pathEnv)
  })

  it('synchronizes after the last concurrent update, including a failed update', async () => {
    const { restarted } = await cliManagement()
    const nextBin = join(root, 'next-bin')
    await mkdir(nextBin)
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(nextBin, provider), '#!/bin/sh\n', { mode: 0o700 })
    let path = join(root, 'bin')
    mocks.login.mockImplementation((file: string, args: string[]) =>
      Promise.resolve({
        stdout:
          args[0] === '--version'
            ? file.startsWith(nextBin)
              ? '0.160.0'
              : '0.159.0'
            : `\0${path}\0`,
        stderr: '',
      }),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.160.0' }))
    const waiting = new Map<
      string,
      {
        resolve: (value: { stdout: string; stderr: string }) => void
        reject: (error: Error) => void
      }
    >()
    const execute: ExecuteCliInstall = (command) =>
      new Promise((resolve, reject) => {
        const provider = command.executable === join(root, 'bin', 'pi') ? 'pi' : 'codex'
        waiting.set(provider, { resolve, reject })
      })
    const idle = vi.fn().mockResolvedValue(undefined)
    const pi = restarted.update('pi', DEFAULT_CONFIG.preferences, idle, execute)
    const codex = restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute)
    const failedCodex = expect(codex).rejects.toThrow('更新失败：network failed')
    await vi.waitFor(() => expect(waiting.size).toBe(2))

    path = nextBin
    mocks.login.mockClear()
    waiting.get('pi')!.resolve({ stdout: 'updated', stderr: '' })
    await pi
    expect(restarted.isUpdating('codex')).toBe(true)
    expect(
      mocks.login.mock.calls.some(
        ([file, args]) =>
          (file === join(root, 'bin', 'codex') || file === join(nextBin, 'codex')) &&
          args[0] === '--version',
      ),
    ).toBe(false)
    expect(restarted.read().entries.claude.executable).toBe(join(root, 'bin', 'claude'))

    waiting.get('codex')!.reject(new Error('network failed'))
    await failedCodex
    const cache = restarted.read()
    for (const provider of ['pi', 'codex', 'claude'] as const)
      expect(cache.entries[provider]).toMatchObject({
        pathEnv: expect.stringContaining(nextBin),
        executable: join(nextBin, provider),
        version: '0.160.0',
      })
  })

  it('retries a final synchronization if another update finishes while it is scanning', async () => {
    const { restarted, restored } = await cliManagement()
    const codexPath = join(root, 'bin', 'codex')
    const claudePath = join(root, 'bin', 'claude')
    const findExecutable = shell.findExecutable
    let removed = false
    vi.spyOn(shell, 'findExecutable').mockImplementation((command, env) =>
      command === 'codex' && removed
        ? Promise.reject(new shell.ExecutableNotFoundError('missing codex'))
        : findExecutable(command, env),
    )
    let releaseClaude!: () => void
    let held = false
    mocks.login.mockImplementation((file: string, args: string[]) => {
      if (file === claudePath && args[0] === '--version' && !held) {
        held = true
        return new Promise((resolve) => {
          releaseClaude = () => resolve({ stdout: '0.159.0', stderr: '' })
        })
      }
      return Promise.resolve({
        stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
        stderr: '',
      })
    })
    mocks.login.mockClear()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    const save = restored.save.bind(restored)
    let rejectedRefresh = false
    vi.spyOn(restored, 'save').mockImplementation((value) => {
      if (removed && !rejectedRefresh && !value.entries.codex.executable) {
        rejectedRefresh = true
        return Promise.reject(new Error('refresh failed'))
      }
      return save(value)
    })
    const idle = vi.fn().mockResolvedValue(undefined)
    const pi = restarted.update('pi', DEFAULT_CONFIG.preferences, idle, () =>
      Promise.resolve({ stdout: 'updated', stderr: '' }),
    )
    await vi.waitFor(() => {
      expect(releaseClaude).toBeDefined()
      expect(
        mocks.login.mock.calls.some(
          ([file, args]) => file === codexPath && args[0] === '--version',
        ),
      ).toBe(true)
    })
    await expect(
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, async () => {
        await rm(codexPath)
        removed = true
        throw new Error('update interrupted')
      }),
    ).rejects.toThrow('缓存同步失败：refresh failed')
    releaseClaude()
    expect((await pi).status.installing).toBe(false)
    expect(restarted.read().entries.codex).not.toHaveProperty('executable')
  })

  it.each([false, true])(
    'reports a failed final cache synchronization after an update (command failed: %s)',
    async (commandFailed) => {
      const { restarted, restored } = await cliManagement()
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
      const save = restored.save.bind(restored)
      let saves = 0
      vi.spyOn(restored, 'save').mockImplementation((value) =>
        ++saves === 2 ? Promise.reject(new Error('disk full')) : save(value),
      )
      const failure = await restarted
        .update('pi', DEFAULT_CONFIG.preferences, vi.fn().mockResolvedValue(undefined), () =>
          commandFailed
            ? Promise.reject(new Error('network failed'))
            : Promise.resolve({ stdout: 'updated', stderr: '' }),
        )
        .catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain('缓存同步失败：disk full')
      if (commandFailed) expect((failure as Error).message).toContain('更新失败：network failed')
      expect(restarted.isUpdating('pi')).toBe(false)
    },
  )

  it('persists CLI discovery and invalidates missing executables without losing recoverable errors', async () => {
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
    mocks.login.mockImplementation((_file: string, args: string[]) => {
      try {
        return Promise.resolve({
          stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
        })
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    const configFile = join(root, 'config.json')
    const cacheFile = join(root, 'agent-cli.json')
    const legacyConfig = JSON.stringify({
      ...DEFAULT_CONFIG,
      preferences: { ...DEFAULT_CONFIG.preferences, scrollback: 4321 },
      agentCliCache: agentCliCacheSchema.parse({
        entries: Object.fromEntries(
          ['pi', 'codex', 'claude', 'agy'].map((provider) => [
            provider,
            { checkedAt: 1, pathEnv: '/obsolete' },
          ]),
        ),
      }),
    })
    await writeFile(configFile, legacyConfig)
    await writeFile(cacheFile, '{invalid')
    const config = new ConfigStore(configFile)
    await config.load()
    expect(config.snapshot()).not.toHaveProperty('agentCliCache')
    const settings = config.snapshot().preferences
    expect(settings.scrollback).toBe(4321)
    const publish = vi.fn()
    const store = new AgentCliCacheStore(cacheFile)
    const agents = new AgentCliManagement(store, publish)
    await agents.initialize(settings)
    expect(Object.keys(agents.read().entries)).toHaveLength(4)
    expect(agents.read().entries.agy).not.toHaveProperty('executable')
    expect(
      Object.values(agents.read().entries)
        .filter((entry) => entry.executable)
        .every((entry) => entry.version === '0.159.0' && entry.installMethod === 'unknown'),
    ).toBe(true)
    // Keep absence deterministic even on a developer machine with other installed copies.
    const cache = agents.read()
    for (const entry of Object.values(cache.entries)) entry.pathEnv = join(root, 'bin')
    await store.save(cache)
    const probes = mocks.login.mock.calls.length
    const restored = new AgentCliCacheStore(cacheFile)
    const restarted = new AgentCliManagement(restored, publish)
    await restarted.initialize(settings)
    expect(restarted.read()).toEqual(agents.read())
    const launch = vi.fn((command) => {
      try {
        return Promise.resolve(command.args)
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    expect(await restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).toEqual([
      '--no-daemon',
    ])
    expect(mocks.login).toHaveBeenCalledTimes(probes)
    const saved = restarted.read()
    for (const failure of [
      new Error('CLI exited 1'),
      Object.assign(new Error('cwd missing'), { code: 'ENOENT' }),
      Object.assign(new Error('interpreter missing'), {
        code: 'ENOENT',
        path: join(root, 'bin', 'codex'),
      }),
    ]) {
      await expect(
        restarted.run('codex', DEFAULT_CONFIG.preferences, () => Promise.reject(failure)),
      ).rejects.toBe(failure)
      expect(restarted.read()).toEqual(saved)
    }
    await chmod(join(root, 'bin', 'codex'), 0o600)
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow('权限')
    expect(restarted.read()).toEqual(saved)
    await chmod(join(root, 'bin', 'codex'), 0o700)
    await expect(
      restarted.run('codex', DEFAULT_CONFIG.preferences, async () => {
        await rm(join(root, 'bin', 'codex'))
        throw new Error('Host spawn failed')
      }),
    ).rejects.toThrow('CLI 已不存在')
    launch.mockClear()
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
      '未安装',
    )
    expect(launch).not.toHaveBeenCalled()
    expect(restarted.read().entries.codex).not.toHaveProperty('executable')
    expect(JSON.parse(await readFile(cacheFile, 'utf8'))).toEqual(restarted.read())
    expect(await readFile(configFile, 'utf8')).toBe(legacyConfig)
    expect(publish).toHaveBeenLastCalledWith(restarted.read())
    expect(mocks.login).toHaveBeenCalledTimes(probes)
  })
})
