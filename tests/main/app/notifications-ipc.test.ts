import { event, mocks, path } from './ipc.fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { NotificationSound } from '../../../src/shared/notification-sounds'
import type { AgentSession } from '../../../src/shared/contracts'

const customSound = { path: '/tmp/提示音 sound.mp3' }
const source = 'data:audio/mpeg;base64,SUQz'

function notificationSession() {
  mocks.config.recentProjects = [path]
  const value = {
    id: randomUUID(),
    projectPath: path,
    workspaceId: randomUUID(),
    cols: 80,
    rows: 24,
    cwd: '/forged',
    workspaceKind: 'git-worktree',
    worktreeId: randomUUID(),
    repoCommonDir: '/forged/.git',
  }
  const launch = { kind: 'agent', provider: 'codex', launchId: randomUUID() }
  const state: AgentSession = {
    terminalId: value.id,
    launchId: launch.launchId,
    provider: 'pi',
    projectPath: path,
    workspaceId: value.workspaceId,
    cwd: path,
    runtimeState: 'running',
    activityState: 'working',
    outcome: 'unknown',
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
    lastTurnId: 'turn-1',
    eventSource: 'pi-extension',
    observability: 'full',
    revision: 1,
    unread: false,
  }
  const publish = (change: Partial<AgentSession>) => {
    Object.assign(state, change, { revision: state.revision + 1 })
    mocks.sendAgent!({ type: 'state', session: { ...state } })
  }
  return { value, launch, state, publish }
}

beforeEach(async () => {
  mocks.sendAgent!({ type: 'disconnected' })
  mocks.notificationClick = undefined
  mocks.chooseFile.mockReset()
  await mocks.handlers.get('agent:visible')!(event, undefined)
  mocks.contents.send.mockClear()
})
afterEach(() => mocks.sendAgent!({ type: 'disconnected' }))

