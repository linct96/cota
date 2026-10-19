import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitService, gitEnvironment } from '../src/main/git-worktrees'
import { once } from 'node:events'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { HostClient, connectTerminalHost, hostDirectory } from '../src/main/host-client'
import { HOST_PROTOCOL, MAX_FRAME, readMessages } from '../src/main/host-protocol'
import { startHost } from '../src/main/host-server'
import { DEFAULT_CONFIG } from '../src/shared/contracts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  hostSpawn: vi.fn(),
  stop: vi.fn(),
  busy: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mocks.hostSpawn,
}))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../src/main/process-tree', () => ({
  stopProcessTree: mocks.stop,
  hasRunningJob: mocks.busy,
}))
vi.mock('../src/main/shell', () => ({
  resolveShell: async () => '/bin/sh',
  shellEnvironment: () => ({}),
}))

let directory: string
let server: Awaited<ReturnType<typeof startHost>>
const clients: HostClient[] = []
const token = randomBytes(32).toString('hex')
async function client(secret = token, version = HOST_PROTOCOL, send = vi.fn()) {
  const socket = connect(join(directory, 'host.sock'))
  await once(socket, 'connect')
  const value = new HostClient(socket, send)
  clients.push(value)
  await value.request('hello', [secret, version])
  return value
}
beforeEach(async () => {
  mocks.spawn.mockReset().mockImplementation(() => {
    const listeners: Record<string, (data: any) => void> = {}
    return {
      pid: 12345,
      listeners,
      pause: vi.fn(),
      resume: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      onData: (callback: (data: string) => void) => {
        listeners.data = callback
        return { dispose: vi.fn() }
      },
      onExit: (callback: (data: unknown) => void) => {
        listeners.exit = callback
        return { dispose: vi.fn() }
      },
    }
  })
  mocks.stop.mockReset().mockResolvedValue(undefined)
  mocks.busy.mockReset().mockResolvedValue(false)
  directory = await realpath(await mkdtemp(join(tmpdir(), 'ch-')))
  server = await startHost(directory, token)
})
afterEach(async () => {
  for (const value of clients.splice(0)) value.disconnect()
  await server.manager.shutdown()
  await server.stop()
  await rm(directory, { recursive: true, force: true })
})

