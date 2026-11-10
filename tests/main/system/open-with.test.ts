import { child, command, mocks, opener, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as shell from '../../../src/main/system/shell'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import {
  parseArguments,
  preferredWorkspaceOpener,
  withSystemFileManager,
} from '../../../src/shared/open-with'
import { workspaceOpeners } from '../../../src/main/validation'
import { listWorkspaceOpeners, openWorkspaceWith } from '../../../src/main/system/open-with'

describe('Workspace program launching', () => {
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

  it('opens an explicitly configured Finder without shell evaluation', async () => {
    await openWorkspaceWith(root, {
      id: 'finder',
      name: 'Finder',
      command: '/usr/bin/open',
      arguments: '-a Finder {path}',
    })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-a', 'Finder', root]])
  })

  it('finds login-shell commands and passes literal paths without inherited Electron credentials', async () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    vi.stubEnv('COTA_HOST_TOKEN', 'private-host-credential')
    vi.stubEnv('NODE_CHANNEL_FD', '3')
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
    expect(options.env.COTA_HOST_TOKEN).toBeUndefined()
    expect(options.env.NODE_CHANNEL_FD).toBeUndefined()
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('supports absolute executable paths with spaces and appends the directory when no placeholder exists', async () => {
    mocks.login.mockRejectedValueOnce(new Error('shell initialization timed out'))
    await openWorkspaceWith(root, { ...opener, command, arguments: '--new-window' })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual([command, ['--new-window', root]])

    for (const name of ['code', 'zeditor'])
      await writeFile(join(root, 'bin', name), '#!/bin/sh\n', { mode: 0o700 })
    const configured = [
      { id: 'finder', name: '访达', command: '/usr/bin/open', arguments: '-a Finder {path}' },
      {
        ...opener,
        id: 'missing',
        name: 'Custom editor',
        command: 'missing-cota-editor',
        arguments: '--custom {path}',
      },
      opener,
    ]
    const loginCalls = mocks.login.mock.calls.length
    const available = listWorkspaceOpeners({
      ...DEFAULT_CONFIG.preferences,
      openWith: configured,
    })
    expect(available.slice(0, -1)).toEqual(configured)
    expect(available.at(-1)?.id).toBe('system-file-manager')
    expect(configured).toHaveLength(3)
    for (const [platform, name] of [
      ['darwin', '访达'],
      ['win32', '资源管理器'],
      ['linux', '文件管理器'],
    ]) {
      const builtIn = withSystemFileManager([], platform)
      expect(builtIn).toEqual([expect.objectContaining({ id: 'system-file-manager', name })])
      expect(withSystemFileManager([{ ...opener, id: 'system-file-manager' }], platform)).toEqual(
        builtIn,
      )
    }
    expect(mocks.login).toHaveBeenCalledTimes(loginCalls)
    const empty = listWorkspaceOpeners(DEFAULT_CONFIG.preferences)
    expect(empty).toEqual([expect.objectContaining({ id: 'system-file-manager' })])
    expect(DEFAULT_CONFIG.preferences.openWith).toEqual([])
    expect(
      preferredWorkspaceOpener({
        preferences: DEFAULT_CONFIG.preferences,
        workspaceOpeners: empty,
      })?.id,
    ).toBe('system-file-manager')
    expect(
      preferredWorkspaceOpener({
        preferences: DEFAULT_CONFIG.preferences,
        workspaceOpeners: available,
      })?.id,
    ).toBe('finder')
    expect(
      preferredWorkspaceOpener({
        preferences: { ...DEFAULT_CONFIG.preferences, preferredOpenerId: 'editor' },
        workspaceOpeners: available,
      })?.id,
    ).toBe('editor')
    expect(
      preferredWorkspaceOpener({
        preferences: { ...DEFAULT_CONFIG.preferences, preferredOpenerId: 'system-file-manager' },
        workspaceOpeners: available,
      })?.id,
    ).toBe('system-file-manager')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(
      listWorkspaceOpeners({
        ...DEFAULT_CONFIG.preferences,
        openWith: [{ ...opener, command: join(root, 'bin', 'code') }],
      }).map((entry) => entry.id),
    ).toEqual(['editor', 'system-file-manager'])

    if (process.platform === 'darwin') {
      vi.spyOn(shell, 'findExecutable').mockRejectedValue(new Error('not on PATH'))
      mocks.applications.add('/Applications/Visual Studio Code.app')
      const apps = listWorkspaceOpeners({
        ...DEFAULT_CONFIG.preferences,
        openWith: [{ id: 'vscode', name: 'VS Code', command: 'code', arguments: '{path}' }],
      })
      expect(apps).toContainEqual(expect.objectContaining({ id: 'vscode' }))
      await openWorkspaceWith(
        root,
        apps.find((entry) => entry.id === 'vscode')!,
      )
      expect(mocks.spawn.mock.calls.at(-1)!.slice(0, 2)).toEqual([
        '/usr/bin/open',
        ['-a', '/Applications/Visual Studio Code.app', root, '--args', root],
      ])
      vi.mocked(shell.findExecutable).mockRestore()
    }

    vi.useFakeTimers()
    child.unref.mockClear()
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const pending = openWorkspaceWith(root, { ...opener, command })
    await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(300)
    await pending
    child.emit('exit', 0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid executables and directories before spawning', async () => {
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
