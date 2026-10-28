import { Notification } from 'electron'
import {
  AGENT_PROVIDERS,
  type AgentSession,
  type AgentUpdate,
  type TurnCompleteNotification,
} from '../../shared/contracts'

export class AgentNotifications {
  private entries = new Map<
    string,
    { session: AgentSession; sent: Set<string>; notification?: Notification }
  >()

  constructor(
    private readonly options: {
      createNotification(options: Electron.NotificationConstructorOptions): Notification
      isEnabled(): boolean
      turnCompleteMode(): TurnCompleteNotification
      isVisible(id: string): boolean
      describe(session: AgentSession): string
      activate(session: AgentSession): Promise<void>
      warn(message: string): void
    },
  ) {}

  receive(event: AgentUpdate): void {
    if (event.type === 'disconnected') {
      for (const entry of this.entries.values()) entry.notification?.close()
      this.entries.clear()
      return
    }
    const id = event.type === 'state' ? event.session.terminalId : event.terminalId
    const previous = this.entries.get(id)
    const revision = event.type === 'state' ? event.session.revision : event.revision
    if (previous && previous.session.revision >= revision) return
    if (event.type === 'removed') {
      previous?.notification?.close()
      this.entries.delete(id)
      return
    }
    const session = event.session
    const sameLaunch = previous?.session.launchId === session.launchId
    const sameTurn = sameLaunch && previous.session.lastTurnId === session.lastTurnId
    const keepNotification =
      sameTurn &&
      previous.session.activityState === session.activityState &&
      previous.session.outcome === session.outcome &&
      session.runtimeState === 'running' &&
      session.observability !== 'unavailable'
    const entry = {
      session,
      sent: sameTurn ? previous.sent : new Set<string>(),
      notification: keepNotification ? previous?.notification : undefined,
    }
    if (!keepNotification) previous?.notification?.close()
    this.entries.set(id, entry)
    if (session.activityState === 'working' || session.activityState === 'idle')
      entry.sent.delete('needs-input')
    if (
      session.runtimeState !== 'running' ||
      session.observability === 'unavailable' ||
      session.eventSource === 'process'
    )
      return
    const label =
      session.activityState === 'needs-input'
        ? '需要操作'
        : session.activityState === 'failed' && session.outcome === 'failure'
          ? '任务失败'
          : session.activityState === 'completed'
            ? session.outcome === 'success'
              ? '已完成'
              : '本轮结束（结果未知）'
            : undefined
    if (!label) return
    const key = `${session.activityState}:${session.outcome}`
    const noticeKey = session.activityState === 'needs-input' ? 'needs-input' : key
    if (entry.sent.has(noticeKey)) return
    // Consume visible transitions too: later read acknowledgements must not notify again.
    entry.sent.add(noticeKey)
    const mode =
      session.activityState === 'completed' ? this.options.turnCompleteMode() : 'unfocused'
    if (
      !this.options.isEnabled() ||
      !sameLaunch ||
      mode === 'never' ||
      (mode !== 'always' && this.options.isVisible(id)) ||
      !Notification.isSupported()
    )
      return
    try {
      const notification = this.options.createNotification({
        title: `${AGENT_PROVIDERS[session.provider].name} · ${label}`,
        body: `${this.options.describe(session)}\n${session.activityState === 'needs-input' ? '请在原生终端中处理授权或问题。' : '点击返回对应终端查看。'}`,
      })
      entry.notification = notification
      notification.on('click', () => {
        if (this.entries.get(id)?.session.launchId !== session.launchId) return
        void this.options
          .activate(session)
          .catch(() => this.options.warn('无法定位 Agent 通知目标。'))
      })
      notification.on('failed', () =>
        this.options.warn('系统未能显示 Agent 通知；请检查通知权限。'),
      )
      notification.show()
    } catch {
      this.options.warn('Agent 系统通知不可用；终端状态与未读提醒不受影响。')
    }
  }
}