describe('local terminal Host', () => {
  it('rejects missing credentials and incompatible protocols before granting any capability', async () => {
    await expect(client('0'.repeat(64))).rejects.toThrow('断开')
    await expect(client(token, HOST_PROTOCOL + 1)).rejects.toThrow('断开')
    await expect(client(token, 1)).rejects.toThrow('断开')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(await (await client()).request('list', [])).toEqual([])
  })
  it('reconnects to the same shell and final screen after the entire client disconnects', async () => {
    const events = vi.fn()
    const first = await client(token, HOST_PROTOCOL, events)
    const options = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      projectPath: directory,
      cwd: directory,
      workspaceKind: 'local' as const,
      cols: 80,
      rows: 24,
    }
    await first.request('create', [options, DEFAULT_CONFIG.preferences])
    expect(await first.request('needsCloseConfirmation', [options.id])).toBe(false)
    mocks.busy.mockResolvedValueOnce(true)
    expect(await first.request('needsCloseConfirmation', [options.id])).toBe(true)
    const firstAttachment = randomUUID()
    await first.request('attach', [{ ...options, attachmentId: firstAttachment }])
    expect(events).not.toHaveBeenCalled()
    mocks.stop.mockRejectedValueOnce(new Error('close failed'))
    const failedClose = first.request('close', [options.id])
    expect(events).toHaveBeenLastCalledWith({
      type: 'closing',
      id: options.id,
      attachmentId: firstAttachment,
      closing: true,
    })
    await expect(failedClose).rejects.toThrow('close failed')
    expect(events).toHaveBeenLastCalledWith({
      type: 'closing',
      id: options.id,
      attachmentId: firstAttachment,
      closing: false,
    })
    expect(await first.request('list', [])).toHaveLength(1)
    first.disconnect()
    await vi.waitFor(async () => expect(await server.manager.list()).toHaveLength(1))
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('continued while the app was disconnected\r\n')
    process.listeners.exit({ exitCode: 7 })
    const second = await client(token, HOST_PROTOCOL, events)
    expect(await second.request('list', [])).toEqual([
      expect.objectContaining({ id: options.id, exited: true, exitCode: 7 }),
    ])
    const secondAttachment = randomUUID()
    const restored = await second.request('attach', [
      { ...options, attachmentId: secondAttachment },
    ])
    expect(restored.snapshot).toContain('continued while the app was disconnected')
    await second.request('detach', [options.id, firstAttachment])
    expect(mocks.spawn).toHaveBeenCalledOnce()
    events.mockClear()
    await second.request('close', [options.id])
    expect(events).toHaveBeenCalledExactlyOnceWith({
      type: 'closing',
      id: options.id,
      attachmentId: secondAttachment,
      closing: true,
    })
    expect(await second.request('list', [])).toEqual([])
  })
  it('spawns isolated Worktree shells, preserves immutable identity across reconnect and rejects missing or changed cwd', async () => {
    const repo = join(directory, '仓库 path')
    await mkdir(repo)
    const git = async (...args: string[]) =>
      promisify(execFile)('git', args, { cwd: repo, env: gitEnvironment() })
    await git('init', '-b', 'main')
    await writeFile(join(repo, 'example.txt'), 'initial')
    await git('add', '.')
    await git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'initial',
    )
    const a = join(directory, 'Worktree A')
    const b = join(directory, 'Worktree B')
    await git('worktree', 'add', '-b', 'a', a)
    await git('worktree', 'add', '-b', 'b', b)
    const identity = await new GitService().requireRepository(repo)
    const options = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      projectPath: repo,
      cwd: a,
      workspaceKind: 'git-worktree' as const,
      worktreeId: randomUUID(),
      repoCommonDir: identity.repoCommonDir,
      cols: 80,
      rows: 24,
    }
    const connection = await client()
    await connection.request('create', [options, DEFAULT_CONFIG.preferences])
    await connection.request('create', [options, DEFAULT_CONFIG.preferences])
    const other = {
      ...options,
      id: randomUUID(),
      workspaceId: randomUUID(),
      worktreeId: randomUUID(),
      cwd: b,
    }
    await connection.request('create', [other, DEFAULT_CONFIG.preferences])
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn.mock.calls.map(([, , value]) => value.cwd)).toEqual([a, b])
    await writeFile(join(a, 'example.txt'), 'only A')
    expect(await readFile(join(b, 'example.txt'), 'utf8')).toBe('initial')
    await expect(
      connection.request('create', [{ ...options, cwd: b }, DEFAULT_CONFIG.preferences]),
    ).rejects.toThrow('占用')
    await expect(
      connection.request('attach', [{ ...options, cwd: b, attachmentId: randomUUID() }]),
    ).rejects.toThrow('不存在')
    await expect(
      connection.request('create', [
        { ...options, id: randomUUID(), cwd: repo },
        DEFAULT_CONFIG.preferences,
      ]),
    ).rejects.toThrow('不会回退')
    connection.disconnect()
    const reconnected = await client()
    expect(
      await reconnected.request('attach', [{ ...options, attachmentId: randomUUID() }]),
    ).toMatchObject({ cwd: a, worktreeId: options.worktreeId })
    await writeFile(join(a, 'example.txt'), 'initial')
    await git('worktree', 'remove', '--', a)
    await expect(
      reconnected.request('create', [{ ...options, id: randomUUID() }, DEFAULT_CONFIG.preferences]),
    ).rejects.toThrow()
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(await reconnected.request('list', [])).toHaveLength(2)
  }, 15000)
  it('refuses live protocol-1 Host metadata without replacing its process or runtime file', async () => {
    const userData = join(directory, 'old-profile')
    const runtime = hostDirectory(userData)
    await mkdir(runtime, { mode: 0o700 })
    const file = join(runtime, 'runtime.json')
    const content = JSON.stringify({ pid: process.pid, token, version: 1 })
    try {
      await writeFile(file, content, { mode: 0o600 })
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('协议')
      expect(await readFile(file, 'utf8')).toBe(content)
    } finally {
      await rm(runtime, { recursive: true, force: true })
    }
  })
  it.each([1, HOST_PROTOCOL])(
    'cleans dead Host metadata for protocol %s before spawning a replacement',
    async (version) => {
      const userData = join(directory, 'dead-profile')
      const runtime = hostDirectory(userData)
      await mkdir(runtime, { mode: 0o700 })
      const file = join(runtime, 'runtime.json')
      const socket = join(runtime, 'host.sock')
      const spawnError = new Error('replacement spawn reached')
      const spawn = mocks.hostSpawn.mockImplementationOnce(() => {
        throw spawnError
      })
      const probe = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      })
      try {
        await writeFile(file, JSON.stringify({ pid: process.pid, token, version }), { mode: 0o600 })
        if (version === 1) await writeFile(socket, '')
        await expect(connectTerminalHost(userData, vi.fn())).rejects.toBe(spawnError)
        expect(probe).toHaveBeenCalledExactlyOnceWith(process.pid, 0)
        expect(spawn).toHaveBeenCalledOnce()
        await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(stat(socket)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        probe.mockRestore()
        spawn.mockReset()
        await rm(runtime, { recursive: true, force: true })
      }
    },
  )
  it('preserves incompatible Host metadata when its process cannot be probed', async () => {
    const userData = join(directory, 'unprobeable-profile')
    const runtime = hostDirectory(userData)
    await mkdir(runtime, { mode: 0o700 })
    const file = join(runtime, 'runtime.json')
    const content = JSON.stringify({ pid: process.pid, token, version: 1 })
    const probeError = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    const probe = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw probeError
    })
    try {
      await writeFile(file, content, { mode: 0o600 })
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toBe(probeError)
      expect(await readFile(file, 'utf8')).toBe(content)
    } finally {
      probe.mockRestore()
      await rm(runtime, { recursive: true, force: true })
    }
  })
  it('detaches a late attach response after its renderer has already disconnected', async () => {
    const connection = await client()
    const options = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      projectPath: directory,
      cwd: directory,
      workspaceKind: 'local' as const,
      cols: 80,
      rows: 24,
    }
    await connection.request('create', [options, DEFAULT_CONFIG.preferences])
    const attaching = connection.request('attach', [{ ...options, attachmentId: randomUUID() }])
    const rejected = expect(attaching).rejects.toThrow('视图已断开')
    await connection.detachAll()
    await rejected
    const restored = await connection.request('attach', [
      { ...options, attachmentId: randomUUID() },
    ])
    expect(restored.exited).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
  it('restricts socket permissions and rejects public or symlinked credentials', async () => {
    expect((await stat(join(directory, 'host.sock'))).mode & 0o777).toBe(0o600)
    const userData = join(directory, 'unsafe-profile')
    const runtime = hostDirectory(userData)
    const metadata = join(runtime, 'runtime.json')
    await mkdir(runtime, { mode: 0o700 })
    try {
      await writeFile(
        metadata,
        JSON.stringify({ pid: process.pid, token, version: HOST_PROTOCOL }),
        { mode: 0o600 },
      )
      await chmod(runtime, 0o755)
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('目录权限不安全')
      await chmod(runtime, 0o700)
      await chmod(metadata, 0o644)
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('元数据权限')
      await unlink(metadata)
      await symlink(join(directory, 'other-credentials'), metadata)
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('元数据权限')
    } finally {
      await rm(runtime, { recursive: true, force: true })
    }
  })
  it('never replaces an unreachable host whose PID is alive', async () => {
    const userData = join(directory, 'profile')
    const runtime = hostDirectory(userData)
    await mkdir(runtime, { mode: 0o700 })
    try {
      await writeFile(
        join(runtime, 'runtime.json'),
        JSON.stringify({ pid: process.pid, token, version: HOST_PROTOCOL }),
        { mode: 0o600 },
      )
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('仍在运行')
      const { readFile } = await import('node:fs/promises')
      expect(JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8')).pid).toBe(
        process.pid,
      )
    } finally {
      await rm(runtime, { recursive: true, force: true })
    }
  })
  it('rejects malformed and oversized protocol frames instead of buffering without a bound', async () => {
    const { Socket } = await import('node:net')
    const socket = new Socket()
    const receive = vi.fn()
    readMessages(socket, receive)
    socket.emit('data', Buffer.from('{bad json}\n'))
    expect(socket.destroyed).toBe(true)
    expect(receive).not.toHaveBeenCalled()
    const large = new Socket()
    readMessages(large, receive)
    large.emit('data', Buffer.alloc(MAX_FRAME + 1, 120))
    expect(large.destroyed).toBe(true)
  })
})
