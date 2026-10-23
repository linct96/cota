import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { GitService, gitEnvironment } from '../src/main/git/git-worktrees'
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
import {
  HostClient,
  connectTerminalHost,
  forceStopTerminalHost,
  hostDirectory,
} from '../src/main/host/host-client'
import { HOST_PROTOCOL, MAX_FRAME, readMessages } from '../src/main/host/host-protocol'
import { startHost } from '../src/main/host/host-server'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import { Terminal } from '@xterm/xterm'
import { installTerminalInput } from '../src/renderer/src/lib/terminal-input'

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
vi.mock('../src/main/agents/registry', () => ({
  resolveAgent: async (provider: string) => ({
    executable: `/fake/${provider}`,
    args: [],
    env: {},
  }),
  agentCapability: async () => 'partial',
}))
vi.mock('../src/main/agents/process-observation', async (original) => ({
  ...(await original<object>()),
  agentProcesses: async () => [
    { pid: 12345, parent: 1, group: 12345, foreground: 12345, stat: 'S', started: 'pty-root' },
    { pid: 12346, parent: 12345, group: 12345, foreground: 12345, stat: 'S', started: 'hook' },
  ],
}))
vi.mock('../src/main/system/process-tree', () => ({
  stopProcessTree: mocks.stop,
  hasRunningJob: mocks.busy,
}))
vi.mock('../src/main/system/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/system/shell')>()),
  resolveShell: async () => '/bin/sh',
  shellEnvironment: () => ({}),
}))

