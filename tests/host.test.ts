import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { HostClient, connectTerminalHost, hostDirectory } from '../src/main/host-client'
import { HOST_PROTOCOL, MAX_FRAME, readMessages } from '../src/main/host-protocol'
import { startHost } from '../src/main/host-server'
import { DEFAULT_CONFIG } from '../src/shared/contracts'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), stop: vi.fn(), busy: vi.fn() }))
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
async function client(secret = token, version = HOST_PROTOCOL) {
  const socket = connect(join(directory, 'host.sock'))
  await once(socket, 'connect')
  const value = new HostClient(socket, vi.fn())
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
  directory = await mkdtemp(join(tmpdir(), 'ch-'))
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
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(await (await client()).request('list', [])).toEqual([])
  })
  it('reconnects to the same shell and final screen after the entire client disconnects', async () => {
    const first = await client()
    const options = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      projectPath: directory,
      cols: 80,
      rows: 24,
    }
    await first.request('create', [options, DEFAULT_CONFIG.preferences, [directory]])
    expect(await first.request('needsCloseConfirmation', [options.id])).toBe(false)
    mocks.busy.mockResolvedValueOnce(true)
    expect(await first.request('needsCloseConfirmation', [options.id])).toBe(true)
    const firstAttachment = randomUUID()
    await first.request('attach', [{ ...options, attachmentId: firstAttachment }])
    first.disconnect()
    await vi.waitFor(async () => expect(await server.manager.list()).toHaveLength(1))
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('continued while the app was disconnected\r\n')
    process.listeners.exit({ exitCode: 7 })
    const second = await client()
    expect(await second.request('list', [])).toEqual([
      expect.objectContaining({ id: options.id, exited: true, exitCode: 7 }),
    ])
    const restored = await second.request('attach', [{ ...options, attachmentId: randomUUID() }])
    expect(restored.snapshot).toContain('continued while the app was disconnected')
    await second.request('detach', [options.id, firstAttachment])
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await second.request('close', [options.id])
    expect(await second.request('list', [])).toEqual([])
  })
  it('detaches a late attach response after its renderer has already disconnected', async () => {
    const connection = await client()
    const options = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      projectPath: directory,
      cols: 80,
      rows: 24,
    }
    await connection.request('create', [options, DEFAULT_CONFIG.preferences, [directory]])
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
