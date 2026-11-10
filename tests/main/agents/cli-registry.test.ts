import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_PROVIDERS, DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { agentCliCacheSchema } from '../../../src/shared/agent-cli'
import { agentCapability, detectAgents, resolveAgent } from '../../../src/main/agents/cli/registry'

describe('Agent CLI discovery and capabilities', () => {
  it('detects available CLIs while tolerating unknown or failed version probes', async () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    vi.stubEnv('COTA_HOST_TOKEN', 'private-host-credential')
    vi.stubEnv('NODE_CHANNEL_FD', '3')
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
    mocks.login.mockImplementation((file: string, args: string[]) => {
      try {
        if (args[0] !== '--version')
          return Promise.resolve({ stdout: `startup noise\0${join(root, 'bin')}\0` })
        if (file.endsWith('/codex')) throw new Error('version probe timed out')
        return Promise.resolve({ stdout: file.endsWith('/pi') ? 'pi 1.2.3\n' : 'unknown banner' })
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    const detected = await detectAgents(DEFAULT_CONFIG.preferences)
    expect(detected).toEqual([
      { provider: 'pi', executable: join(root, 'bin', 'pi'), version: '1.2.3' },
      { provider: 'codex', executable: join(root, 'bin', 'codex'), version: undefined },
      { provider: 'claude', executable: join(root, 'bin', 'claude'), version: undefined },
    ])
    expect(mocks.login).toHaveBeenCalledWith(
      expect.any(String),
      ['-ilc', expect.any(String)],
      expect.objectContaining({ timeout: 5000, maxBuffer: 65536 }),
    )
    expect(mocks.login).toHaveBeenCalledWith(
      join(root, 'bin', 'codex'),
      ['--version'],
      expect.objectContaining({ timeout: 3000, maxBuffer: 65536 }),
    )
    const direct = await resolveAgent('codex', DEFAULT_CONFIG.preferences)
    expect(direct).toMatchObject({ executable: join(root, 'bin', 'codex'), args: [] })
    expect(direct.env.COTA_HOST_TOKEN).toBeUndefined()
    expect(mocks.spawn).not.toHaveBeenCalled()
    await expect(agentCapability('codex', direct)).rejects.toThrow('版本未知')
    expect(direct.args).toEqual([])
    expect(direct.env.COTA_AGENT_TOKEN).toBeUndefined()
  })

  it('checks provider capabilities and native Codex launch flags without mutating commands', async () => {
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
    mocks.login.mockImplementation((file: string) => {
      try {
        return Promise.resolve({
          stdout: file.endsWith('/pi')
            ? 'pi 1.3.0'
            : file.endsWith('/claude')
              ? '2.1.196'
              : 'codex 0.124.0',
        })
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    for (const provider of ['pi', 'claude', 'codex'] as const) {
      const command = {
        executable: join(root, 'bin', provider),
        args: [] as string[],
        env: {} as Record<string, string>,
      }
      expect(await agentCapability(provider, command)).toBe(provider === 'pi' ? 'full' : 'partial')
      expect(command.args).toEqual([])
      expect(command.env).toEqual({})
    }
    for (const minor of [145, 156, 159]) {
      mocks.login.mockImplementation((_file: string, args: string[]) => {
        try {
          return Promise.resolve({
            stdout: args[0] === '--version' ? `codex 0.${minor}.0` : `\0${join(root, 'bin')}\0`,
          })
        } catch (cause) {
          return Promise.reject(cause)
        }
      })
      const command = await resolveAgent('codex', DEFAULT_CONFIG.preferences)
      expect(command.args).toEqual(minor >= 156 ? ['--no-daemon'] : [])
      expect(command.env.COTA_AGENT_TOKEN).toBeUndefined()
    }
    const missingAdapter = { executable: join(root, 'bin', 'pi'), args: [] as string[], env: {} }
    mocks.adapter.mockRejectedValueOnce(new Error('missing packaged adapter'))
    mocks.login.mockResolvedValueOnce({ stdout: 'pi 1.3.0' })
    await expect(agentCapability('pi', missingAdapter)).rejects.toThrow('missing packaged adapter')
    expect(missingAdapter.args).toEqual([])
    expect(missingAdapter.env).toEqual({})
  })

  it('distinguishes missing executables from permission failures and cleans legacy cache errors', async () => {
    const detectionEnv = { PATH: join(root, 'bin') }
    expect(await detectAgents(DEFAULT_CONFIG.preferences, undefined, detectionEnv)).toEqual([
      { provider: 'pi' },
      { provider: 'codex' },
      { provider: 'claude' },
    ])
    await writeFile(join(root, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o600 })
    expect(
      (await detectAgents(DEFAULT_CONFIG.preferences, 'claude', detectionEnv))[0].error,
    ).toContain('文件权限')
    await chmod(join(root, 'bin', 'claude'), 0o700)
    expect(
      agentCliCacheSchema.parse({
        checkedAt: 1,
        pathEnv: detectionEnv.PATH,
        entries: [
          {
            provider: 'claude',
            error: '找不到 claude。请安装其命令行工具，并检查登录 Shell 的 PATH。',
          },
          {
            provider: 'codex',
            error: `${AGENT_PROVIDERS.codex.name} CLI 已不存在，启动失败。请在设置中重新安装或检测。`,
          },
          { provider: 'pi', error: '无法执行 pi，请检查文件权限和磁盘状态。' },
        ],
      }).entries,
    ).toEqual([
      { provider: 'claude' },
      { provider: 'codex' },
      { provider: 'pi', error: '无法执行 pi，请检查文件权限和磁盘状态。' },
    ])
  })
})
