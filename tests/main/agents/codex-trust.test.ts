import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { installAgentHook, trustAgentHook } from '../../../src/main/agents/hooks/managed'

import { codexRpc, userHookConfig } from './hooks.fixture'

describe('Codex native Hook trust', () => {
  it('updates exact native hashes and preserves configuration on policy, protocol, race and file failures', async () => {
    const provider = 'codex' as const
    const env = { HOME: root, PATH: join(root, 'bin') }
    const { trustRecords, trustRequests, rpcChildren, failure: rpcFailure } = codexRpc(env)
    const { paths, trustConfig, userToml } = await userHookConfig(provider, env)

    await installAgentHook(provider, env)
    await trustAgentHook(provider, env)
    for (const minor of [145, 159]) {
      const beforeUpdate = trustRequests.length
      await installAgentHook(provider, env, `0.${minor}.0`)
      expect(trustRequests).toHaveLength(beforeUpdate)
      await trustAgentHook(provider, env, `0.${minor}.0`)
      const config = JSON.parse(await readFile(paths.config, 'utf8'))
      expect(config.hooks.SubagentStart).toBeDefined()
      expect(config.hooks.SubagentStop).toBeDefined()
      expect(!!config.hooks.Interrupt).toBe(minor >= 159)
      expect(config).not.toHaveProperty('features')
    }
    const trustBackups = (await readdir(join(trustConfig, '..'))).filter((name) =>
      name.startsWith('config.toml.cota-backup-'),
    )
    expect(
      await Promise.all(
        trustBackups.map((name) => readFile(join(trustConfig, '..', name), 'utf8')),
      ),
    ).toContain(userToml)
    trustRecords.clear()
    trustRecords.set('user-trust', { trusted_hash: 'keep', enabled: false })
    for (const failure of [
      'unsupported',
      'policy',
      'foreign',
      'race',
      'invalid',
      'timeout',
    ] as const) {
      rpcFailure.value = failure
      const before = await readFile(trustConfig, 'utf8')
      const calls = trustRequests.length
      if (failure === 'timeout') vi.useFakeTimers()
      const pending = expect(trustAgentHook(provider, env, '0.159.0')).rejects.toThrow(
        '未确认 Codex Hooks 信任成功',
      )
      if (failure === 'timeout') {
        await vi.waitFor(() =>
          expect(
            trustRequests.slice(calls).some((request) => request.method === 'hooks/list'),
          ).toBe(true),
        )
        await vi.advanceTimersByTimeAsync(15_000)
      }
      await pending
      if (failure === 'timeout') vi.useRealTimers()
      expect(await readFile(trustConfig, 'utf8')).toBe(
        failure === 'race' ? '# concurrent edit\n' : before,
      )
      expect(trustRecords.size).toBe(1)
      expect(rpcChildren.at(-1)!.kill).toHaveBeenCalledOnce()
    }
    rpcFailure.value = undefined
    await writeFile(`${trustConfig}.cota-lock`, '')
    await expect(trustAgentHook(provider, env, '0.159.0')).rejects.toThrow(
      '未确认 Codex Hooks 信任成功',
    )
    await rm(`${trustConfig}.cota-lock`)
    const targetToml = join(root, 'user-config.toml')
    await writeFile(targetToml, userToml)
    await rm(trustConfig)
    await symlink(targetToml, trustConfig)
    const beforeSpawn = mocks.spawn.mock.calls.length
    expect((await installAgentHook(provider, env, '0.159.0')).state).toBe('installed')
    await expect(trustAgentHook(provider, env, '0.159.0')).rejects.toThrow('非普通文件')
    expect(mocks.spawn).toHaveBeenCalledTimes(beforeSpawn)
    expect(await readFile(targetToml, 'utf8')).toBe(userToml)
    await rm(trustConfig)
    expect((await trustAgentHook(provider, env, '0.159.0')).detail).toContain('已信任 Cota Hooks')
    expect(await readFile(trustConfig, 'utf8')).toBe('# native trust write\n')
  })
})
