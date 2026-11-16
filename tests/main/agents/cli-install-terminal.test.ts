import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as shell from '../../../src/main/system/shell'
import * as processTree from '../../../src/main/system/process-tree'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'

import { cliManagement, installTerminal } from './cli-install.fixture'

function startTerminal(provider: 'pi' | 'codex' | 'claude' = 'codex') {
  const fixture = installTerminal()
  const updating = fixture.terminals.run(provider, async (execute) => {
    const result = await execute({ executable: provider, args: ['update'], env: {} })
    return { status: { provider, executable: '/fake/' + provider }, output: result.stdout }
  })
  void updating.catch(() => {})
  const finish = async () => {
    fixture.terminals.detachAll()
    fixture.installChild.emit('exit', { exitCode: 0 })
    await updating.catch(() => {})
  }
  return { ...fixture, updating, finish }
}

describe('Agent CLI update terminals', () => {
  it('blocks duplicate Codex updates and refreshes the CLI after success', async () => {
    const { restarted, launch } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    mocks.login.mockImplementation((_file: string, args: string[]) =>
      Promise.resolve({
        stdout: args[0] === '--version' ? '0.159.0' : '\0' + join(root, 'bin') + '\0',
        stderr: '',
      }),
    )
    const idle = vi.fn().mockResolvedValue(undefined)
    const { installChild, terminals } = installTerminal()
    const updating = terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    void updating.catch(() => {})
    try {
      await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledOnce())
      expect(mocks.ptySpawn).toHaveBeenCalledWith(
        join(root, 'bin', 'codex'),
        ['update'],
        expect.objectContaining({ cols: 100, rows: 28 }),
      )
      expect(terminals.running).toBe(true)
      await expect(
        terminals.run('codex', () =>
          Promise.resolve({ status: { provider: 'codex' }, output: '' }),
        ),
      ).rejects.toThrow('等待完成')
      await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
        '正在更新',
      )
      await writeFile(join(root, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o700 })
      installChild.emit('exit', { exitCode: 0 })
      await updating
      expect(idle).toHaveBeenCalledTimes(2)
      expect(terminals.running).toBe(false)
      expect((await terminals.snapshot('codex'))?.run.status).toBe('succeeded')
    } finally {
      terminals.detachAll()
      installChild.emit('exit', { exitCode: 0 })
      await updating.catch(() => {})
    }
  })

  it('retains output when an update terminal is reopened without launching another command', async () => {
    const { installChild, progress, terminals, finish } = startTerminal()
    try {
      installChild.emit('data', '\x1b[32mdownloading\x1b[0m\r\n')
      const first = (await terminals.snapshot('codex'))!
      expect(first.output).toContain('downloading')
      expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
      installChild.emit('data', 'installed\r\n')
      const reopened = (await terminals.snapshot('codex'))!
      expect(reopened.run.id).toBe(first.run.id)
      expect(reopened.output).toContain('downloading')
      expect(reopened.output).toContain('installed')
      expect(reopened.revision).toBeGreaterThan(first.revision)
      expect(mocks.ptySpawn).toHaveBeenCalledOnce()
      expect(progress.mock.calls.some(([event]) => event.data?.includes('installed'))).toBe(false)
    } finally {
      await finish()
    }
  })

  it('answers terminal queries only when no renderer is attached', async () => {
    const { installChild, write, terminals, finish } = startTerminal()
    const attachment = '00000000-0000-0000-0000-000000000001'
    try {
      await terminals.snapshot('codex', attachment)
      installChild.emit('data', '\x1b[6n')
      await terminals.snapshot('codex')
      expect(write).not.toHaveBeenCalled()
      terminals.detach('codex', '00000000-0000-0000-0000-000000000002')
      installChild.emit('data', '\x1b[6n')
      await terminals.snapshot('codex')
      expect(write).not.toHaveBeenCalled()
      terminals.detach('codex', attachment)
      installChild.emit('data', '\x1b[6n')
      await terminals.snapshot('codex')
      expect(write).toHaveBeenCalledWith(expect.stringMatching(/\[\d+;\d+R$/))
    } finally {
      await finish()
    }
  })

  it('forwards valid terminal input and dimensions and rejects invalid values', async () => {
    const { write, resize, terminals, finish } = startTerminal()
    try {
      const { run } = (await terminals.snapshot('codex'))!
      terminals.write(run.id, 'y\r')
      terminals.resize(run.id, 90, 24)
      expect(write).toHaveBeenCalledWith('y\r')
      expect(resize).toHaveBeenCalledWith(90, 24)
      expect(() => terminals.write(run.id, 1)).toThrow('输入无效')
      expect(() => terminals.resize(run.id, 0, 24)).toThrow('尺寸无效')
    } finally {
      await finish()
    }
  })

  it('pauses until the active renderer acknowledges output or detaches', async () => {
    const { installChild, pause, resume, progress, terminals, finish } = startTerminal()
    const attachment = '00000000-0000-0000-0000-000000000001'
    const activeAttachment = '00000000-0000-0000-0000-000000000003'
    try {
      await terminals.snapshot('codex', activeAttachment)
      const chunk = 'streamed ' + 'x'.repeat(16 * 1024) + '\r\n'
      for (let index = 0; index < 4; index++) {
        installChild.emit('data', chunk)
        await terminals.snapshot('codex')
      }
      expect(pause).toHaveBeenCalledOnce()
      expect(resume).not.toHaveBeenCalled()
      await vi.waitFor(() =>
        expect(
          progress.mock.calls
            .filter(([event]) => event.attachmentId === activeAttachment)
            .reduce((length, [event]) => length + event.data.length, 0),
        ).toBe(chunk.length * 4),
      )
      terminals.acknowledge('codex', attachment, chunk.length * 4)
      for (const length of [-1, 0, 0.5, NaN, chunk.length * 4 + 1])
        terminals.acknowledge('codex', activeAttachment, length)
      expect(resume).not.toHaveBeenCalled()
      terminals.acknowledge('codex', activeAttachment, chunk.length * 4)
      expect(resume).toHaveBeenCalledOnce()
      installChild.emit('data', 'x'.repeat(64 * 1024))
      await terminals.snapshot('codex')
      expect(pause).toHaveBeenCalledTimes(2)
      terminals.detach('codex', attachment)
      expect(resume).toHaveBeenCalledOnce()
      terminals.detach('codex', activeAttachment)
      expect(resume).toHaveBeenCalledTimes(2)
    } finally {
      await finish()
    }
  })

  it('bounds retained output and streams new output after attachment', async () => {
    const { installChild, progress, terminals, updating, finish } = startTerminal()
    try {
      installChild.emit('data', 'x'.repeat(64 * 1024))
      installChild.emit('data', '\r\nhistory-start\r\n' + 'recent line\r\n'.repeat(300))
      const history = (await terminals.snapshot('codex'))!
      expect(history.output).not.toContain('history-start')
      expect(history.output).toContain('recent line')
      expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
      await terminals.snapshot('codex', '00000000-0000-0000-0000-000000000004')
      installChild.emit('data', 'live output\r\n')
      await vi.waitFor(() =>
        expect(progress.mock.calls.some(([event]) => event.data?.includes('live output'))).toBe(
          true,
        ),
      )
      installChild.emit('exit', { exitCode: 0 })
      expect((await updating).output.length).toBe(4096)
    } finally {
      await finish()
    }
  })

  it('keeps failure output and ignores input to an earlier completed run', async () => {
    const { installChild, write, terminals } = installTerminal()
    let active: Promise<unknown> = terminals.run('codex', async (execute) => {
      await execute({ executable: 'codex', args: ['update'], env: {} })
      return { status: { provider: 'codex', executable: '/fake/codex' }, output: '' }
    })
    try {
      const first = terminals.list().find((run) => run.provider === 'codex')!
      terminals.write(first.id, 'y\r')
      installChild.emit('exit', { exitCode: 0 })
      await active
      const failed = terminals.run('pi', async (execute) => {
        await execute({ executable: 'pi', args: ['update'], env: {} })
        return { status: { provider: 'pi' }, output: '' }
      })
      active = failed
      const failure = expect(failed).rejects.toThrow('退出码 2')
      installChild.emit('data', 'network failed\r\n')
      installChild.emit('exit', { exitCode: 2 })
      await failure
      expect((await terminals.snapshot('pi'))?.output).toContain('network failed')
      expect(terminals.list().find((run) => run.provider === 'pi')?.status).toBe('failed')
      terminals.write(first.id, 'ignored')
      expect(write).toHaveBeenCalledOnce()
    } finally {
      terminals.detachAll()
      installChild.emit('exit', { exitCode: 0 })
      await active.catch(() => {})
    }
  })

  it('interrupts an update waiting to execute without spawning a process', async () => {
    const { terminals } = installTerminal()
    let release!: () => void
    const waiting = terminals.run('claude', async (execute) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await execute({ executable: 'claude', args: ['update'], env: {} })
      return { status: { provider: 'claude' }, output: '' }
    })
    const interrupted = expect(waiting).rejects.toThrow('已中断')
    try {
      const closed = terminals.close()
      release()
      await interrupted
      await closed
      expect(terminals.running).toBe(false)
      expect(mocks.ptySpawn).not.toHaveBeenCalled()
    } finally {
      release()
      await terminals.close()
      await waiting.catch(() => {})
    }
  })

  it.each([2, 15])('retains a failed run interrupted by signal %i', async (signal) => {
    const { installChild, terminals, updating, finish } = startTerminal('claude')
    try {
      const rejected = expect(updating).rejects.toThrow('信号 ' + signal)
      installChild.emit('exit', { exitCode: 0, signal })
      await rejected
      expect((await terminals.snapshot('claude'))?.run.status).toBe('failed')
    } finally {
      await finish()
    }
  })

  it('runs different updates concurrently and isolates progress and failures', async () => {
    const { restarted, launch } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(Response.json({ version: '0.159.0' })),
    )
    const idle = vi.fn().mockResolvedValue(undefined)
    const { children, terminals } = installTerminal(true)
    const pi = terminals.run('pi', (execute) =>
      restarted.update('pi', DEFAULT_CONFIG.preferences, idle, execute),
    )
    const codex = terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    const failedCodex = expect(codex).rejects.toThrow('退出码 2')
    await vi.waitFor(() => expect(children).toHaveLength(2))
    expect(terminals.list().filter((run) => run.status === 'running')).toHaveLength(2)
    await expect(restarted.update('pi', DEFAULT_CONFIG.preferences, idle, vi.fn())).rejects.toThrow(
      '正在更新',
    )
    await expect(restarted.run('pi', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
      '正在更新',
    )
    expect(await restarted.run('claude', DEFAULT_CONFIG.preferences, launch)).toEqual([])
    expect(await restarted.inspect(DEFAULT_CONFIG.preferences, false)).toHaveLength(3)

    const index = (provider: string) =>
      mocks.ptySpawn.mock.calls.findIndex(
        ([executable]) => executable === join(root, 'bin', provider),
      )
    const piChild = children[index('pi')].installChild
    const codexChild = children[index('codex')].installChild
    piChild.emit('data', 'pi output\r\n')
    codexChild.emit('data', 'codex output\r\n')
    expect((await terminals.snapshot('pi'))?.output).toContain('pi output')
    expect((await terminals.snapshot('pi'))?.output).not.toContain('codex output')
    expect((await terminals.snapshot('codex'))?.output).toContain('codex output')

    piChild.emit('exit', { exitCode: 0 })
    await pi
    expect(terminals.list().find((run) => run.provider === 'pi')?.status).toBe('succeeded')
    expect(terminals.list().find((run) => run.provider === 'codex')?.status).toBe('running')
    codexChild.emit('exit', { exitCode: 2 })
    await failedCodex
    expect(terminals.list().find((run) => run.provider === 'codex')?.status).toBe('failed')
  })

  it('synchronizes cached Agents after an interrupted update', async () => {
    const { restarted } = await cliManagement()
    const nextBin = join(root, 'next-bin')
    await mkdir(nextBin)
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(nextBin, provider), '#!/bin/sh\n', { mode: 0o700 })
    let path = join(root, 'bin')
    mocks.login.mockImplementation((file: string, args: string[]) =>
      Promise.resolve({
        stdout:
          args[0] === '--version'
            ? file.startsWith(nextBin)
              ? '0.160.0'
              : '0.159.0'
            : `\0${path}\0`,
        stderr: '',
      }),
    )
    const { installChild, terminals } = installTerminal()
    vi.spyOn(processTree, 'stopProcessTree').mockImplementation(() => {
      installChild.emit('exit', { exitCode: 0 })
      return Promise.resolve()
    })
    const updating = terminals.run('pi', (execute) =>
      restarted.update(
        'pi',
        DEFAULT_CONFIG.preferences,
        vi.fn().mockResolvedValue(undefined),
        execute,
      ),
    )
    const interrupted = expect(updating).rejects.toThrow('已中断')
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledOnce())
    path = nextBin
    await terminals.close()
    await interrupted
    const cache = restarted.read()
    expect(cache.pathEnv.startsWith(nextBin)).toBe(true)
    for (const provider of ['pi', 'codex', 'claude'])
      expect(cache.entries.find((entry) => entry.provider === provider)).toMatchObject({
        executable: join(nextBin, provider),
        version: '0.160.0',
      })
  })

  it('opens the current terminal when an older run is replaced during snapshot', async () => {
    const { terminals } = installTerminal()
    await terminals.run('pi', () => Promise.resolve({ status: { provider: 'pi' }, output: '' }))
    const snapshot = terminals.snapshot('pi', '00000000-0000-0000-0000-000000000001')
    let release!: () => void
    const next = terminals.run(
      'pi',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: { provider: 'pi' }, output: '' })
        }),
    )
    const current = terminals.list().find((run) => run.provider === 'pi')!
    expect((await snapshot)?.run.id).toBe(current.id)
    release()
    await next
  })

  it('attempts to stop every update even when one cleanup fails', async () => {
    const { children, terminals } = installTerminal(true)
    let failFirst = true
    const stop = vi.spyOn(processTree, 'stopProcessTree').mockImplementation((pid) => {
      if (pid === 12345 && failFirst) return Promise.reject(new Error('cleanup failed'))
      children[pid - 12345].installChild.emit('exit', { exitCode: 0 })
      return Promise.resolve()
    })
    const run = (provider: 'pi' | 'codex') =>
      terminals.run(provider, async (execute) => {
        await execute({ executable: provider, args: ['update'], env: {} })
        return { status: { provider }, output: '' }
      })
    const pi = expect(run('pi')).rejects.toThrow('已中断')
    const codex = expect(run('codex')).rejects.toThrow('已中断')
    await expect(terminals.close()).rejects.toThrow('cleanup failed')
    expect(stop).toHaveBeenCalledTimes(2)
    await codex
    expect(terminals.list().find((entry) => entry.provider === 'pi')?.status).toBe('running')
    failFirst = false
    await terminals.close()
    await pi
    expect(terminals.running).toBe(false)
  })

  it('clears a missing CLI from the cache without launching an installer', async () => {
    const { restarted } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    const idle = vi.fn().mockResolvedValue(undefined)
    const { terminals } = installTerminal()
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')?.executable).toBe(
      join(root, 'bin', 'codex'),
    )
    const findProgram = shell.findExecutable
    const missingCodex = new shell.ExecutableNotFoundError(
      '找不到 codex。请安装其命令行工具，并检查登录 Shell 的 PATH。',
    )
    vi.spyOn(shell, 'findExecutable').mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
    )
    const missing = await terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    expect(missing.status).toEqual({ provider: 'codex' })
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
    })
    const snapshot = (await terminals.snapshot('codex'))!
    expect(snapshot.run).toMatchObject({ status: 'not-installed' })
    expect(snapshot.run.error).toBeUndefined()
    expect(snapshot.output).not.toContain('找不到 codex')
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
  })

  it('reports a permission error and can retry when the CLI is subsequently missing', async () => {
    const { restored, restarted } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    const idle = vi.fn().mockResolvedValue(undefined)
    const { terminals } = installTerminal()
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    await restored.saveAgentClis({
      ...restarted.read(),
      entries: restarted
        .read()
        .entries.map((entry) =>
          entry.provider === 'codex'
            ? { provider: 'codex', executable: join(root, 'bin', 'codex') }
            : entry,
        ),
    })
    const findProgram = shell.findExecutable
    const permission = new Error('无法执行 codex，请检查文件权限和磁盘状态。')
    const missingCodex = new shell.ExecutableNotFoundError(
      '找不到 codex。请安装其命令行工具，并检查登录 Shell 的 PATH。',
    )
    const lookup = vi
      .spyOn(shell, 'findExecutable')
      .mockImplementation((command, env) =>
        command === 'codex' ? Promise.reject(permission) : findProgram(command, env),
      )
    await expect(
      terminals.run('codex', (execute) =>
        restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
      ),
    ).rejects.toBe(permission)
    expect((await terminals.snapshot('codex'))?.run.error).toContain('文件权限')
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
    )
    const absent = await terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    expect(absent.status).toEqual({ provider: 'codex' })
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
  })

  it('retains a failed CLI and detects its removal on a subsequent update', async () => {
    const { restarted } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    const idle = vi.fn().mockResolvedValue(undefined)
    const { installChild, terminals } = installTerminal()
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    const findProgram = shell.findExecutable
    const missingCodex = new shell.ExecutableNotFoundError(
      '找不到 codex。请安装其命令行工具，并检查登录 Shell 的 PATH。',
    )
    const lookup = vi.spyOn(shell, 'findExecutable')
    let active: Promise<unknown> | undefined
    try {
      const commandFailure = terminals.run('codex', (execute) =>
        restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
      )
      active = commandFailure
      const failedCommand = expect(commandFailure).rejects.toThrow('退出码 2')
      await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledOnce())
      installChild.emit('exit', { exitCode: 2 })
      await failedCommand
      expect(restarted.read().entries.find((entry) => entry.provider === 'codex')?.executable).toBe(
        join(root, 'bin', 'codex'),
      )
      expect((await terminals.snapshot('codex'))?.run.status).toBe('failed')
      expect((await terminals.snapshot('codex'))?.run.error).toContain('退出码 2')

      const undetected = terminals.run('codex', (execute) =>
        restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
      )
      active = undetected
      void undetected.catch(() => {})
      await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledTimes(2))
      await rm(join(root, 'bin', 'codex'))
      lookup.mockImplementation((command, env) =>
        command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
      )
      installChild.emit('exit', { exitCode: 0 })
      expect((await undetected).status.executable).toBeUndefined()
      expect((await terminals.snapshot('codex'))?.run.status).toBe('not-installed')
      expect((await terminals.snapshot('codex'))?.run.error).toBeUndefined()
      expect(mocks.ptySpawn.mock.calls.some(([executable]) => executable.endsWith('/npm'))).toBe(
        false,
      )
    } finally {
      terminals.detachAll()
      installChild.emit('exit', { exitCode: 0 })
      await active?.catch(() => {})
    }
  })

  it.each(['pi', 'claude'] as const)(
    'updates %s directly without a package manager fallback',
    async (provider) => {
      const { restarted } = await cliManagement()
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
      const idle = vi.fn().mockResolvedValue(undefined)
      const execute = vi.fn().mockResolvedValue({ stdout: 'updated', stderr: '' })
      const result = await restarted.update(provider, DEFAULT_CONFIG.preferences, idle, execute)
      expect(result.status.executable).toBe(join(root, 'bin', provider))
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ executable: join(root, 'bin', provider), args: ['update'] }),
      )
    },
  )
})