describe('Desktop notifications and sounds', () => {
  it('notifies only fresh transitions and ignores stale revisions', () => {
    const { state, publish } = notificationSession()
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-2' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    publish({ unread: false })
    mocks.sendAgent!({ type: 'state', session: { ...state, revision: 1 } })
    expect(mocks.notify).toHaveBeenCalledOnce()
  })

  it('routes notification clicks only to live sessions', async () => {
    const { value, launch, state, publish } = notificationSession()
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-2' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    const click = mocks.notificationClick!
    publish({ unread: false })
    mocks.contents.send.mockClear()
    mocks.list.mockResolvedValueOnce([])
    click()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
    expect(mocks.contents.send).not.toHaveBeenCalledWith('agent:focus', expect.anything())
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.list.mockResolvedValueOnce([{ id: value.id, agent: { ...state } }])
    click()
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith('agent:focus', {
        terminalId: value.id,
        launchId: launch.launchId,
      }),
    )
    mocks.sendAgent!({
      type: 'removed',
      terminalId: value.id,
      launchId: launch.launchId,
      revision: state.revision + 1,
    })
    mocks.list.mockClear()
    click()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('consumes visible input requests and suppresses unobservable or unsupported states', async () => {
    const { value, publish } = notificationSession()
    await mocks.handlers.get('agent:visible')!(event, value.id)
    mocks.windowFocused = true
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-3' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.windowFocused = false
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    publish({ activityState: 'unknown', observability: 'unavailable' })
    publish({ activityState: 'needs-input', observability: 'full' })
    expect(mocks.notify).toHaveBeenCalledOnce()
    publish({ activityState: 'failed', outcome: 'failure' })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    publish({ activityState: 'interrupted', outcome: 'cancelled' })
    publish({
      activityState: 'unknown',
      outcome: 'unknown',
      observability: 'unavailable',
      eventSource: 'process',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    mocks.notificationSupported = false
    publish({
      activityState: 'completed',
      outcome: 'unknown',
      lastTurnId: 'turn-4',
      observability: 'partial',
      eventSource: 'codex-hooks',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })

  it('warns when Agent notifications throw or report a native failure', async () => {
    const { publish } = notificationSession()
    await mocks.handlers.get('app:bootstrap')!(event)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mocks.notificationFails = true
      publish({
        activityState: 'working',
        lastTurnId: 'turn-5',
        observability: 'partial',
        eventSource: 'codex-hooks',
      })
      expect(() => publish({ activityState: 'completed' })).not.toThrow()
      expect(warning).toHaveBeenCalledOnce()
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:warning',
        'Agent 系统通知不可用；终端状态与未读提醒不受影响。',
      )
      mocks.notificationFails = false
      mocks.notificationFailedEvent = true
      publish({ activityState: 'working', lastTurnId: 'turn-permission-denied' })
      publish({ activityState: 'completed' })
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:warning',
        '系统未能显示 Agent 通知；请检查通知权限。',
      )
    } finally {
      warning.mockRestore()
    }
  })

  it('does not replay a completion consumed while notifications were disabled', () => {
    const { publish } = notificationSession()
    mocks.config.preferences.notificationsEnabled = false
    publish({ activityState: 'working', lastTurnId: 'turn-6' })
    publish({ activityState: 'completed', outcome: 'success' })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.config.preferences.notificationsEnabled = true
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working', lastTurnId: 'turn-7' })
    publish({ activityState: 'completed', outcome: 'success' })
    expect(mocks.notify).toHaveBeenCalledOnce()
  })

  it.each([
    ['never', false, false],
    ['never', true, false],
    ['unfocused', false, true],
    ['unfocused', true, false],
    ['always', false, true],
    ['always', true, true],
  ] as const)(
    'applies completion mode %s with window focused=%s without replay',
    async (mode, focused, expected) => {
      const { value, publish } = notificationSession()
      await mocks.handlers.get('agent:visible')!(event, value.id)
      mocks.config.preferences.turnCompleteNotification = mode
      mocks.windowFocused = focused
      publish({ activityState: 'working', lastTurnId: `${mode}-${focused}` })
      publish({ activityState: 'completed', outcome: 'success' })
      expect(mocks.notify).toHaveBeenCalledTimes(expected ? 1 : 0)
      mocks.notify.mockClear()
      mocks.config.preferences.turnCompleteNotification = 'always'
      mocks.windowFocused = false
      publish({ unread: false })
      expect(mocks.notify).not.toHaveBeenCalled()
    },
  )

  it('plays a custom sound for an Agent notification', async () => {
    const { publish } = notificationSession()
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.config.preferences.turnCompleteNotification = 'always'
    mocks.config.preferences.notificationSound = customSound
    mocks.contents.send.mockClear()
    publish({ activityState: 'working', lastTurnId: 'custom-sound' })
    publish({ activityState: 'completed' })
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ silent: true }))
    await vi.waitFor(() =>
      expect(
        mocks.contents.send.mock.calls.filter(([channel]) => channel === 'notifications:sound'),
      ).toEqual([['notifications:sound', source]]),
    )
  })

  it('does not notify or play a custom sound while notifications are disabled', () => {
    const { publish } = notificationSession()
    mocks.config.preferences.turnCompleteNotification = 'always'
    mocks.config.preferences.notificationSound = customSound
    mocks.config.preferences.notificationsEnabled = false
    publish({ activityState: 'working', lastTurnId: 'always-disabled' })
    publish({ activityState: 'completed' })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
  })

  it.each(['disabled', 'untrusted', 'unsupported'] as const)(
    'rejects a test notification when %s',
    async (reason) => {
      if (reason === 'disabled') mocks.config.preferences.notificationsEnabled = false
      if (reason === 'unsupported') mocks.notificationSupported = false
      const sender = reason === 'untrusted' ? { ...event, senderFrame: {} } : event
      const result = await mocks.handlers.get('notifications:test')!(sender)
      expect(result).toMatchObject({ ok: false })
      if (reason === 'disabled') expect(result).toMatchObject({ error: '请先启用通知。' })
      if (reason === 'unsupported') expect(result).toMatchObject({ error: '当前系统不支持通知。' })
      expect(mocks.notify).not.toHaveBeenCalled()
    },
  )

  it('sends a test notification even when completion notifications are disabled', async () => {
    mocks.config.preferences.turnCompleteNotification = 'never'
    expect(await mocks.handlers.get('notifications:test')!(event)).toMatchObject({ ok: true })
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cota 通知已开启' }))
  })

  it('opens system notification settings only for a trusted macOS renderer', async () => {
    const openSettings = mocks.handlers.get('notifications:open-settings')!
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      expect(await openSettings({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(await openSettings(event)).toMatchObject({ ok: true })
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
        'x-apple.systempreferences:com.apple.preference.notifications',
      )
      mocks.openExternal.mockRejectedValueOnce(new Error('无法打开系统设置'))
      expect(await openSettings(event)).toMatchObject({ ok: false, error: '无法打开系统设置' })
      Object.defineProperty(process, 'platform', { value: 'win32' })
      expect(await openSettings(event)).toMatchObject({ ok: false })
      expect(mocks.openExternal).toHaveBeenCalledTimes(2)
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('waits for delayed native show feedback on macOS', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const show = vi.spyOn((await import('electron')).Notification.prototype, 'show')
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.useFakeTimers()
      show.mockImplementation(function (this: EventEmitter) {
        setTimeout(() => this.emit('show'), 6000)
      })
      let settled = false
      const delayed = mocks.handlers.get('notifications:test')!(event).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(5000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await delayed).toMatchObject({ ok: true })
    } finally {
      show.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('reports a timeout when macOS does not confirm a notification', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const show = vi.spyOn((await import('electron')).Notification.prototype, 'show')
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.useFakeTimers()
      show.mockImplementation(() => {})
      const timedOut = mocks.handlers.get('notifications:test')!(event)
      await vi.advanceTimersByTimeAsync(30000)
      expect(await timedOut).toMatchObject({
        ok: false,
        error: expect.stringContaining('若系统正在询问通知权限，请完成授权后重试'),
      })
    } finally {
      show.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('validates selected sounds and trusted senders', async () => {
    const chooseSound = mocks.handlers.get('notifications:choose-sound')!
    mocks.chooseFile.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await chooseSound(event)).toEqual({ ok: true, value: null })
    expect(await chooseSound({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.chooseFile).toHaveBeenCalledOnce()
    mocks.chooseFile.mockResolvedValue({ canceled: false, filePaths: [customSound.path] })
    expect(await chooseSound(event)).toEqual({ ok: true, value: customSound })
    mocks.readSound.mockRejectedValueOnce(new Error('无法读取提示音文件，请重新选择。'))
    expect(await chooseSound(event)).toMatchObject({
      ok: false,
      error: '无法读取提示音文件，请重新选择。',
    })
  })

  it('reports a sound read failure before showing a test notification', async () => {
    mocks.readSound.mockRejectedValueOnce(new Error('无法读取提示音文件，请重新选择。'))
    expect(await mocks.handlers.get('notifications:test')!(event)).toMatchObject({
      ok: false,
      error: '无法读取提示音文件，请重新选择。',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it.each([
    ['system', 'system'],
    ['none', 'none'],
    ['custom', customSound],
  ] satisfies [string, NotificationSound][])(
    'uses the %s sound for a test notification',
    async (_label, sound) => {
      await mocks.handlers.get('app:bootstrap')!(event)
      mocks.config.preferences.notificationSound = sound
      mocks.contents.send.mockClear()
      expect(await mocks.handlers.get('notifications:test')!(event)).toMatchObject({ ok: true })
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ silent: sound !== 'system' }),
      )
      const custom = typeof sound !== 'string'
      await vi.waitFor(() =>
        expect(
          mocks.contents.send.mock.calls.filter(([channel]) => channel === 'notifications:sound'),
        ).toEqual(custom ? [['notifications:sound', source]] : []),
      )
    },
  )

  it('reports native notification failures without playing the custom sound', async () => {
    const testNotification = mocks.handlers.get('notifications:test')!
    mocks.config.preferences.notificationSound = customSound
    mocks.notificationFails = true
    expect(await testNotification(event)).toMatchObject({ ok: false, error: 'unavailable' })
    mocks.notificationFails = false
    mocks.notificationFailedEvent = true
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '通知发送失败，请检查系统通知设置。',
    })
    mocks.notificationError = 'Notifications are not allowed for this application'
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '通知发送失败：Notifications are not allowed for this application',
    })
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
  })
})
