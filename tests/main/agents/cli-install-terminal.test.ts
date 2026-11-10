import { mocks, root } from '../../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as shell from '../../../src/main/system/shell'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'

import { cliManagement, installTerminal } from './cli-install.fixture'

describe('Agent CLI update terminals', () => {
  it('streams retained installation output with backpressure and keeps failure or interrupted runs inspectable', async () => {
    const { restarted, launch } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    mocks.login.mockImplementation((_file: string, args: string[]) => {
      try {
        return Promise.resolve({
          stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
          stderr: '',
        })
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    const idle = vi.fn().mockResolvedValue(undefined)
    const { installChild, write, resize, pause, resume, progress, terminals } = installTerminal()
    const updating = terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledOnce())
    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      join(root, 'bin', 'codex'),
      ['update'],
      expect.objectContaining({ cols: 100, rows: 28 }),
    )
    expect(terminals.running).toBe(true)
    await expect(
      terminals.run('pi', () => Promise.resolve({ status: { provider: 'pi' }, output: '' })),
    ).rejects.toThrow('等待完成')
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
      '正在更新',
    )
    installChild.emit('data', '\x1b[32mdownloading\x1b[0m\r\n')
    const firstSnapshot = (await terminals.snapshot('codex'))!
    expect(firstSnapshot.output).toContain('downloading')
    expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
    const attachment = '00000000-0000-0000-0000-000000000001'
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
    write.mockClear()
    terminals.write(firstSnapshot.run.id, 'y\r')
    terminals.resize(firstSnapshot.run.id, 90, 24)
    expect(write).toHaveBeenCalledWith('y\r')
    expect(resize).toHaveBeenCalledWith(90, 24)
    expect(() => terminals.write(firstSnapshot.run.id, 1)).toThrow('输入无效')
    expect(() => terminals.resize(firstSnapshot.run.id, 0, 24)).toThrow('尺寸无效')
    // Reopening reads the same terminal; no second command is launched.
    installChild.emit('data', 'installed\r\n')
    const reopened = (await terminals.snapshot('codex'))!
    expect(reopened.run.id).toBe(firstSnapshot.run.id)
    expect(reopened.output).toContain('downloading')
    expect(reopened.output).toContain('installed')
    expect(reopened.revision).toBeGreaterThan(firstSnapshot.revision)
    expect(mocks.ptySpawn).toHaveBeenCalledOnce()
    expect(progress.mock.calls.some(([event]) => event.data?.includes('installed'))).toBe(false)

    const activeAttachment = '00000000-0000-0000-0000-000000000003'
    await terminals.snapshot('codex', activeAttachment)
    const chunk = 'streamed ' + 'x'.repeat(16 * 1024) + '\r\n'
    for (let index = 0; index < 4; index++) {
      installChild.emit('data', chunk)
      await terminals.snapshot('codex')
    }
    // A drained main parser must stay paused until the renderer consumes its output.
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
    progress.mockClear()
    installChild.emit('data', '\r\nhistory-start\r\n' + 'recent line\r\n'.repeat(300))
    const shortHistory = (await terminals.snapshot('codex'))!
    expect(shortHistory.output).not.toContain('history-start')
    expect(shortHistory.output).toContain('recent line')
    expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
    await terminals.snapshot('codex', '00000000-0000-0000-0000-000000000004')
    installChild.emit('data', 'live output\r\n')
    await vi.waitFor(() =>
      expect(progress.mock.calls.some(([event]) => event.data?.includes('live output'))).toBe(true),
    )
    await writeFile(join(root, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o700 })
    installChild.emit('exit', { exitCode: 0 })
    expect((await updating).output.length).toBeLessThanOrEqual(4096)
    expect(idle).toHaveBeenCalledTimes(2)
    expect(terminals.running).toBe(false)
    expect((await terminals.snapshot('codex'))?.run.status).toBe('succeeded')

    const failed = terminals.run('pi', async (execute) => {
      await execute({ executable: 'pi', args: ['update'], env: {} })
      return { status: { provider: 'pi' }, output: '' }
    })
    const failure = expect(failed).rejects.toThrow('退出码 2')
    installChild.emit('data', 'network failed\r\n')
    installChild.emit('exit', { exitCode: 2 })
    await failure
    expect((await terminals.snapshot('pi'))?.output).toContain('network failed')
    expect(terminals.list().find((run) => run.provider === 'pi')?.status).toBe('failed')
    terminals.write(firstSnapshot.run.id, 'ignored')
    expect(write).toHaveBeenCalledOnce()

    let release!: () => void
    const waiting = terminals.run('claude', async (execute) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await execute({ executable: 'claude', args: ['update'], env: {} })
      return { status: { provider: 'claude' }, output: '' }
    })
    const interrupted = expect(waiting).rejects.toThrow('已中断')
    const closed = terminals.close()
    release()
    await interrupted
    await closed
    expect(terminals.running).toBe(false)
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(2)
    for (const signal of [2, 15]) {
      const signalled = terminals.run('claude', async (execute) => {
        await execute({ executable: 'claude', args: ['update'], env: {} })
        return { status: { provider: 'claude', executable: '/fake/claude' }, output: '' }
      })
      const rejected = expect(signalled).rejects.toThrow(`信号 ${signal}`)
      installChild.emit('exit', { exitCode: 0, signal })
      await rejected
      expect((await terminals.snapshot('claude'))?.run.status).toBe('failed')
    }
  })

  it('distinguishes absent CLIs, permissions and failed updates without falling back to package managers', async () => {
    const { restored, restarted } = await cliManagement()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    mocks.login.mockImplementation((_file: string, args: string[]) => {
      try {
        return Promise.resolve({
          stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
          stderr: '',
        })
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    const idle = vi.fn().mockResolvedValue(undefined)
    const { installChild, terminals } = installTerminal()
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')?.executable).toBe(
      join(root, 'bin', 'codex'),
    )

    const findProgram = shell.findExecutable
    const missingCodex = new shell.ExecutableNotFoundError(
      '找不到 codex。请安装其命令行工具，并检查登录 Shell 的 PATH。',
    )
    const lookup = vi
      .spyOn(shell, 'findExecutable')
      .mockImplementation((command, env) =>
        command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
      )
    const beforeMissing = mocks.ptySpawn.mock.calls.length
    const missing = await terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    expect(missing.status).toEqual({ provider: 'codex' })
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
    })
    expect((await terminals.snapshot('codex'))?.run).toMatchObject({ status: 'not-installed' })
    expect((await terminals.snapshot('codex'))?.run.error).toBeUndefined()
    expect((await terminals.snapshot('codex'))?.output).not.toContain('找不到 codex')
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing)

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
    const permission = new Error('无法执行 codex，请检查文件权限和磁盘状态。')
    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(permission) : findProgram(command, env),
    )
    await expect(
      terminals.run('codex', (execute) =>
        restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
      ),
    ).rejects.toBe(permission)
    expect((await terminals.snapshot('codex'))?.run.error).toContain('文件权限')
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing)

    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
    )
    const absent = await terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    expect(absent.status).toEqual({ provider: 'codex' })
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing)

    lookup.mockImplementation(findProgram)
    const commandFailure = terminals.run('codex', (execute) =>
      restarted.update('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    const failedCommand = expect(commandFailure).rejects.toThrow('退出码 2')
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing + 1))
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
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing + 2))
    await rm(join(root, 'bin', 'codex'))
    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
    )
    installChild.emit('exit', { exitCode: 0 })
    expect((await undetected).status.executable).toBeUndefined()
    expect((await terminals.snapshot('codex'))?.run.status).toBe('not-installed')
    expect((await terminals.snapshot('codex'))?.run.error).toBeUndefined()

    for (const provider of ['pi', 'claude'] as const) {
      const execute = vi.fn((command) => {
        try {
          expect(command.executable).toBe(join(root, 'bin', provider))
          expect(command.args).toEqual(['update'])
          return Promise.resolve({ stdout: 'updated', stderr: '' })
        } catch (cause) {
          return Promise.reject(cause)
        }
      })
      expect(
        (await restarted.update(provider, DEFAULT_CONFIG.preferences, idle, execute)).status
          .executable,
      ).toBe(join(root, 'bin', provider))
      expect(execute).toHaveBeenCalledOnce()
    }
    expect(mocks.ptySpawn.mock.calls.some(([executable]) => executable.endsWith('/npm'))).toBe(
      false,
    )
    lookup.mockRestore()
  })
})
