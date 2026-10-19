import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  absolutePath,
  dimensions,
  executable,
  preferences,
  projectDirectory,
  terminalId,
} from '../src/main/validation'
import { resolveShell, shellEnvironment } from '../src/main/shell'
import { DEFAULT_CONFIG } from '../src/shared/contracts'

afterEach(() => vi.unstubAllEnvs())

describe('trust boundary validation', () => {
  it.each(['zsh', '/bin/zsh\0-x', '', 123, null])('rejects invalid paths: %s', (path) => {
    expect(() => absolutePath(path)).toThrow()
  })
  it('accepts Unicode/space directories and canonicalizes aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cota 中文-'))
    try {
      const alias = `${root}-alias`
      await symlink(root, alias)
      try {
        expect(await projectDirectory(root)).toBe(await projectDirectory(alias))
      } finally {
        await rm(alias)
      }
      const file = join(root, 'not-directory')
      await writeFile(file, '')
      await expect(projectDirectory(file)).rejects.toThrow('不可访问')
      await expect(executable(file)).rejects.toThrow('不可执行')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects missing directories and executable strings with parameters', async () => {
    await expect(projectDirectory('/nonexistent-cota-path')).rejects.toThrow('不可访问')
    await expect(executable('/bin/zsh -c whoami')).rejects.toThrow('不可执行')
  })
  it('validates preferences, terminal IDs and sizes', () => {
    expect(preferences({ ...DEFAULT_CONFIG.preferences, scrollback: 20000 })).toEqual({
      ...DEFAULT_CONFIG.preferences,
      shellPath: null,
      scrollback: 20000,
    })
    for (const value of [999, 20001, 1000.1, '5000', NaN])
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, scrollback: value })).toThrow()
    expect(() => preferences({ scrollback: 5000, openWith: [] })).toThrow()
    expect(() => terminalId('../../file')).toThrow()
    expect(() => dimensions(0, 24)).toThrow()
    expect(() => dimensions('80', 24)).toThrow()
    expect(dimensions(80, 24)).toEqual({ cols: 80, rows: 24 })
  })
  it('uses an executable SHELL, falls back to zsh, and never falls back from an invalid custom shell', async () => {
    const settings = DEFAULT_CONFIG.preferences
    vi.stubEnv('SHELL', '/bin/bash')
    expect(await resolveShell(settings)).toBe('/bin/bash')
    vi.stubEnv('SHELL', '')
    expect(await resolveShell(settings)).toBe('/bin/zsh')
    vi.stubEnv('SHELL', 'not-an-absolute-path')
    expect(await resolveShell(settings)).toBe('/bin/zsh')
    await expect(resolveShell({ ...settings, shellPath: '/missing-shell' })).rejects.toThrow(
      '不可执行',
    )
  })
  it('does not leak Electron runtime flags into interactive CLI children', () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    const env = shellEnvironment()
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.TERM).toBe('xterm-256color')
  })
})
