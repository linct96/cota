import { mocks, options, settings } from './terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TerminalManager } from '../../../src/main/terminal/manager'

describe('Shell execution markers', () => {
  it('tracks shell execution from root-shell markers across chunks and attachments', async () => {
    vi.useRealTimers()
    mocks.processes.mockResolvedValue([])
    const send = vi.fn()
    const manager = new TerminalManager(send, vi.fn(), '/tmp/cota-test/agent.sock')
    const entry = options()
    const attachmentId = randomUUID()
    try {
      await manager.create(entry, settings)
      const process = mocks.spawn.mock.results[0].value
      const token = mocks.spawn.mock.calls[0][2].env.COTA_SHELL_ACTIVITY
      expect(token).toMatch(/^[a-f0-9]{64}$/)
      const marker = (state: string, pid = process.pid, value = token) =>
        `\u001b]133;${state};Cota=${value};Shell=${pid}\u0007`
      const drain = () => manager.attach({ ...entry, attachmentId })
      expect((await drain()).shellActivity).toBe('unknown')
      process.listeners.data(marker('D'))
      expect((await drain()).shellActivity).toBe('idle')
      const start = marker('C')
      process.listeners.data(start.slice(0, 20))
      expect((await drain()).shellActivity).toBe('idle')
      process.listeners.data(start.slice(20))
      expect((await drain()).shellActivity).toBe('running')
      expect((await manager.list())[0].shellActivity).toBe('running')
      const events = () =>
        send.mock.calls.map(([event]) => event).filter((event) => event.type === 'activity')
      expect(events().map((event) => event.activity)).toEqual(['idle', 'running'])
      process.listeners.data(
        marker('C') +
          marker('D', process.pid + 1) +
          marker('D', process.pid, '0'.repeat(64)) +
          '\u001b]133;D\u0007',
      )
      expect((await drain()).shellActivity).toBe('running')
      expect(events()).toHaveLength(2)
      manager.detach(entry.id, attachmentId)
      process.listeners.data(marker('D'))
      expect((await drain()).shellActivity).toBe('idle')
      expect(events()).toHaveLength(2)
      process.listeners.exit({ exitCode: 0 })
      expect(await drain()).toMatchObject({ exited: true, shellActivity: 'unknown' })
    } finally {
      await manager.shutdown()
    }
  })
})
