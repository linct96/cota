import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
import { resolveShell, shellEnvironment } from '../src/main/system/shell'
import * as validation from '../src/main/validation'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import {
  scrollbackFormSchema,
  shellFormSchema,
} from '../src/renderer/src/features/settings/schemas'
import { openerFormSchema } from '../src/renderer/src/features/workspace/open-with/schemas'
import { workspaceFormSchema } from '../src/renderer/src/features/workspace/dialogs/schemas'
import { worktreeFormSchema } from '../src/renderer/src/features/workspace/worktree/schemas'

afterEach(() => vi.unstubAllEnvs())

describe('trust boundary validation', () => {
  it.each(['zsh', '/bin/zsh\0-x', '', 123, null])('rejects invalid paths: %s', (path) => {
    expect(() => absolutePath(path)).toThrow()
  })
  it('accepts Unicode/space directories and canonicalizes aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cota 中文-'))
    try {
      const alias = `${root}-alias`
      await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
      try {
        expect(await projectDirectory(root)).toBe(await projectDirectory(alias))
      } finally {
        await rm(alias)
      }
      const file = join(root, 'not-directory')
      await writeFile(file, '')
      await expect(projectDirectory(file)).rejects.toThrow('不可访问')
      if (process.platform === 'win32') {
        // Windows ignores X_OK; a regular file passes this accessibility check.
        await expect(executable(file)).resolves.toBe(file)
      } else {
        await expect(executable(file)).rejects.toThrow('不可执行')
      }
      await expect(executable(root)).rejects.toThrow('不可执行')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects missing directories and executable strings with parameters', async () => {
    await expect(projectDirectory('/nonexistent-cota-path')).rejects.toThrow('不可访问')
    await expect(executable('/bin/zsh -c whoami')).rejects.toThrow('不可执行')
  })
  it('normalizes default preferences and omitted quick commands', () => {
    expect(preferences({ ...DEFAULT_CONFIG.preferences, scrollback: 20000 })).toEqual({
      ...DEFAULT_CONFIG.preferences,
      shellPath: null,
      scrollback: 20000,
    })
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, quickCommands: undefined }).quickCommands,
    ).toEqual([])
  })

  it.each(['auto', 'on', 'off'])('accepts GPU acceleration mode %s', (mode) => {
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: mode }),
    ).toMatchObject({ terminalGpuAcceleration: mode })
  })

  it('defaults an omitted GPU acceleration mode to auto', () => {
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: undefined }),
    ).toMatchObject({ terminalGpuAcceleration: 'auto' })
  })

  it.each(
    [null, true, false, 0, '', 'enabled', [], {}].map((value) => ({
      value,
      label: JSON.stringify(value),
    })),
  )('rejects invalid GPU acceleration mode $label', ({ value }) => {
    expect(() =>
      preferences({ ...DEFAULT_CONFIG.preferences, terminalGpuAcceleration: value }),
    ).toThrow('GPU 加速选项无效')
  })

  it.each([
    [true, true],
    [undefined, true],
    [false, false],
  ])('normalizes preventSleep %s to %s', (value, expected) => {
    expect(preferences({ ...DEFAULT_CONFIG.preferences, preventSleep: value }).preventSleep).toBe(
      expected,
    )
  })

  it.each([null, 'true', 1, [], {}].map((value) => ({ value, label: JSON.stringify(value) })))(
    'rejects invalid preventSleep value $label',
    ({ value }) => {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, preventSleep: value })).toThrow(
        '防休眠选项无效',
      )
    },
  )

  it('trims a custom Shell name and clears a stale name without a custom path', () => {
    const custom = { ...DEFAULT_CONFIG.preferences, shellPath: '/bin/bash' }
    expect(preferences({ ...custom, shellName: ' 我的 Bash ' })).toMatchObject({
      shellName: '我的 Bash',
      shellPath: '/bin/bash',
    })
    expect(preferences({ ...DEFAULT_CONFIG.preferences, shellName: '旧名称' }).shellName).toBeNull()
  })

  it.each([undefined, null, '', '   '])('normalizes blank Shell name %s', (shellName) => {
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, shellPath: '/bin/bash', shellName }),
    ).toMatchObject({ shellName: null, shellPath: '/bin/bash' })
  })

  it.each([
    ['number', 123],
    ['object', {}],
    ['overlong name', 'x'.repeat(81)],
    ['NUL character', 'bad\0name'],
    ['line feed', 'bad\nname'],
    ['carriage return', 'bad\rname'],
  ])('rejects Shell name with %s', (_case, shellName) => {
    expect(() =>
      preferences({ ...DEFAULT_CONFIG.preferences, shellPath: '/bin/bash', shellName }),
    ).toThrow('Shell 名称')
  })

  it.each([999, 20001, 1000.1, '5000', NaN])('rejects scrollback %s', (scrollback) => {
    expect(() => preferences({ ...DEFAULT_CONFIG.preferences, scrollback })).toThrow()
  })

  it('rejects incomplete preferences', () => {
    expect(() => preferences({ scrollback: 5000, openWith: [] })).toThrow()
  })

  it('rejects invalid terminal IDs', () => {
    expect(() => terminalId('../../file')).toThrow()
  })

  it.each([0, '80'])('rejects invalid terminal column count %s', (cols) => {
    expect(() => dimensions(cols, 24)).toThrow()
  })

  it('accepts valid terminal dimensions', () => {
    expect(dimensions(80, 24)).toEqual({ cols: 80, rows: 24 })
  })

  it.each([
    '/bin/bash',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    '\\\\server\\share\\pwsh.exe',
  ])('accepts Shell form path %s', (path) => {
    expect(shellFormSchema.safeParse({ name: '', path }).success).toBe(true)
  })

  it.each(['', 'zsh', 'C:pwsh.exe', '/bin/bash\0'])('rejects Shell form path %s', (path) => {
    expect(shellFormSchema.safeParse({ name: '', path }).success).toBe(false)
  })

  it('rejects a Shell form name containing a line feed', () => {
    expect(shellFormSchema.safeParse({ name: 'bad\nname', path: '/bin/bash' }).success).toBe(false)
  })

  it.each(['1000', '20000'])('accepts scrollback form value %s', (scrollback) => {
    expect(scrollbackFormSchema.safeParse({ scrollback }).success).toBe(true)
  })

  it.each(['', '999', '20001', '1000.1', 'NaN'])(
    'rejects scrollback form value %s',
    (scrollback) => {
      expect(scrollbackFormSchema.safeParse({ scrollback }).success).toBe(false)
    },
  )

  const opener = { name: '编辑器', command: '/Apps/Code Editor', arguments: '"{path}"' }

  it.each(['/Apps/Code Editor', 'C:\\Program Files\\Editor\\code.exe'])(
    'accepts opener executable %s',
    (command) => {
      expect(openerFormSchema.safeParse({ ...opener, command }).success).toBe(true)
    },
  )

  it.each([
    ['arguments in command', { command: 'code --wait' }],
    ['blank name', { name: ' ' }],
    ['unclosed quote', { arguments: '"unclosed' }],
    ['trailing escape', { arguments: 'trailing\\' }],
    ['NUL argument', { arguments: 'bad\0arg' }],
  ])('rejects opener with %s', (_case, change) => {
    expect(openerFormSchema.safeParse({ ...opener, ...change }).success).toBe(false)
  })

  it('accepts a workspace form name with surrounding spaces', () => {
    expect(workspaceFormSchema.safeParse({ name: ' 工作区 ' }).success).toBe(true)
  })

  it.each([
    ['blank', ' '],
    ['overlong', 'x'.repeat(1025)],
  ])('rejects a %s workspace form name', (_case, name) => {
    expect(workspaceFormSchema.safeParse({ name }).success).toBe(false)
  })

  it('accepts a valid worktree form', () => {
    expect(worktreeFormSchema.safeParse({ name: '木星', baseRef: 'main' }).success).toBe(true)
  })

  it.each(['---', 'feature/name', 'bad\nname'])('rejects worktree form name %s', (name) => {
    expect(worktreeFormSchema.safeParse({ name, baseRef: 'main' }).success).toBe(false)
  })

  it('rejects a blank worktree base reference', () => {
    expect(worktreeFormSchema.safeParse({ name: 'jupiter', baseRef: ' ' }).success).toBe(false)
  })
  it('resolves platform defaults and never falls back from an invalid custom shell', async () => {
    const settings = DEFAULT_CONFIG.preferences
    const windows = process.platform === 'win32'
    const programFiles = join(tmpdir(), 'cota shell defaults')
    vi.stubEnv('ProgramFiles', programFiles)
    const defaultShell = windows ? join(programFiles, 'PowerShell', '7', 'pwsh.exe') : '/bin/zsh'
    vi.spyOn(validation, 'executable').mockImplementation((value) => {
      try {
        if (value === process.execPath || value === defaultShell) return Promise.resolve(value)
        throw new Error('Shell 不存在或不可执行。')
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    vi.stubEnv('SHELL', process.execPath)
    expect(await resolveShell(settings)).toBe(windows ? defaultShell : process.execPath)
    const custom = { ...settings, shellName: '只做回显;不是命令', shellPath: process.execPath }
    expect(await resolveShell(custom)).toBe(process.execPath)
    vi.stubEnv('SHELL', '')
    expect(await resolveShell(settings)).toBe(defaultShell)
    vi.stubEnv('SHELL', 'not-an-absolute-path')
    expect(await resolveShell(settings)).toBe(defaultShell)
    await expect(
      resolveShell({ ...settings, shellPath: join(tmpdir(), 'missing-shell') }),
    ).rejects.toThrow('不可执行')
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
