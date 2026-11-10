import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { chmod, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { agentCliCacheSchema } from '../../../src/shared/agent-cli'
import { AgentCliManagement } from '../../../src/main/agents/cli/management'
import { ConfigStore } from '../../../src/main/settings/config-store'

describe('Agent CLI cached management', () => {
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
    const config = new ConfigStore(configFile)
    await config.load()
    const publish = vi.fn()
    const agents = new AgentCliManagement(config, publish)
    await agents.initialize()
    expect(agents.read().entries).toHaveLength(3)
    expect(
      agents
        .read()
        .entries.every((entry) => entry.version === '0.159.0' && entry.installMethod === 'unknown'),
    ).toBe(true)
    const legacyCache = agentCliCacheSchema.parse({
      ...agents.read(),
      entries: agents
        .read()
        .entries.map((entry) =>
          entry.provider === 'claude' ? { ...entry, installMethod: 'native' } : entry,
        ),
    })
    expect(legacyCache.entries.find((entry) => entry.provider === 'claude')?.installMethod).toBe(
      'unknown',
    )
    // Keep absence deterministic even on a developer machine with other installed copies.
    await config.saveAgentClis({ ...legacyCache, pathEnv: join(root, 'bin') })
    const probes = mocks.login.mock.calls.length
    const restored = new ConfigStore(configFile)
    await restored.load()
    const restarted = new AgentCliManagement(restored, publish)
    await restarted.initialize()
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
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
    })
    const disk = new ConfigStore(configFile)
    await disk.load()
    expect(disk.snapshot().agentCliCache).toEqual(restarted.read())
    expect(publish).toHaveBeenLastCalledWith(restarted.read())
    expect(mocks.login).toHaveBeenCalledTimes(probes)
  })
})
