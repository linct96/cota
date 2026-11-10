import { mocks, options, settings } from './terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TerminalManager } from '../../../src/main/terminal/manager'
import { claimServicePort } from '../../../src/main/terminal/service-port'
import { savedQuickCommands } from '../../../src/main/validation'
import { quickCommandFormSchema } from '../../../src/renderer/src/features/workspace/quick-commands/schemas'

describe('Workspace services', () => {
  it('manages workspace services with scoped definitions, ports, retained logs and safe stop retries', async () => {
    vi.useRealTimers()
    mocks.processes.mockResolvedValue([])
    const send = vi.fn()
    const manager = new TerminalManager(send, vi.fn(), '/tmp/cota-test/agent.sock')
    const definition = {
      id: 'dev',
      name: 'Dev',
      command: 'printf ready; exit 7',
      mode: 'service' as const,
      port: 'auto' as const,
      scope: { type: 'project' as const, projectPath: '/tmp/project' },
    }
    const serviceSettings = { ...settings, quickCommands: [definition] }
    const entry = {
      ...options(),
      service: { commandId: 'dev' },
      startupCommand: 'ignored untrusted text',
    }
    try {
      expect(savedQuickCommands([definition])).toEqual([definition])
      for (const port of [0, 1023, 65536, 3000.5, '3000', null])
        expect(() => savedQuickCommands([{ ...definition, port }])).toThrow('服务端口')
      expect(() => savedQuickCommands([{ ...definition, mode: 'task' }])).toThrow('服务端口')
      for (const port of ['', 'auto', '1024', '65535'])
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
      await manager.create(entry, serviceSettings)
      await manager.create(entry, serviceSettings)
      expect(mocks.spawn).toHaveBeenCalledOnce()
      const session = (await manager.list())[0]
      const port = session.service!.port!
      expect(port).toBeGreaterThanOrEqual(1024)
      expect(mocks.spawn.mock.calls[0][2].env).toMatchObject({
        COTA_SERVICE: '1',
        PORT: String(port),
        COTA_PORT: String(port),
      })
      expect(mocks.prepareShell.mock.calls[0][3]).toBe(definition.command)
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
      const claimed = await claimServicePort('auto')
      try {
        await expect(claimServicePort(claimed.port)).rejects.toThrow('不可用')
      } finally {
        await claimed.release()
      }
      const attached = await manager.attach({ ...entry, attachmentId: randomUUID() })
      expect(attached.service).toEqual(session.service)
      const process = mocks.spawn.mock.results[0].value
      process.listeners.data('service logs\r\n')
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      mocks.stop.mockRejectedValueOnce(new Error('stop denied'))
      await expect(manager.stopService(entry.id)).rejects.toThrow('stop denied')
      expect((await manager.list())[0].exited).toBe(false)
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
      expect((await manager.list())[0]).toMatchObject({
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
      await manager.create(other, {
        ...serviceSettings,
        quickCommands: [{ ...definition, port: undefined }],
      })
      expect((await manager.list()).filter((row) => !row.exited)).toHaveLength(2)
      await expect(manager.stopService(randomUUID())).rejects.toThrow('不存在')
    } finally {
      await manager.shutdown()
    }
  })
})
