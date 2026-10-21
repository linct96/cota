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
import {
  shellFormSchema,
  scrollbackFormSchema,
  openerFormSchema,
  workspaceFormSchema,
  worktreeFormSchema,
} from '../src/renderer/src/lib/form-schemas'

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
    for (const mode of ['auto', 'on', 'off']) {
      expect(
        preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: mode }),
      ).toMatchObject({ terminalGpuAcceleration: mode })
    }
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: undefined }),
    ).toMatchObject({ terminalGpuAcceleration: 'auto' })
    for (const mode of [null, true, false, 0, '', 'enabled', [], {}]) {
      expect(() =>
        preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: mode }),
      ).toThrow('GPU 加速选项无效')
    }
    const custom = { ...DEFAULT_CONFIG.preferences, shellPath: '/bin/bash' }
    expect(preferences({ ...custom, shellName: ' 我的 Bash ' })).toMatchObject({
      shellName: '我的 Bash',
      shellPath: '/bin/bash',
    })
    for (const shellName of [undefined, null, '', '   ']) {
      expect(preferences({ ...custom, shellName })).toMatchObject({
        shellName: null,
        shellPath: '/bin/bash',
      })
    }
    expect(preferences({ ...DEFAULT_CONFIG.preferences, shellName: '旧名称' }).shellName).toBeNull()
    for (const shellName of [123, {}, 'x'.repeat(81), 'bad\0name', 'bad\nname', 'bad\rname'])
      expect(() => preferences({ ...custom, shellName })).toThrow('Shell 名称')
    for (const value of [999, 20001, 1000.1, '5000', NaN])
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, scrollback: value })).toThrow()
    expect(() => preferences({ scrollback: 5000, openWith: [] })).toThrow()
    expect(() => terminalId('../../file')).toThrow()
    expect(() => dimensions(0, 24)).toThrow()
    expect(() => dimensions('80', 24)).toThrow()
    expect(dimensions(80, 24)).toEqual({ cols: 80, rows: 24 })

    expect(shellFormSchema.safeParse({ name: '', path: '/bin/bash' }).success).toBe(true)
    for (const path of [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      '\\\\server\\share\\pwsh.exe',
    ])
      expect(shellFormSchema.safeParse({ name: '', path }).success).toBe(true)
    for (const path of ['', 'zsh', 'C:pwsh.exe', '/bin/bash\0'])
      expect(shellFormSchema.safeParse({ name: '', path }).success).toBe(false)
    expect(shellFormSchema.safeParse({ name: 'bad\nname', path: '/bin/bash' }).success).toBe(false)
    for (const scrollback of ['1000', '20000'])
      expect(scrollbackFormSchema.safeParse({ scrollback }).success).toBe(true)
    for (const scrollback of ['', '999', '20001', '1000.1', 'NaN'])
      expect(scrollbackFormSchema.safeParse({ scrollback }).success).toBe(false)
    const opener = { name: '编辑器', command: '/Apps/Code Editor', arguments: '"{path}"' }
    expect(openerFormSchema.safeParse(opener).success).toBe(true)
    expect(
      openerFormSchema.safeParse({ ...opener, command: 'C:\\Program Files\\Editor\\code.exe' })
        .success,
    ).toBe(true)
    expect(openerFormSchema.safeParse({ ...opener, command: 'code --wait' }).success).toBe(false)
    expect(openerFormSchema.safeParse({ ...opener, name: ' ' }).success).toBe(false)
    for (const args of ['"unclosed', 'trailing\\', 'bad\0arg'])
      expect(openerFormSchema.safeParse({ ...opener, arguments: args }).success).toBe(false)
    expect(workspaceFormSchema.safeParse({ name: ' 工作区 ' }).success).toBe(true)
    for (const name of [' ', 'x'.repeat(1025)])
      expect(workspaceFormSchema.safeParse({ name }).success).toBe(false)
    expect(worktreeFormSchema.safeParse({ name: '木星', baseRef: 'main' }).success).toBe(true)
    for (const name of ['---', 'feature/name', 'bad\nname'])
      expect(worktreeFormSchema.safeParse({ name, baseRef: 'main' }).success).toBe(false)
    expect(worktreeFormSchema.safeParse({ name: 'jupiter', baseRef: ' ' }).success).toBe(false)
  })
  it('uses an executable SHELL, falls back to zsh, and never falls back from an invalid custom shell', async () => {
    const settings = DEFAULT_CONFIG.preferences
    vi.stubEnv('SHELL', '/bin/bash')
    expect(await resolveShell(settings)).toBe('/bin/bash')
    const custom = { ...settings, shellName: '只做回显;不是命令', shellPath: '/bin/zsh' }
    expect(await resolveShell(custom)).toBe('/bin/zsh')
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