let directory: string
let server: Awaited<ReturnType<typeof startHost>>
const clients: HostClient[] = []
const token = randomBytes(32).toString('hex')
async function client(secret = token, version = HOST_PROTOCOL, send = vi.fn(), agents = vi.fn()) {
  const socket = connect(join(directory, 'host.sock'))
  await once(socket, 'connect')
  const value = new HostClient(socket, send, agents)
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
    await expect(client(token, HOST_PROTOCOL - 1)).rejects.toThrow('断开')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(await (await client()).request('list', [])).toEqual([])
  })
  it('preserves legacy mouse bytes through input forwarding and the Host', async () => {
    const connection = await client()
    const id = randomUUID()
    await connection.request('create', [
      {
        id,
        workspaceId: randomUUID(),
        projectPath: directory,
        cwd: directory,
        workspaceKind: 'local',
        cols: 80,
        rows: 24,
      },
      DEFAULT_CONFIG.preferences,
    ])
    const terminal = new Terminal()
    // Exercise input routing without opening a DOM terminal or spawning a real PTY.
    Object.defineProperties(terminal, {
      textarea: { value: Object.assign(new EventTarget(), { value: '' }) },
      element: { value: new EventTarget() },
    })
    const core = (
      terminal as unknown as {
        _core: { coreService: { triggerBinaryEvent(data: string): void } }
      }
    )._core.coreService
    let active = true
    const pending: Promise<void>[] = []
    const input = installTerminalInput(terminal, {
      platform: 'darwin',
      canSend: () => active,
      write: (data, encoding = 'utf8') => {
        pending.push(connection.request('write', [id, data, encoding]))
      },
    })
    const ptyWrite = mocks.spawn.mock.results[0].value.write
    const legacy = '\x1b[M' + String.fromCharCode(32, 128, 255)
    try {
      terminal.input('\x1b[<65;1;1M', true)
      core.triggerBinaryEvent(legacy)
      terminal.input('中文\r', true)
      await Promise.all(pending.splice(0))
      expect(ptyWrite.mock.calls).toEqual([
        ['\x1b[<65;1;1M'],
        [Buffer.from([27, 91, 77, 32, 128, 255])],
        ['中文\r'],
      ])
      ptyWrite.mockClear()
      active = false
      core.triggerBinaryEvent(legacy)
      active = true
      terminal.options.disableStdin = true
      core.triggerBinaryEvent(legacy)
      terminal.options.disableStdin = false
      input.dispose()
      core.triggerBinaryEvent(legacy)
      await Promise.all(pending.splice(0))
      expect(ptyWrite).not.toHaveBeenCalled()

      await expect(connection.request('write', [id, '\u0100', 'binary'])).rejects.toThrow(
        '无效字节',
      )
      await expect(connection.request('write', [id, legacy, 'hex' as 'binary'])).rejects.toThrow(
        '编码无效',
      )
      await expect(
        connection.request('write', [id, 'x'.repeat(1024 * 1024 + 1), 'binary']),
      ).rejects.toThrow('1 MiB')
      expect(ptyWrite).not.toHaveBeenCalled()
      await connection.request('close', [id])
      await expect(connection.request('write', [id, legacy, 'binary'])).rejects.toThrow()
      expect(ptyWrite).not.toHaveBeenCalled()
    } finally {
      input.dispose()
      terminal.dispose()
    }
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
    const agent = {
      ...options,
      id: randomUUID(),
      kind: 'agent' as const,
      provider: 'codex' as const,
      launchId: randomUUID(),
    }
    await second.request('create', [agent, DEFAULT_CONFIG.preferences])
    await second.request('create', [agent, DEFAULT_CONFIG.preferences])
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/fake/codex',
      [],
      expect.objectContaining({ cwd: directory }),
    )
    expect(await second.request('needsCloseConfirmation', [agent.id])).toBe(true)
    second.disconnect()
    const agentUpdates = vi.fn()
    const third = await client(token, HOST_PROTOCOL, vi.fn(), agentUpdates)
    expect(await third.request('list', [])).toMatchObject([
      {
        id: agent.id,
        kind: 'agent',
        provider: 'codex',
        agent: {
          launchId: agent.launchId,
          runtimeState: 'running',
          activityState: 'unknown',
          observability: 'unavailable',
        },
      },
    ])
    expect((await stat(join(directory, 'agent.sock'))).mode & 0o777).toBe(0o600)
    const unauthenticated = connect(join(directory, 'host.sock'))
    const leaked = vi.fn()
    unauthenticated.on('data', leaked)
    unauthenticated.on('error', () => {})
    await once(unauthenticated, 'connect')
    const scopedToken = mocks.spawn.mock.calls[1][2].env.COTA_AGENT_TOKEN
    await expect(client(scopedToken)).rejects.toThrow('断开')
    const native = (type: string) => ({
      terminalId: agent.id,
      managed: true,
      processId: 12346,
      sessionId: 'native-session',
      provider: 'codex',
      token: scopedToken,
      eventId: randomUUID(),
      timestamp: Date.now(),
      type,
      turnId: 'native-turn',
    })
    const deliver = async (value: unknown) => {
      const socket = connect(join(directory, 'agent.sock'))
      socket.on('error', () => {})
      await once(socket, 'connect')
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
      const text = typeof value === 'string' ? value : `${JSON.stringify(value)}\n`
      socket.write(text.slice(0, 10))
      socket.end(text.slice(10))
      await closed
    }
    await deliver({ ...native('turn-started'), token }) // The administrative token grants no event capability.
    await deliver({ ...native('turn-started'), terminalId: options.id })
    await deliver('x'.repeat(4097))
    expect((await third.request('list', []))[0].agent?.activityState).toBe('unknown')
    await deliver(native('turn-started'))
    await vi.waitFor(() =>
      expect(agentUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'state',
          session: expect.objectContaining({ activityState: 'working' }),
        }),
      ),
    )
    expect(leaked).not.toHaveBeenCalled()
    unauthenticated.destroy()
    await deliver(native('attention-required'))
    let current = (await third.request('list', []))[0].agent!
    expect(current).toMatchObject({ activityState: 'needs-input', unread: true })
    await third.request('readAgent', [agent.id, agent.launchId, current.revision - 1])
    expect((await third.request('list', []))[0].agent?.unread).toBe(true)
    await third.request('readAgent', [agent.id, agent.launchId, current.revision])
    expect((await third.request('list', []))[0].agent).toMatchObject({
      activityState: 'needs-input',
      unread: false,
    })
    await deliver(native('turn-active'))
    await deliver(native('turn-ended'))
    await deliver(native('turn-completed'))
    current = (await third.request('list', []))[0].agent!
    expect(current).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      observability: 'partial',
      unread: true,
    })
    third.disconnect()
    const closeEvents = vi.fn()
    const fourth = await client(token, HOST_PROTOCOL, closeEvents)
    expect((await fourth.request('list', []))[0].agent).toEqual(current)
    expect(agentUpdates).toHaveBeenCalledWith({ type: 'disconnected' })
    await deliver(native('turn-active'))
    expect((await fourth.request('list', []))[0].agent).toMatchObject({
      activityState: 'working',
      observability: 'partial',
    })
    const failureAttachment = randomUUID()
    await fourth.request('attach', [{ ...agent, attachmentId: failureAttachment }])
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(fourth.request('close', [agent.id])).rejects.toThrow('permission denied')
    expect(closeEvents).toHaveBeenCalledWith({
      type: 'closing',
      id: agent.id,
      attachmentId: failureAttachment,
      closing: true,
    })
    expect(closeEvents).toHaveBeenCalledWith({
      type: 'closing',
      id: agent.id,
      attachmentId: failureAttachment,
      closing: false,
    })
    expect((await fourth.request('list', []))[0].agent).toMatchObject({
      runtimeState: 'running',
      activityState: 'unknown',
      observability: 'unavailable',
    })
    await fourth.request('write', [agent.id, 'save before retry\r'])
    await fourth.request('resize', [agent.id, 100, 30])
    expect(mocks.spawn.mock.results[1].value.write).toHaveBeenCalledWith('save before retry\r')
    expect(mocks.spawn.mock.results[1].value.resize).toHaveBeenCalledWith(100, 30)
    expect(await fourth.request('needsCloseConfirmation', [agent.id])).toBe(true)
    mocks.spawn.mock.results[1].value.listeners.data('agent final screen\r\n')
    mocks.spawn.mock.results[1].value.listeners.exit({ exitCode: 9 })
    const attachedAgent = await fourth.request('attach', [{ ...agent, attachmentId: randomUUID() }])
    expect(attachedAgent.snapshot).toContain('agent final screen')
    expect(attachedAgent.agent).toMatchObject({
      launchId: agent.launchId,
      runtimeState: 'exited',
      exitCode: 9,
    })
    await deliver(native('turn-started'))
    expect((await fourth.request('list', []))[0].agent?.runtimeState).toBe('exited')
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    await fourth.request('close', [agent.id])
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
      await expect(forceStopTerminalHost(userData)).rejects.toThrow('进程标识无效')
      expect(mocks.stop).not.toHaveBeenCalled()
      expect(await readFile(file, 'utf8')).toBe(content)
    } finally {
      await rm(runtime, { recursive: true, force: true })
    }
  })
  it.each([1, HOST_PROTOCOL])(
    'force-cleans only a verified Host and waits for its process tree: protocol %s',
    async (version) => {
      const userData = join(directory, 'force-profile')
      const runtime = hostDirectory(userData)
      await mkdir(runtime, { mode: 0o700 })
      const file = join(runtime, 'runtime.json')
      const content = JSON.stringify({ pid: 12345, token, version })
      let stopped = false
      const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        expect(pid).toBe(12345)
        expect(signal).toBe(0)
        if (stopped) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
        return true
      })
      const query = vi.fn().mockResolvedValue({ stdout: '/unrelated/program' })
      const command = vi.spyOn(childProcess, 'execFile')
      Object.defineProperty(command, promisify.custom, { value: query })
      try {
        await writeFile(file, content, { mode: 0o600 })
        await writeFile(join(runtime, 'host.sock'), '')
        await writeFile(join(runtime, 'agent.sock'), '')
        await expect(forceStopTerminalHost(userData)).rejects.toThrow('进程身份不匹配')
        expect(mocks.stop).not.toHaveBeenCalled()
        expect(await readFile(file, 'utf8')).toBe(content)
        query.mockResolvedValue({
          stdout: `${process.execPath} ${join(import.meta.dirname, '../src/main/host/host.js')}`,
        })
        mocks.stop.mockRejectedValueOnce(new Error('child still running'))
        await expect(forceStopTerminalHost(userData)).rejects.toThrow('child still running')
        expect(await readFile(file, 'utf8')).toBe(content)
        stopped = true
        await expect(forceStopTerminalHost(userData)).rejects.toThrow('无法确认残留进程')
        expect(await readFile(file, 'utf8')).toBe(content)
        stopped = false
        await expect(forceStopTerminalHost(userData)).rejects.toThrow('尚未结束')
        expect(await readFile(file, 'utf8')).toBe(content)
        mocks.stop.mockImplementationOnce(async () => {
          stopped = true
        })
        await forceStopTerminalHost(userData)
        for (const name of ['runtime.json', 'host.sock', 'agent.sock'])
          await expect(stat(join(runtime, name))).rejects.toMatchObject({ code: 'ENOENT' })
        expect(mocks.hostSpawn).not.toHaveBeenCalled()
      } finally {
        command.mockRestore()
        probe.mockRestore()
        await rm(runtime, { recursive: true, force: true })
      }
    },
  )
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
      await expect(forceStopTerminalHost(userData)).rejects.toThrow('目录权限不安全')
      await chmod(runtime, 0o700)
      await chmod(metadata, 0o644)
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('元数据权限')
      await expect(forceStopTerminalHost(userData)).rejects.toThrow('元数据权限')
      await unlink(metadata)
      await symlink(join(directory, 'other-credentials'), metadata)
      await expect(connectTerminalHost(userData, vi.fn())).rejects.toThrow('元数据权限')
      await expect(forceStopTerminalHost(userData)).rejects.toThrow('元数据权限')
      expect(mocks.stop).not.toHaveBeenCalled()
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
