import { afterEach, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as PromisesModule from 'node:fs/promises'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  spawn: vi.fn(),
  ptySpawn: vi.fn(),
  adapter: vi.fn(),
  applications: new Set<string>(),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof PromisesModule>()
  return {
    ...original,
    stat: (path: string) =>
      mocks.applications.has(path)
        ? Promise.resolve({ isDirectory: () => true })
        : original.stat(path),
    access: (path: string, mode?: number) =>
      /(?:pi-extension|agent-hook)\.js$/.test(path)
        ? mocks.adapter(path)
        : original.access(path, mode),
  }
})
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.login }),
    spawn: mocks.spawn,
  }
})

vi.mock('node-pty', () => ({ spawn: mocks.ptySpawn }))

const opener = { id: 'editor', name: 'Editor', command: 'editor', arguments: '{path}' }
let root: string
let command: string
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
beforeEach(async () => {
  vi.resetAllMocks()
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
  vi.restoreAllMocks()
  mocks.applications.clear()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

export { mocks, root, command, child, opener }
