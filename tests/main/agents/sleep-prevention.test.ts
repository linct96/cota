import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const instances: AgentSleepPrevention[] = []
let platformDescriptor: PropertyDescriptor

function sleepScenario() {
  const sleep = new AgentSleepPrevention()
  instances.push(sleep)
  const path = '/missing/中文 项目'
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
  let revision = 0
  const update = (change: Partial<AgentSession> = {}) => ({
    type: 'state' as const,
    session: { ...state, ...change, revision: ++revision },
  })
  const removed = (terminalId: string) => ({
    type: 'removed' as const,
    terminalId,
    launchId: state.launchId,
    revision: ++revision,
  })
  return { sleep, state, update, removed }
}

function caffeinate() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn().mockReturnValue(true),
  })
}

beforeEach(() => {
  platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  vi.resetAllMocks()
  mocks.startBlocker.mockReturnValue(17)
  mocks.isBlockerStarted.mockReturnValue(true)
})
afterEach(() => {
  try {
    for (const sleep of instances.splice(0)) sleep.dispose()
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor)
    vi.restoreAllMocks()
  }
})

describe('Agent sleep prevention', () => {
  describe.each(['win32', 'linux'] as const)('%s', (platform) => {
    beforeEach(() => Object.defineProperty(process, 'platform', { value: platform }))

    it('releases the blocker only after the last working Agent stops', () => {
      const { sleep, update, removed } = sleepScenario()
      sleep.receive(update())
      expect(mocks.startBlocker).not.toHaveBeenCalled()
      sleep.setEnabled(true)
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
      sleep.receive(update({ terminalId: 'second' }))
      sleep.receive(update({ activityState: 'completed' }))
      expect(mocks.stopBlocker).not.toHaveBeenCalled()
      sleep.receive(removed('second'))
      expect(mocks.stopBlocker).toHaveBeenLastCalledWith(17)
    })

    it.each([
      ['needs input', { activityState: 'needs-input' }],
      ['completed', { activityState: 'completed' }],
      ['failed', { activityState: 'failed' }],
      ['interrupted', { activityState: 'interrupted' }],
      ['unknown', { activityState: 'unknown' }],
      ['exited', { runtimeState: 'exited' }],
      ['unavailable', { observability: 'unavailable' }],
      ['process-only', { eventSource: 'process' }],
    ] satisfies [string, Partial<AgentSession>][])(
      'does not block sleep for %s',
      (_label, change) => {
        const { sleep, update } = sleepScenario()
        sleep.setEnabled(true)
        sleep.receive(update(change))
        expect(mocks.startBlocker).not.toHaveBeenCalled()
      },
    )

    it('keeps the blocker for a working child even when its parent needs input', () => {
      const { sleep, update } = sleepScenario()
      sleep.setEnabled(true)
      sleep.receive(update({ activityState: 'needs-input', workingChildren: 1 }))
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
      sleep.receive(update({ activityState: 'needs-input', workingChildren: 0 }))
      expect(mocks.stopBlocker).toHaveBeenCalledExactlyOnceWith(17)
    })

    it('handles disabling, stale revisions, a lost blocker and Host disconnect', () => {
      const { sleep, state, update } = sleepScenario()
      sleep.setEnabled(true)
      sleep.receive(update())
      expect(mocks.startBlocker).toHaveBeenCalledOnce()
      sleep.setEnabled(false)
      expect(mocks.stopBlocker).toHaveBeenCalledExactlyOnceWith(17)
      sleep.setEnabled(true)
      expect(mocks.startBlocker).toHaveBeenCalledTimes(2)
      sleep.receive({
        type: 'state',
        session: { ...state, activityState: 'completed', revision: 0 },
      })
      expect(mocks.stopBlocker).toHaveBeenCalledOnce()
      mocks.isBlockerStarted.mockReturnValueOnce(false)
      sleep.refresh()
      expect(mocks.startBlocker).toHaveBeenCalledTimes(3)
      sleep.receive({ type: 'disconnected' })
      expect(mocks.stopBlocker).toHaveBeenCalledTimes(2)
      sleep.receive(update())
      expect(mocks.startBlocker).toHaveBeenCalledTimes(3)
    })
  })

  describe('macOS', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('uses caffeinate and falls back to the Electron blocker if it exits', () => {
      const { sleep, update } = sleepScenario()
      const first = caffeinate()
      mocks.spawn.mockReturnValueOnce(first)
      sleep.setEnabled(true)
      sleep.receive(update())
      first.emit('spawn')
      expect(mocks.spawn).toHaveBeenLastCalledWith(
        '/usr/bin/caffeinate',
        ['-i', '-s', '-w', String(process.pid)],
        { stdio: 'ignore', windowsHide: true, shell: false },
      )
      sleep.receive(update())
      expect(mocks.startBlocker).not.toHaveBeenCalled()
      first.exitCode = 1
      first.emit('exit', 1)
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
    })

    it('recovers from a spawn error and releases a restarted caffeinate process', () => {
      const { sleep, update } = sleepScenario()
      const failed = caffeinate()
      Object.assign(failed, { pid: undefined })
      mocks.spawn.mockReturnValueOnce(failed)
      sleep.setEnabled(true)
      sleep.receive(update())
      failed.emit('error', new Error('ENOENT'))
      expect(mocks.startBlocker).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
      sleep.setEnabled(false)
      const next = caffeinate()
      mocks.spawn.mockReturnValueOnce(next)
      sleep.setEnabled(true)
      expect(mocks.spawn).toHaveBeenCalledTimes(2)
      sleep.dispose()
      expect(next.kill).toHaveBeenCalledOnce()
      next.emit('exit', 0)
      expect(mocks.startBlocker).toHaveBeenCalledOnce()
    })
  })
})
