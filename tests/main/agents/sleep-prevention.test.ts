import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AgentSleepPrevention } from '../../../src/main/agents/runtime/sleep-prevention'
import type { AgentSession } from '../../../src/shared/contracts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  startBlocker: vi.fn(),
  stopBlocker: vi.fn(),
  isBlockerStarted: vi.fn(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<object>()),
  spawn: mocks.spawn,
}))
vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: mocks.startBlocker,
    stop: mocks.stopBlocker,
    isStarted: mocks.isBlockerStarted,
  },
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.startBlocker.mockReturnValue(17)
  mocks.isBlockerStarted.mockReturnValue(true)
})
const path = '/missing/中文 项目'
describe('Agent sleep prevention', () => {
  it('prevents sleep only for observed working agents and releases all platform resources', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let sleep = new AgentSleepPrevention()
    let revision = 0
    const state: AgentSession = {
      terminalId: randomUUID(),
      launchId: randomUUID(),
      provider: 'claude',
      projectPath: path,
      workspaceId: randomUUID(),
      cwd: path,
      runtimeState: 'running',
      activityState: 'working',
      outcome: 'unknown',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventSource: 'claude-hooks',
      observability: 'partial',
      revision: 0,
      unread: false,
    }
    const publish = (change: Partial<AgentSession> = {}) => {
      sleep.receive({ type: 'state', session: { ...state, ...change, revision: ++revision } })
    }
    try {
      for (const value of ['win32', 'linux']) {
        Object.defineProperty(process, 'platform', { value })
        mocks.startBlocker.mockClear()
        mocks.stopBlocker.mockClear()
        sleep = new AgentSleepPrevention()
        publish()
        expect(mocks.startBlocker).not.toHaveBeenCalled()
        sleep.setEnabled(true)
        expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
        publish({ terminalId: 'second' })
        publish({ activityState: 'completed' })
        expect(mocks.stopBlocker).not.toHaveBeenCalled()
        sleep.receive({
          type: 'removed',
          terminalId: 'second',
          launchId: state.launchId,
          revision: ++revision,
        })
        expect(mocks.stopBlocker).toHaveBeenLastCalledWith(17)
        const starts = mocks.startBlocker.mock.calls.length
        for (const activityState of [
          'needs-input',
          'completed',
          'failed',
          'interrupted',
          'unknown',
        ] as const)
          publish({ activityState })
        publish({ runtimeState: 'exited' })
        publish({ observability: 'unavailable' })
        publish({ eventSource: 'process' })
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts)
        publish({ activityState: 'needs-input', workingChildren: 1 })
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 1)
        publish({ activityState: 'needs-input', workingChildren: 0 })
        publish()
        sleep.setEnabled(false)
        expect(mocks.stopBlocker).toHaveBeenCalledTimes(3)
        sleep.setEnabled(true)
        sleep.receive({
          type: 'state',
          session: { ...state, activityState: 'completed', revision: 0 },
        })
        expect(mocks.stopBlocker).toHaveBeenCalledTimes(3)
        mocks.isBlockerStarted.mockReturnValueOnce(false)
        sleep.refresh()
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 4)
        sleep.receive({ type: 'disconnected' })
        publish()
        expect(mocks.startBlocker).toHaveBeenCalledTimes(starts + 4)
        sleep.dispose()
      }
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const child = () =>
        Object.assign(new EventEmitter(), {
          pid: 12345,
          exitCode: null as number | null,
          signalCode: null,
          kill: vi.fn().mockReturnValue(true),
        })
      const first = child()
      mocks.spawn.mockReturnValueOnce(first)
      mocks.startBlocker.mockClear()
      sleep = new AgentSleepPrevention()
      sleep.setEnabled(true)
      publish()
      first.emit('spawn')
      expect(mocks.spawn).toHaveBeenLastCalledWith(
        '/usr/bin/caffeinate',
        ['-i', '-s', '-w', String(process.pid)],
        {
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        },
      )
      publish()
      expect(mocks.startBlocker).not.toHaveBeenCalled()
      first.exitCode = 1
      first.emit('exit', 1)
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
      sleep.dispose()
      const failed = child()
      Object.assign(failed, { pid: undefined })
      mocks.spawn.mockReturnValueOnce(failed)
      sleep = new AgentSleepPrevention()
      sleep.setEnabled(true)
      publish()
      failed.emit('error', new Error('ENOENT'))
      expect(mocks.startBlocker).toHaveBeenCalledTimes(2)
      sleep.setEnabled(false)
      const next = child()
      mocks.spawn.mockReturnValueOnce(next)
      sleep.setEnabled(true)
      expect(mocks.spawn).toHaveBeenCalledTimes(3)
      sleep.dispose()
      expect(next.kill).toHaveBeenCalledOnce()
      next.emit('exit', 0)
      expect(mocks.startBlocker).toHaveBeenCalledTimes(2)
    } finally {
      sleep.dispose()
      Object.defineProperty(process, 'platform', platform)
      warning.mockRestore()
    }
  })
})
