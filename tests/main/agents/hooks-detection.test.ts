import { root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  hookFiles,
  inspectAgentHook,
  installAgentHook,
  uninstallAgentHook,
} from '../../../src/main/agents/hooks/managed'
import {
  codexShellFunction,
  prepareAgentShell,
} from '../../../src/main/agents/hooks/shell-integration'

describe('Agent Hook detection', () => {
  it('does not create configuration merely by detecting Hooks or preparing an uninstalled Shell', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    expect(codexShellFunction).toContain('--no-daemon')
    expect(codexShellFunction).toContain('command "$__cota_program" "$@"')
    expect(codexShellFunction).not.toContain('eval')
    for (const shell of ['zsh', 'bash', 'fish']) {
      expect(await prepareAgentShell(`/bin/${shell}`, env, join(root, 'runtime'))).toBeUndefined()
    }
    for (const provider of ['pi', 'codex', 'claude'] as const) {
      expect((await inspectAgentHook(provider, env)).state).toBe('missing')
    }
    expect(await readdir(root)).toEqual(['bin'])
  })

  it('preserves user-owned Pi extensions and honors installation locks', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    const piPath = hookFiles('pi', env).config
    await mkdir(join(root, '.pi', 'agent', 'extensions'), { recursive: true })
    await writeFile(piPath, '// user-owned extension')
    expect((await inspectAgentHook('pi', env)).state).toBe('conflict')
    await expect(installAgentHook('pi', env)).rejects.toThrow('不属于 Cota')
    await expect(uninstallAgentHook('pi', env)).rejects.toThrow('不属于 Cota')
    expect(await readFile(piPath, 'utf8')).toBe('// user-owned extension')
    await rm(piPath)
    expect((await installAgentHook('pi', env)).state).toBe('installed')
    const piExtension = await readFile(piPath, 'utf8')
    expect(piExtension).toContain('COTA_AGENT_ADAPTER_DIR')
    await writeFile(`${piPath}.cota-lock`, '')
    await expect(uninstallAgentHook('pi', env)).rejects.toThrow()
    expect(await readFile(piPath, 'utf8')).toBe(piExtension)
    await rm(`${piPath}.cota-lock`)
    expect((await uninstallAgentHook('pi', env)).state).toBe('missing')
    await expect(readFile(piPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(piPath, '..'))).toEqual([])
    expect((await uninstallAgentHook('pi', env)).state).toBe('missing')
    expect((await installAgentHook('pi', env)).state).toBe('installed')
  })
})
