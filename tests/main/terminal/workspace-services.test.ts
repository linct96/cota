import { mocks, options, settings } from './terminal.fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerminalManager } from '../../../src/main/terminal/manager'
import { claimServicePort } from '../../../src/main/terminal/service-port'
import { savedQuickCommands, startupCommand } from '../../../src/main/validation'
import { quickCommandFormSchema } from '../../../src/renderer/src/features/workspace/quick-commands/schemas'

const definition = {
  id: 'dev',
  name: 'Dev',
  command: 'printf ready; exit 7',
  mode: 'service' as const,
  port: 'auto' as const,
  scope: { type: 'project' as const, projectPath: '/tmp/project' },
}
const taskDefinition = {
  id: 'dev',
  name: ' 开发服务 ',
  command: `printf '%s\\n' "$COTA_TEST_PROFILE" '${'中文'.repeat(200)} ; $(touch nope)' >> 'startup output'\nprintf '%s\\n' done >> 'startup output'`,
  scope: { type: 'project' as const, projectPath: join(tmpdir(), 'cota 中文 ; quick') },
}

const serviceSettings = { ...settings, quickCommands: [definition] }
const managers: TerminalManager[] = []

function serviceFixture() {
  vi.useRealTimers()
  mocks.processes.mockResolvedValue([])
  const send = vi.fn()
  const manager = new TerminalManager(send, vi.fn(), '/tmp/cota-test/agent.sock')
  managers.push(manager)
  const entry = {
    ...options(),
    service: { commandId: 'dev' },
    startupCommand: 'ignored untrusted text',
  }
  return { manager, entry, send }
}

afterEach(async () => {
  mocks.stop.mockReset().mockResolvedValue(undefined)
  for (const manager of managers.splice(0)) await manager.shutdown()
})

describe('Workspace services', () => {
  it('normalizes saved quick commands and startup line endings', () => {
    expect(savedQuickCommands([])).toEqual([])
    expect(savedQuickCommands([taskDefinition])[0].name).toBe('开发服务')
    expect(startupCommand('echo one\r\necho two\r')).toBe('echo one\necho two\n')
  })

  it.each([
    ['missing', undefined],
    ['duplicate', [taskDefinition, taskDefinition]],
    ['invalid ID', [{ ...taskDefinition, id: '../bad' }]],
    ['control characters', [{ ...taskDefinition, command: '\u001b[31m' }]],
    ['blank command', [{ ...taskDefinition, command: ' ' }]],
    ['overlong command', [{ ...taskDefinition, command: 'a'.repeat(8193) }]],
    [
      'relative project',
      [{ ...taskDefinition, scope: { type: 'project', projectPath: 'relative' } }],
    ],
  ])('rejects %s in saved quick commands', (_label, invalid) => {
    expect(() => savedQuickCommands(invalid)).toThrow()
  })

  it('accepts a saved service definition', () => {
    expect(savedQuickCommands([definition])).toEqual([definition])
  })

  it.each([0, 1023, 65536, 3000.5, '3000', null])('rejects saved port %s', (port) => {
    expect(() => savedQuickCommands([{ ...definition, port }])).toThrow('服务端口')
  })

  it('rejects a task with a service port', () => {
    expect(() => savedQuickCommands([{ ...definition, mode: 'task' }])).toThrow('服务端口')
  })

  it.each(['', 'auto', '1024', '65535'])('accepts form port %s', (port) => {
    expect(
      quickCommandFormSchema.safeParse({
        name: 'dev',
        command: 'run',
        mode: 'service',
        port,
        scope: 'global',
        projectPath: '',
      }).success,
    ).toBe(true)
  })

  it('rejects an out-of-range form port', () => {
    expect(
      quickCommandFormSchema.safeParse({
        name: 'dev',
        command: 'run',
        mode: 'service',
        port: '65536',
        scope: 'global',
        projectPath: '',
      }).success,
    ).toBe(false)
  })

  it('prevents another process from claiming a reserved port', async () => {
    vi.useRealTimers()
    const claimed = await claimServicePort('auto')
    try {
      await expect(claimServicePort(claimed.port)).rejects.toThrow('不可用')
    } finally {
      await claimed.release()
    }
  })

  it('starts one scoped service with its assigned port and trusted command', async () => {
    const { manager, entry } = serviceFixture()
    await manager.create(entry, serviceSettings)
    await manager.create(entry, serviceSettings)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    const session = (await manager.list()).find((item) => item.id === entry.id)!
    const port = session.service!.port!
    expect(port).toBeGreaterThanOrEqual(1024)
    expect(mocks.spawn.mock.calls.at(-1)![2].env).toMatchObject({
      COTA_SERVICE: '1',
      PORT: String(port),
      COTA_PORT: String(port),
    })
    expect(mocks.prepareShell.mock.calls.at(-1)![3]).toBe(definition.command)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    await expect(manager.create({ ...entry, id: randomUUID() }, serviceSettings)).rejects.toThrow(
      '已在当前工作区运行',
    )
    await expect(
      manager.create(
        { ...entry, id: randomUUID(), projectPath: '/tmp/other', cwd: '/tmp/other' },
        serviceSettings,
      ),
    ).rejects.toThrow('不属于当前项目')
    const other = { ...entry, id: randomUUID(), workspaceId: randomUUID() }
    await expect(
      manager.create(other, { ...serviceSettings, quickCommands: [{ ...definition, port }] }),
    ).rejects.toThrow('其他服务使用')
    expect((await manager.attach({ ...entry, attachmentId: randomUUID() })).service).toEqual(
      session.service,
    )
  })

  it('retains logs after a failed stop, coalesces retries and allows service restart', async () => {
    const { manager, entry, send } = serviceFixture()
    await manager.create(entry, serviceSettings)
    const session = (await manager.list()).find((item) => item.id === entry.id)!
    const port = session.service!.port!
    await manager.attach({ ...entry, attachmentId: randomUUID() })
    const process = mocks.spawn.mock.results.at(-1)!.value
    process.listeners.data('service logs\r\n')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    mocks.stop.mockRejectedValueOnce(new Error('stop denied'))
    await expect(manager.stopService(entry.id)).rejects.toThrow('stop denied')
    expect((await manager.list()).find((item) => item.id === entry.id)?.exited).toBe(false)
    mocks.stop.mockImplementationOnce(() => {
      try {
        return Promise.resolve(process.listeners.exit({ exitCode: 143 }))
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    await Promise.all([manager.stopService(entry.id), manager.stopService(entry.id)])
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(mocks.stop).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.filter(([event]) => event.type === 'exit')).toHaveLength(1)
    expect((await manager.list()).find((item) => item.id === entry.id)).toMatchObject({
      exited: true,
      exitCode: 143,
      service: { port },
    })
    expect((await manager.attach({ ...entry, attachmentId: randomUUID() })).snapshot).toContain(
      'service logs',
    )
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    await manager.create(
      { ...entry, id: randomUUID() },
      { ...serviceSettings, quickCommands: [{ ...definition, port }] },
    )
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    const other = { ...entry, id: randomUUID(), workspaceId: randomUUID() }
    await manager.create(other, {
      ...serviceSettings,
      quickCommands: [{ ...definition, port: undefined }],
    })
    expect((await manager.list()).filter((row) => !row.exited)).toHaveLength(2)
    await expect(manager.stopService(randomUUID())).rejects.toThrow('不存在')
  })
})
