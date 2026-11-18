import { root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  hookFiles,
  inspectAgentHook,
  installAgentHook,
  trustAgentHook,
  uninstallAgentHook,
} from '../../../src/main/agents/hooks/managed'

import { codexRpc, userHookConfig } from './hooks.fixture'

describe('Managed Agent Hook files', () => {
  it('adds and removes only the named Antigravity hook', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    const { config, command } = hookFiles('agy', env)
    expect(config).toBe(join(root, '.gemini', 'config', 'hooks.json'))
    await mkdir(join(config, '..'), { recursive: true })
    const existing = { 'user-hook': { enabled: false, Stop: [{ command: 'keep' }] } }
    await writeFile(config, JSON.stringify(existing))
    expect((await installAgentHook('agy', env)).state).toBe('installed')
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({
      ...existing,
      'cota-agent-status': Object.fromEntries(
        ['SessionStart', 'PreInvocation', 'Stop'].map((name) => [
          name,
          [{ type: 'command', command: `${command}:${name}`, timeout: 2 }],
        ]),
      ),
    })
    expect((await uninstallAgentHook('agy', env)).state).toBe('missing')
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual(existing)
    const conflict = JSON.stringify({ 'cota-agent-status': existing['user-hook'] })
    await writeFile(config, conflict)
    await expect(installAgentHook('agy', env)).rejects.toThrow('不属于 Cota')
    expect(await readFile(config, 'utf8')).toBe(conflict)
  })
  it('installs Codex and Claude Hooks concurrently with one shared loader', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    const codex = await userHookConfig('codex', env)
    const claude = await userHookConfig('claude', env)
    const statuses = await Promise.all([
      installAgentHook('codex', env),
      installAgentHook('claude', env),
    ])
    expect(statuses.map((status) => status.state)).toEqual(['installed', 'installed'])
    expect(codex.paths.loader).toBe(claude.paths.loader)
    expect(await readFile(codex.paths.loader, 'utf8')).toContain('cota-managed-agent-hook:')
    for (const paths of [codex.paths, claude.paths]) {
      const config = JSON.parse(await readFile(paths.config, 'utf8'))
      expect(config.hooks.Stop[0].hooks).toContainEqual({ type: 'command', command: 'user-hook' })
    }
  })

  it.each(['codex', 'claude'] as const)(
    'installs %s Hooks without implicit trust and preserves user configuration',
    async (provider) => {
      const env = { HOME: root, PATH: join(root, 'bin') }
      const { trustRecords, trustRequests } = codexRpc(env)
      const { paths, original, trustConfig, userToml } = await userHookConfig(provider, env)
      if (provider === 'codex')
        await expect(trustAgentHook(provider, env)).rejects.toThrow('请先安装或更新')

      const beforeInstall = trustRequests.length
      const hookStatus = await installAgentHook(provider, env)
      expect(hookStatus.state).toBe('installed')
      if (provider === 'codex') {
        expect(hookStatus.detail).toContain('文件已安装')
        expect(hookStatus.paths).not.toContain(trustConfig)
        expect(trustRequests).toHaveLength(beforeInstall)
        expect(await readFile(trustConfig, 'utf8')).toBe(userToml)
        expect(trustRecords.size).toBe(1)
        expect(
          (await inspectAgentHook(provider, env, undefined, join(root, 'bin', 'codex'))).trust,
        ).toBe('untrusted')
        expect(await readFile(trustConfig, 'utf8')).toBe(userToml)
        expect(trustRequests.every((request) => !request.method.startsWith('config/'))).toBe(true)
      }
      const installed = await readFile(paths.config, 'utf8')
      const data = JSON.parse(installed)
      expect(data.description).toBe('user settings')
      expect(data.hooks.Stop[0]).toEqual({
        matcher: '*',
        hooks: [{ type: 'command', command: 'user-hook' }],
      })
      expect(data.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks)).toHaveLength(2)
      expect(data).not.toHaveProperty('notify')
      const backups = (await readdir(join(paths.config, '..'))).filter((name) =>
        name.startsWith(`${provider === 'codex' ? 'hooks.json' : 'settings.json'}.cota-backup-`),
      )
      expect(backups).toHaveLength(1)
      expect(await readFile(join(paths.config, '..', backups[0]), 'utf8')).toBe(original)
      const beforeReinstall = trustRequests.length
      await installAgentHook(provider, env)
      expect(trustRequests).toHaveLength(beforeReinstall)
      expect(await readFile(paths.config, 'utf8')).toBe(installed)
      expect(
        (await readdir(join(paths.config, '..'))).filter((name) =>
          name.startsWith(`${provider === 'codex' ? 'hooks.json' : 'settings.json'}.cota-backup-`),
        ),
      ).toHaveLength(1)
    },
  )

  it('trusts installed Codex Hooks idempotently without changing unrelated trust or Hook files', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    const { trustRecords, trustRequests, rpcChildren, failure } = codexRpc(env)
    const { paths, trustConfig, userToml } = await userHookConfig('codex', env)
    await installAgentHook('codex', env)
    const beforeTrust = await readFile(paths.config, 'utf8')
    const beforeLoader = await readFile(paths.loader, 'utf8')
    expect(await trustAgentHook('codex', env)).toMatchObject({
      trust: 'trusted',
      detail: expect.stringContaining('已信任 Cota Hooks'),
    })
    expect(await readFile(paths.config, 'utf8')).toBe(beforeTrust)
    expect(await readFile(paths.loader, 'utf8')).toBe(beforeLoader)
    expect(await readFile(trustConfig, 'utf8')).toBe(`${userToml}# native trust write\n`)
    expect(trustRecords.get('user-trust')).toEqual({ trusted_hash: 'keep', enabled: false })
    expect(trustRecords.size).toBe(7)
    const beforeDetect = trustRequests.length
    expect(
      (await inspectAgentHook('codex', env, undefined, join(root, 'bin', 'codex'))).trust,
    ).toBe('trusted')
    expect(
      trustRequests.slice(beforeDetect).every((request) => !request.method.startsWith('config/')),
    ).toBe(true)
    failure.value = 'unsupported'
    expect(
      await inspectAgentHook('codex', env, undefined, join(root, 'bin', 'codex')),
    ).toMatchObject({ state: 'installed', trust: 'unknown' })
    failure.value = undefined
    expect(rpcChildren.every((rpc) => rpc.kill.mock.calls.length === 1)).toBe(true)

    const writes = trustRequests.filter((request) => request.method === 'config/batchWrite').length
    const beforeReinstall = trustRequests.length
    await installAgentHook('codex', env)
    expect(trustRequests).toHaveLength(beforeReinstall)
    await trustAgentHook('codex', env)
    expect(await readFile(paths.config, 'utf8')).toBe(beforeTrust)
    expect(trustRequests.filter((request) => request.method === 'config/batchWrite')).toHaveLength(
      writes,
    )
    expect(
      (await readdir(join(paths.config, '..'))).filter((name) =>
        name.startsWith('hooks.json.cota-backup-'),
      ),
    ).toHaveLength(1)
  })

  it.each(['codex', 'claude'] as const)(
    'removes only Cota %s Hooks and rejects malformed or symlinked configuration',
    async (provider) => {
      const env = { HOME: root, PATH: join(root, 'bin') }
      const { paths } = await userHookConfig(provider, env)
      await installAgentHook(provider, env)
      const beforeUninstall = JSON.parse(await readFile(paths.config, 'utf8'))
      beforeUninstall.hooks.CustomEvent = [
        { matcher: 'mixed', hooks: [{ command: paths.command }, { command: 'keep-custom' }] },
        { matcher: 'empty-user-group', hooks: [] },
      ]
      beforeUninstall.hooks.Stop[0].hooks.push({ command: paths.command })
      const beforeRaw = JSON.stringify(beforeUninstall)
      await writeFile(paths.config, beforeRaw)
      const sharedLoader = await readFile(paths.loader, 'utf8')
      const filesBeforeUninstall = (await readdir(join(paths.config, '..'))).sort()
      expect((await uninstallAgentHook(provider, env)).state).toBe('missing')
      const uninstalled = await readFile(paths.config, 'utf8')
      expect(JSON.parse(uninstalled)).toEqual({
        description: 'user settings',
        hooks: {
          Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'user-hook' }] }],
          CustomEvent: [
            { matcher: 'mixed', hooks: [{ command: 'keep-custom' }] },
            { matcher: 'empty-user-group', hooks: [] },
          ],
        },
      })
      expect(await readFile(paths.loader, 'utf8')).toBe(sharedLoader)
      expect((await readdir(join(paths.config, '..'))).sort()).toEqual(filesBeforeUninstall)
      await uninstallAgentHook(provider, env)
      expect(await readFile(paths.config, 'utf8')).toBe(uninstalled)
      expect((await installAgentHook(provider, env)).state).toBe('installed')
      await writeFile(
        paths.config,
        JSON.stringify({
          keep: true,
          hooks: {
            FutureEvent: [{ hooks: [{ command: paths.command }] }],
          },
        }),
      )
      expect((await uninstallAgentHook(provider, env)).state).toBe('missing')
      expect(JSON.parse(await readFile(paths.config, 'utf8'))).toEqual({ keep: true })
      await writeFile(paths.config, '{broken')
      expect((await inspectAgentHook(provider, env)).state).toBe('error')
      await expect(installAgentHook(provider, env)).rejects.toThrow()
      await expect(uninstallAgentHook(provider, env)).rejects.toThrow()
      expect(await readFile(paths.config, 'utf8')).toBe('{broken')
      await rm(paths.config)
      const target = join(root, `${provider}-user-config`)
      await writeFile(target, '{}')
      await symlink(target, paths.config)
      expect((await inspectAgentHook(provider, env)).state).toBe('error')
      await expect(installAgentHook(provider, env)).rejects.toThrow('非普通文件')
      await expect(uninstallAgentHook(provider, env)).rejects.toThrow('非普通文件')
      expect(await readFile(target, 'utf8')).toBe('{}')
    },
  )
})
