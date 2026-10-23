import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileExplorerService } from '../src/main/files/file-explorer'
import { FileExplorerWatches } from '../src/main/files/file-explorer-watch'

let directory: string
let root: string
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'cota-files-')))
  root = join(directory, 'workspace')
  await mkdir(root)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('file explorer', () => {
  it('browses folders and internal symlinks without reading outside the workspace', async () => {
    const files = new FileExplorerService()
    expect(await files.list(root, '')).toEqual([])
    await mkdir(join(root, 'src'))
    await writeFile(join(root, '.git'), 'gitdir: elsewhere')
    await writeFile(join(root, '.env'), 'TOKEN=fixture')
    await writeFile(join(root, 'file10.txt'), 'ten')
    await writeFile(join(root, 'file2.txt'), 'two')
    expect((await files.list(root, '')).map((entry) => entry.name)).toEqual([
      'src',
      '.env',
      'file2.txt',
      'file10.txt',
    ])
    await writeFile(join(root, 'src', '中文 空格.txt'), '你好\n')
    expect(await files.read(root, 'src/中文 空格.txt')).toEqual({ kind: 'text', content: '你好\n' })
    await writeFile(join(root, 'src', '中文 空格.txt'), 'updated\n')
    expect(await files.read(root, 'src/中文 空格.txt')).toEqual({
      kind: 'text',
      content: 'updated\n',
    })
    await writeFile(join(root, 'binary'), Buffer.from([1, 0, 3]))
    await writeFile(join(root, 'invalid-utf8'), Buffer.from([0xff, 0xfe]))
    await writeFile(join(root, 'large'), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    for (const name of ['binary', 'invalid-utf8', 'large', 'src']) {
      expect(await files.read(root, name)).toMatchObject({ kind: 'unavailable' })
    }
    await symlink('src', join(root, 'linked-src'))
    expect(await files.list(root, 'linked-src')).toEqual([
      { name: '中文 空格.txt', path: 'linked-src/中文 空格.txt', kind: 'file' },
    ])
    const noLinks = new FileExplorerService(() => ({ showIgnored: true, followSymlinks: false }))
    await expect(noLinks.list(root, 'linked-src')).rejects.toThrow('不跟随符号链接')
    await mkdir(join(directory, 'outside'))
    await writeFile(join(directory, 'outside', 'secret'), 'must not read')
    await symlink(join(directory, 'outside'), join(root, 'linked-dir'))
    await symlink(join(directory, 'outside', 'secret'), join(root, 'linked-file'))
    await symlink('missing', join(root, 'dangling'))
    expect((await files.list(root, '')).filter((entry) => entry.kind === 'link')).toHaveLength(3)
    expect(await files.read(root, 'linked-file')).toEqual({
      kind: 'link',
      target: join(directory, 'outside', 'secret'),
    })
    expect(await files.read(root, 'dangling')).toEqual({ kind: 'link', target: 'missing' })
    await expect(files.list(root, 'linked-dir')).rejects.toThrow('工作区外')
    await expect(files.read(root, 'linked-dir/secret')).rejects.toThrow('工作区外')
    expect(await files.location(root, 'linked-file')).toBe(join(root, 'linked-file'))
    for (const path of [
      '../outside/secret',
      '/etc/passwd',
      'C:/Windows',
      'src\\file',
      'src//file',
      './src',
      '.git',
      'src/.GIT/config',
      'src/../file',
      'nul\0',
      null,
      {},
    ]) {
      await expect(files.list(root, path)).rejects.toThrow('路径无效')
      await expect(files.read(root, path)).rejects.toThrow('路径无效')
    }
    await symlink(root, join(directory, 'root-link'))
    await expect(files.list(join(directory, 'root-link'), '')).rejects.toThrow('真实路径')
    await rm(join(root, 'file2.txt'))
    await expect(files.read(root, 'file2.txt')).rejects.toThrow()
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('TOKEN=fixture')
    expect(await readFile(join(directory, 'outside', 'secret'), 'utf8')).toBe('must not read')

    const git = (...args: string[]) =>
      promisify(execFile)('git', args, {
        cwd: root,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        timeout: 5000,
      })
    await rm(join(root, '.git'))
    await git('init', '--quiet')
    await mkdir(join(root, 'generated'))
    await writeFile(join(root, '.gitignore'), 'generated/\n*.log\n!keep.log\n')
    for (const name of ['ignored.log', '-中文 空格\n.log', 'keep.log', 'tracked.log'])
      await writeFile(join(root, name), 'fixture')
    await writeFile(join(root, 'generated', 'output.ts'), 'generated')
    await git('add', '--force', '--', 'tracked.log')
    const entries = await files.list(root, '')
    expect(entries.filter((entry) => entry.ignored).map((entry) => entry.name)).toEqual([
      'generated',
      '-中文 空格\n.log',
      'ignored.log',
    ])
    expect(entries.find((entry) => entry.name === 'keep.log')?.ignored).toBeUndefined()
    expect(entries.find((entry) => entry.name === 'tracked.log')?.ignored).toBeUndefined()
    expect(await files.list(root, 'generated')).toEqual([
      { name: 'output.ts', path: 'generated/output.ts', kind: 'file', ignored: true },
    ])
    await writeFile(join(root, 'src', '.gitignore'), '*.tmp\n!keep.tmp\n')
    await writeFile(join(root, 'src', 'ignored.tmp'), 'ignored')
    await writeFile(join(root, 'src', 'keep.tmp'), 'keep')
    expect((await files.list(root, 'src')).filter((entry) => entry.ignored)).toEqual([
      { name: 'ignored.tmp', path: 'src/ignored.tmp', kind: 'file', ignored: true },
    ])
    await writeFile(join(root, '.gitignore'), '')
    expect((await files.list(root, '')).some((entry) => entry.ignored)).toBe(false)
  })

  it('coalesces directory events and cleans up failed, replaced and cancelled watches', async () => {
    const watched = new Map<string, { watcher: FSWatcher; emit: (filename?: string) => void }>()
    const watch = vi.fn((...args: unknown[]) => {
      const [path, , listener] = args
      if (typeof listener !== 'function') throw new Error('Missing listener')
      const watcher = new EventEmitter() as FSWatcher
      watcher.close = vi.fn(() => {
        watcher.emit('close')
      })
      watched.set(String(path), {
        watcher,
        emit: (filename = 'file.txt') => listener('change', filename),
      })
      return watcher
    })
    const service = new FileExplorerWatches(watch)
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const notify = vi.fn()
    await mkdir(join(root, 'src'))
    try {
      expect(await service.start(id, ['', 'src'], async () => root, notify)).toBe(true)
      vi.useFakeTimers()
      watched.get(root)!.emit()
      watched.get(root)!.emit()
      watched.get(join(root, 'src'))!.emit()
      await vi.advanceTimersByTimeAsync(250)
      await vi.waitFor(() =>
        expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'change', paths: ['', 'src'] }),
      )
      watched.get(root)!.emit('.gitignore')
      await vi.advanceTimersByTimeAsync(250)
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
      expect(notify).toHaveBeenLastCalledWith({ kind: 'change', paths: ['', 'src'] })
      watched.get(root)!.watcher.emit('error', new Error('watch limit'))
      expect(notify).toHaveBeenLastCalledWith({ kind: 'unavailable', error: expect.any(String) })
      for (const { watcher } of watched.values()) expect(watcher.close).toHaveBeenCalledOnce()
      watched.clear()
      expect(await service.start(id, ['', 'src'], async () => root, notify)).toBe(true)
      await rename(join(root, 'src'), join(root, 'old-src'))
      await mkdir(join(root, 'src'))
      watched.get(join(root, 'src'))!.emit()
      await vi.advanceTimersByTimeAsync(250)
      await vi.waitFor(() => expect(watched.get(root)!.watcher.close).toHaveBeenCalledOnce())
      expect(notify).toHaveBeenLastCalledWith({ kind: 'unavailable', error: expect.any(String) })
      watched.clear()
      watch.mockImplementationOnce(() => {
        throw new Error('unsupported')
      })
      expect(await service.start(id, [''], async () => root, notify)).toBe(false)
      let resolveRoot!: (path: string) => void
      const pending = service.start(
        id,
        [''],
        () =>
          new Promise((resolve) => {
            resolveRoot = resolve
          }),
        notify,
      )
      const count = watch.mock.calls.length
      service.stop(id)
      resolveRoot(root)
      expect(await pending).toBe(false)
      expect(watch).toHaveBeenCalledTimes(count)
      await symlink(join(directory, 'outside'), join(root, 'link'))
      expect(await service.start(id, ['link'], async () => root, notify)).toBe(false)
      await expect(
        service.start(id, Array(129).fill('src'), async () => root, notify),
      ).rejects.toThrow('128')
      await expect(service.start('invalid', [''], async () => root, notify)).rejects.toThrow()
      expect(await service.start(id, [''], async () => root, notify)).toBe(true)
      service.close()
      expect(watched.get(root)!.watcher.close).toHaveBeenCalledOnce()
    } finally {
      service.close()
    }
  })
})
