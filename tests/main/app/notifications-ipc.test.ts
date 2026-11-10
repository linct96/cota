import { event, mocks, path } from './ipc.fixture'
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { NotificationSound } from '../../../src/shared/notification-sounds'
import type { AgentSession } from '../../../src/shared/contracts'

describe('Desktop notifications and sounds', () => {
  it('notifies only fresh observable Agent transitions and routes clicks to live sessions', async () => {
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
    mocks.sendAgent!({ type: 'disconnected' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    publish({ unread: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-2' })
    publish({ activityState: 'completed', outcome: 'success', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    const click = mocks.notificationClick!
    publish({ unread: false })
    mocks.sendAgent!({ type: 'state', session: { ...state, revision: 1 } })
    expect(mocks.notify).toHaveBeenCalledOnce()
    mocks.contents.send.mockClear()
    mocks.list.mockResolvedValueOnce([])
    click()
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled())
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
    await mocks.handlers.get('agent:visible')!(event, value.id)
    mocks.windowFocused = true
    publish({ activityState: 'working', outcome: 'unknown', lastTurnId: 'turn-3' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    mocks.windowFocused = false
    publish({ unread: false })
    expect(mocks.notify).toHaveBeenCalledOnce()
    publish({ activityState: 'working' })
    publish({ activityState: 'needs-input', unread: true })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    publish({ activityState: 'unknown', observability: 'unavailable' })
    publish({ activityState: 'needs-input', observability: 'full' })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    publish({ activityState: 'failed', outcome: 'failure' })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    publish({ activityState: 'interrupted', outcome: 'cancelled' })
    publish({
      activityState: 'unknown',
      outcome: 'unknown',
      observability: 'unavailable',
      eventSource: 'process',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    mocks.notificationSupported = false
    publish({
      activityState: 'completed',
      outcome: 'unknown',
      lastTurnId: 'turn-4',
      observability: 'partial',
      eventSource: 'codex-hooks',
    })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    mocks.notificationSupported = true
    mocks.notificationFails = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    publish({ activityState: 'working', lastTurnId: 'turn-5' })
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
    warning.mockRestore()
    mocks.notificationFailedEvent = false
    mocks.notify.mockClear()
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
    mocks.notify.mockClear()
    for (const mode of ['never', 'unfocused', 'always'] as const) {
      mocks.config.preferences.turnCompleteNotification = mode
      for (const focused of [false, true]) {
        mocks.windowFocused = focused
        publish({ activityState: 'working', lastTurnId: `${mode}-${focused}` })
        publish({ activityState: 'completed', outcome: 'success' })
        const expected = mode === 'always' || (mode === 'unfocused' && !focused)
        expect(mocks.notify).toHaveBeenCalledTimes(expected ? 1 : 0)
        mocks.notify.mockClear()
        // Preference/focus changes must not replay a consumed completion.
        mocks.config.preferences.turnCompleteNotification = 'always'
        mocks.windowFocused = false
        publish({ unread: false })
        expect(mocks.notify).not.toHaveBeenCalled()
        mocks.config.preferences.turnCompleteNotification = mode
      }
    }
    mocks.config.preferences.turnCompleteNotification = 'always'
    const customSound = { path: '/tmp/提示音 sound.mp3' }
    const source = 'data:audio/mpeg;base64,SUQz'
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
    mocks.notify.mockClear()
    mocks.contents.send.mockClear()
    mocks.config.preferences.notificationsEnabled = false
    publish({ activityState: 'working', lastTurnId: 'always-disabled' })
    publish({ activityState: 'completed' })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
    mocks.sendAgent!({
      type: 'removed',
      terminalId: value.id,
      launchId: launch.launchId,
      revision: state.revision + 1,
    })
    mocks.sendAgent!({ type: 'disconnected' })
  })

  it('validates test notifications, opens system settings and waits for native feedback', async () => {
    mocks.config.preferences.notificationsEnabled = false
    const testNotification = mocks.handlers.get('notifications:test')!
    expect(await testNotification(event)).toMatchObject({ ok: false, error: '请先启用通知。' })
    mocks.config.preferences.notificationsEnabled = true
    expect(await testNotification({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.notificationSupported = false
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '当前系统不支持通知。',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.notificationSupported = true
    mocks.config.preferences.turnCompleteNotification = 'never'
    expect(await testNotification(event)).toMatchObject({ ok: true })
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cota · 测试通知' }))
    const openSettings = mocks.handlers.get('notifications:open-settings')!
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const show = vi.spyOn((await import('electron')).Notification.prototype, 'show')
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
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.useFakeTimers()
      show.mockImplementation(function (this: EventEmitter) {
        setTimeout(() => this.emit('show'), 6000)
      })
      let settled = false
      const delayed = testNotification(event).then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(5000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await delayed).toMatchObject({ ok: true })
      show.mockImplementation(() => {})
      const timedOut = testNotification(event)
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

  it('validates selected sounds and reports native notification failures', async () => {
    const customSound = { path: '/tmp/提示音 sound.mp3' }
    const source = 'data:audio/mpeg;base64,SUQz'
    const testNotification = mocks.handlers.get('notifications:test')!
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
    mocks.notify.mockClear()
    mocks.readSound.mockRejectedValueOnce(new Error('无法读取提示音文件，请重新选择。'))
    expect(await testNotification(event)).toMatchObject({
      ok: false,
      error: '无法读取提示音文件，请重新选择。',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
    for (const sound of ['system', 'none', customSound] satisfies NotificationSound[]) {
      mocks.config.preferences.notificationSound = sound
      mocks.notify.mockClear()
      mocks.contents.send.mockClear()
      expect(await testNotification(event)).toMatchObject({ ok: true })
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ silent: sound !== 'system' }),
      )
      const custom = typeof sound !== 'string'
      await vi.waitFor(() =>
        expect(
          mocks.contents.send.mock.calls.filter(([channel]) => channel === 'notifications:sound'),
        ).toEqual(custom ? [['notifications:sound', source]] : []),
      )
    }
    mocks.contents.send.mockClear()
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
    mocks.notificationError = ''
    expect(
      mocks.contents.send.mock.calls.some(([channel]) => channel === 'notifications:sound'),
    ).toBe(false)
    mocks.notificationFailedEvent = false
    mocks.config.preferences.notificationSound = 'system'
    mocks.config.preferences.turnCompleteNotification = 'unfocused'
  })
})
