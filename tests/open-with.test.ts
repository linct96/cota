import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import { parseArguments } from '../src/shared/open-with'
import { workspaceOpeners } from '../src/main/validation'

const mocks = vi.hoisted(() => ({ login: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.login }),
    spawn: mocks.spawn,
  }
})
import { openWorkspaceWith } from '../src/main/open-with'

const opener = { id: 'editor', name: 'Editor', command: 'editor', arguments: '{path}' }
let root: string
let command: string
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'cota 中文 ; open-with-')))
  await mkdir(join(root, 'bin'))
  command = join(root, 'bin', 'editor')
  await writeFile(command, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  mocks.login.mockResolvedValue({ stdout: `shell startup output\0${join(root, 'bin')}\0` })
  child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => {
      child.emit('spawn')
      child.emit('exit', 0)
    })
    return child
  })
})
afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('open-with arguments and validation', () => {
  it.each([
    ['', []],
    ['--new-window {path}', ['--new-window', '{path}']],
    ['"" \'\' a" b"c', ['', '', 'a bc']],
    ['"folder with spaces" a\\ b', ['folder with spaces', 'a b']],
    ['"a\\\"b" \'c\\d\'', ['a"b', 'c\\d']],
    ['$(touch nope) ; $HOME | *', ['$(touch', 'nope)', ';', '$HOME', '|', '*']],
  ])('parses %s without evaluating shell syntax', (value, expected) => {
    expect(parseArguments(value)).toEqual(expected)
  })
  it.each(['"unclosed', "'unclosed", 'trailing\\'])('rejects incomplete quoting: %s', (value) => {
    expect(() => parseArguments(value)).toThrow()
  })
  it.each([
    null,
    {},
    Array(51).fill(opener),
    [{ ...opener, id: '../id' }],
    [{ ...opener, name: ' ' }],
    [{ ...opener, command: 'code --new-window' }],
    [{ ...opener, command: 'code; touch nope' }],
    [{ ...opener, command: '/bin/sh\0' }],
    [{ ...opener, arguments: '"unclosed' }],
    [opener, opener],
  ])('rejects invalid program definitions: %j', (value) => {
    expect(() => workspaceOpeners(value)).toThrow()
  })
})

describe('workspace program launch', () => {
  it('opens the default directory explicitly in Finder without shell evaluation', async () => {
    await openWorkspaceWith(root, DEFAULT_CONFIG.preferences.openWith[0])
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-a', 'Finder', root]])
  })
  it('finds login-shell commands and passes a metacharacter/Unicode path as one literal argument', async () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    await openWorkspaceWith(root, { ...opener, arguments: '--new-window "{path}" --folder={path}' })
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      command,
      ['--new-window', root, `--folder=${root}`],
      expect.objectContaining({ cwd: root, detached: true, stdio: 'ignore' }),
    )
    const options = mocks.spawn.mock.calls[0][2]
    expect(options.shell).toBeUndefined()
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(options.env.NODE_OPTIONS).toBeUndefined()
    expect(child.unref).toHaveBeenCalledOnce()
  })
  it('supports absolute executable paths with spaces and appends the directory when no placeholder exists', async () => {
    mocks.login.mockRejectedValueOnce(new Error('shell initialization timed out'))
    await openWorkspaceWith(root, { ...opener, command, arguments: '--new-window' })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual([command, ['--new-window', root]])
  })
  it('rejects missing or non-executable programs and inaccessible directories before spawning', async () => {
    await expect(
      openWorkspaceWith(root, { ...opener, command: 'missing-cota-editor' }),
    ).rejects.toThrow('找不到')
    await writeFile(join(root, 'not-executable'), '')
    await expect(
      openWorkspaceWith(root, { ...opener, command: join(root, 'not-executable') }),
    ).rejects.toThrow('无法执行')
    await expect(openWorkspaceWith(join(root, 'missing'), opener)).rejects.toThrow('不可访问')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('reports commands that launch but exit unsuccessfully', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.emit('spawn')
        child.emit('exit', 2)
      })
      return child
    })
    await expect(openWorkspaceWith(root, opener)).rejects.toThrow('状态码 2')
  })
  it('reports spawn errors instead of claiming success', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('error', new Error('permission denied')))
      return child
    })
    await expect(openWorkspaceWith(root, opener)).rejects.toThrow(
      '无法启动 Editor：permission denied',
    )
    expect(child.unref).not.toHaveBeenCalled()
  })
})
