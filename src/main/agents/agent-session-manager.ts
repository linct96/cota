import { randomBytes, timingSafeEqual } from 'node:crypto'
import type {
  AgentActivity,
  AgentLifecycleEvent,
  AgentOutcome,
  AgentProvider,
  AgentSession,
  AgentUpdate,
  TerminalBinding,
} from '../../shared/contracts'

interface Activity {
  activity: AgentActivity
  outcome: AgentOutcome
  final: boolean
  timestamp: number
  stale: boolean
  waits: Set<string>
  resolved: Set<string>
}
interface Entry {
  state: AgentSession
  token?: string
  source?: AgentSession['eventSource']
  capability?: AgentSession['observability']
  channel?: object
  events: Set<string>
  turns: Set<string>
  main: Activity
  children: Map<string, Activity>
  background?: { otherCount: number; timestamp: number; stale: boolean }
  rateStart: number
  rate: number
}
const types = new Set([
  'session-started',
  'turn-started',
  'turn-active',
  'attention-required',
  'turn-ended',
  'turn-completed',
  'turn-failed',
  'turn-interrupted',
  'activity-unknown',
  'integration-unavailable',
  'session-ended',
])
const keys = new Set([
  'token',
  'terminalId',
  'launchId',
  'provider',
  'eventId',
  'timestamp',
  'type',
  'turnId',
  'agentId',
  'requestId',
  'toolName',
  'requestDone',
  'waitingFor',
  'backgroundTasks',
])
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
const activity = (): Activity => ({
  activity: 'unknown',
  outcome: 'unknown',
  final: false,
  timestamp: 0,
  stale: false,
  waits: new Set(),
  resolved: new Set(),
})

export function validLifecycleEvent(event: AgentLifecycleEvent): boolean {
  const background = event.backgroundTasks
  return (
    !!event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    !Object.keys(event).some((key) => !keys.has(key)) &&
    types.has(event.type) &&
    identifier(event.eventId) &&
    (['turnId', 'agentId', 'requestId', 'toolName'] as const).every(
      (key) => event[key] === undefined || identifier(event[key]),
    ) &&
    (event.requestDone === undefined || typeof event.requestDone === 'boolean') &&
    (event.waitingFor === undefined || ['permission', 'question'].includes(event.waitingFor)) &&
    (background === undefined ||
      (event.provider === 'claude' &&
        event.agentId === undefined &&
        ['turn-ended', 'turn-failed'].includes(event.type) &&
        !!background &&
        typeof background === 'object' &&
        !Object.keys(background).some((key) => !['agentIds', 'otherCount'].includes(key)) &&
        Array.isArray(background.agentIds) &&
        background.agentIds.length <= 256 &&
        background.agentIds.every(identifier) &&
        new Set(background.agentIds).size === background.agentIds.length &&
        Number.isSafeInteger(background.otherCount) &&
        background.otherCount >= 0 &&
        background.otherCount + background.agentIds.length <= 256)) &&
    Number.isSafeInteger(event.timestamp) &&
    Math.abs(Date.now() - event.timestamp) <= 30_000
  )
}

export class AgentSessionManager {
  private entries = new Map<string, Entry>()
  constructor(private readonly send: (event: AgentUpdate) => void) {}

  create(
    terminalId: string,
    launchId: string,
    provider: AgentProvider,
    binding: TerminalBinding,
    revision = 0,
  ): AgentSession {
    const now = new Date().toISOString()
    const state: AgentSession = {
      terminalId,
      launchId,
      provider,
      projectPath: binding.projectPath,
      workspaceId: binding.workspaceId,
      cwd: binding.cwd,
      runtimeState: 'starting',
      activityState: 'unknown',
      outcome: 'unknown',
      startedAt: now,
      lastEventAt: now,
      eventSource: 'process',
      observability: 'unavailable',
      revision,
      unread: false,
      observabilityReason: '等待已安装的 Hooks / Extension 上报；未安装时任务状态为未知。',
    }
    this.entries.set(terminalId, {
      state,
      events: new Set(),
      turns: new Set(),
      main: activity(),
      children: new Map(),
      rateStart: 0,
      rate: 0,
    })
    this.publish(state)
    return state
  }

  enable(id: string, source: AgentSession['eventSource'], capability: 'full' | 'partial'): string {
    const entry = this.entries.get(id)!
    entry.token = randomBytes(32).toString('hex')
    entry.source = source
    entry.capability = capability
    entry.state.observabilityReason = '等待适配组件连接；未连接时仅展示进程状态。'
    this.publish(entry.state)
    return entry.token
  }

  unavailable(id: string, reason: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.token = undefined
    entry.channel = undefined
    Object.assign(entry.state, {
      activityState: 'unknown',
      outcome: 'unknown',
      workingChildren: 0,
      waitingChildren: 0,
      observability: 'unavailable',
      eventSource: 'process',
      unread: false,
      observabilityReason: reason,
    })
    this.publish(entry.state)
  }

  disable(): void {
    for (const id of this.entries.keys()) this.unavailable(id, '状态接收已停止，请新建终端恢复。')
  }

  runtime(id: string, runtimeState: AgentSession['runtimeState'], exitCode?: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.state.runtimeState = runtimeState
    if (exitCode !== undefined) entry.state.exitCode = exitCode
    if (runtimeState === 'stopping' || runtimeState === 'exited' || runtimeState === 'error') {
      entry.token = undefined
      entry.channel = undefined
      Object.assign(entry.state, {
        activityState: 'unknown',
        outcome: 'unknown',
        unread: false,
        workingChildren: 0,
        waitingChildren: 0,
        observability: 'unavailable',
      })
    }
    this.publish(entry.state)
  }

  remove(id: string): number {
    const state = this.entries.get(id)?.state
    this.entries.delete(id)
    if (!state) return 0
    this.send({
      type: 'removed',
      terminalId: id,
      launchId: state.launchId,
      revision: ++state.revision,
    })
    return state.revision
  }

  uncertain(id: string): void {
    const state = this.entries.get(id)?.state
    if (!state || state.observability === 'unavailable') return
    Object.assign(state, {
      activityState: 'unknown',
      outcome: 'unknown',
      observability: 'unavailable',
      unread: false,
      observabilityReason: '无法确认 Agent 的前台进程状态。',
    })
    this.publish(state)
  }

  read(id: string, launchId: string, revision: number): void {
    const state = this.entries.get(id)?.state
    if (!state || state.launchId !== launchId || state.revision !== revision || !state.unread)
      return
    state.unread = false
    this.publish(state, false)
  }

  disconnect(channel: object): void {
    for (const [id, entry] of this.entries) {
      if (entry.channel === channel)
        this.unavailable(id, '适配组件连接已断开；无法确认当前任务状态。')
    }
  }

  receive(value: unknown, channel: object): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const event = value as AgentLifecycleEvent
    const entry = this.entries.get(event.terminalId)
    if (
      !entry?.token ||
      typeof event.token !== 'string' ||
      Buffer.byteLength(event.token) !== 64 ||
      !timingSafeEqual(Buffer.from(entry.token), Buffer.from(event.token))
    )
      return false
    const state = entry.state
    const background = event.backgroundTasks
    if (
      event.launchId !== state.launchId ||
      event.provider !== state.provider ||
      !['starting', 'running'].includes(state.runtimeState)
    )
      return false
    if (!validLifecycleEvent(event)) return false
    const now = Date.now()
    if (now - entry.rateStart >= 1000) {
      entry.rateStart = now
      entry.rate = 0
    }
    if (++entry.rate > 100) return false
    if (entry.source === 'pi-extension') {
      if (event.agentId) return false
      if (event.type === 'session-started' && !entry.channel) entry.channel = channel
      if (entry.channel !== channel) return false
    }
    if (entry.events.has(event.eventId)) return true
    entry.events.add(event.eventId)
    if (entry.events.size > 256) entry.events.delete(entry.events.values().next().value!)
    if (event.type === 'integration-unavailable' || event.type === 'session-ended') {
      this.unavailable(
        state.terminalId,
        event.type === 'session-ended'
          ? '原生会话已结束，等待进程退出。'
          : '原生事件缺少可信标识或超出适配范围；已停用本次状态集成。',
      )
      return true
    }
    if (event.agentId && !entry.children.has(event.agentId)) {
      if (event.type !== 'turn-started' || !state.lastTurnId) return true
      if (entry.children.size >= 256) {
        this.unavailable(state.terminalId, '子任务过多，请新建 Agent 以恢复状态集成。')
        return true
      }
      entry.children.set(event.agentId, activity())
    }
    const actor = event.agentId ? entry.children.get(event.agentId)! : entry.main
    if (event.timestamp < actor.timestamp) return true
    if (event.agentId && event.type === 'turn-started') {
      // Repeated starts cannot dismiss a live wait; a finished or stale actor can run again under the same ID.
      if (!actor.stale && (actor.activity === 'working' || actor.waits.size)) return true
      Object.assign(actor, activity())
    }
    const before = JSON.stringify({ ...state, lastEventAt: undefined })
    const turn = event.turnId
    const piUiEvent =
      entry.source === 'pi-extension' &&
      !turn &&
      ['attention-required', 'turn-active', 'activity-unknown'].includes(event.type)
    if (!event.agentId && event.type === 'turn-started') {
      if (!turn || entry.turns.has(turn)) return true
      if (entry.turns.size >= 4096) {
        this.unavailable(state.terminalId, '会话轮次过多，请新建 Agent 以恢复状态集成。')
        return true
      }
      entry.turns.add(turn)
      state.lastTurnId = turn
      Object.assign(actor, activity())
    } else if (event.type === 'session-started') {
      if (state.lastTurnId || event.agentId) return true
    } else if (!event.agentId && turn !== state.lastTurnId && !piUiEvent) return true
    if (actor.final && !piUiEvent && !background) return true
    const request = event.requestId || (event.toolName ? `tool.${event.toolName}` : 'anonymous')
    if (!actor.final || piUiEvent) {
      switch (event.type) {
        case 'session-started':
          actor.activity = 'idle'
          break
        case 'turn-started':
          actor.activity = 'working'
          actor.outcome = 'unknown'
          break
        case 'turn-active':
          if (!turn && !event.agentId && entry.source !== 'pi-extension') return true
          if (entry.source === 'pi-extension') actor.waits.clear()
          else {
            // Unidentified permission waits survive parallel tools, and clear at this actor's end.
            if (event.requestDone && event.requestId) {
              actor.waits.delete(event.requestId)
              actor.resolved.add(event.requestId)
            }
            if (actor.resolved.size > 4096) {
              this.unavailable(state.terminalId, '工具请求过多，请新建 Agent 以恢复状态集成。')
              return true
            }
          }
          actor.activity = 'working'
          actor.outcome = 'unknown'
          break
        case 'attention-required':
          if (!turn && !event.agentId && entry.source !== 'pi-extension') return true
          if (event.requestId && actor.resolved.has(event.requestId)) return true
          if (request === 'anonymous' && actor.waits.size) return true
          if (actor.waits.size >= 256 && !actor.waits.has(request)) {
            this.unavailable(state.terminalId, '待处理请求过多，请新建 Agent 以恢复状态集成。')
            return true
          }
          if (!actor.waits.has(request)) state.unread = true
          actor.waits.add(request)
          break
        case 'turn-ended':
          if ((!turn && !event.agentId) || entry.source === 'pi-extension') return true
          actor.waits.clear()
          // Hook Stop is reversible and says nothing about success; later native activity corrects it.
          if (actor.outcome !== 'failure') {
            actor.activity = 'completed'
            actor.outcome = 'unknown'
          }
          break
        case 'turn-completed':
          if (!turn || entry.source !== 'pi-extension') return true
          actor.activity = 'completed'
          actor.outcome = 'success'
          actor.final = true
          actor.waits.clear()
          break
        case 'turn-failed':
        case 'turn-interrupted':
          if (!turn && !event.agentId) return true
          actor.activity = event.type === 'turn-failed' ? 'failed' : 'interrupted'
          actor.outcome = event.type === 'turn-failed' ? 'failure' : 'cancelled'
          actor.final = event.type === 'turn-interrupted' || entry.source === 'pi-extension'
          actor.waits.clear()
          break
        case 'activity-unknown':
          if (!turn && !event.agentId && entry.source !== 'pi-extension') return true
          actor.activity = 'unknown'
          actor.outcome = 'unknown'
          actor.waits.clear()
          break
      }
      actor.timestamp = event.timestamp
      actor.stale = false
    }
    if (background && (!entry.background || event.timestamp >= entry.background.timestamp)) {
      const listed = new Set(background.agentIds)
      for (const id of listed) {
        if (entry.children.has(id)) continue
        if (entry.children.size >= 256) {
          this.unavailable(state.terminalId, '子任务过多，请新建 Agent 以恢复状态集成。')
          return true
        }
        entry.children.set(id, activity())
      }
      // A complete lead inventory reconciles the same ID-keyed actors, never a second child count.
      for (const [id, child] of entry.children) {
        if (child.timestamp > event.timestamp) continue
        if (listed.has(id)) {
          // A running inventory entry proves neither that a permission was answered nor that it is still pending.
          if (child.waits.size) continue
          if (child.stale || child.activity !== 'working') Object.assign(child, activity())
          child.activity = 'working'
          child.timestamp = event.timestamp
        } else if (child.stale || child.waits.size || child.activity === 'working') {
          Object.assign(child, activity(), { activity: 'completed', timestamp: event.timestamp })
        }
      }
      entry.background = {
        otherCount: background.otherCount,
        timestamp: event.timestamp,
        stale: false,
      }
    }
    state.lastEventAt = new Date(
      Math.max(Date.parse(state.lastEventAt), event.timestamp),
    ).toISOString()
    this.fold(entry)
    if (before !== JSON.stringify({ ...state, lastEventAt: undefined })) this.publish(state, false)
    return true
  }

  expire(): void {
    for (const entry of this.entries.values()) {
      if (!entry.token || entry.source === 'pi-extension') continue
      let changed = false
      for (const actor of [entry.main, ...entry.children.values()]) {
        if (
          !actor.stale &&
          (actor.waits.size || actor.activity === 'working') &&
          Date.now() - actor.timestamp >= 30 * 60_000
        ) {
          actor.stale = true
          changed = true
        }
      }
      if (
        entry.background?.otherCount &&
        !entry.background.stale &&
        Date.now() - entry.background.timestamp >= 30 * 60_000
      ) {
        entry.background.stale = true
        changed = true
      }
      if (changed) {
        this.fold(entry)
        this.publish(entry.state, false)
      }
    }
  }

  private fold(entry: Entry): void {
    const state = entry.state
    const previous = state.activityState
    const actors = [entry.main, ...entry.children.values()]
    const waiting = (actor: Activity) => !actor.stale && actor.waits.size > 0
    const working = (actor: Activity) => !actor.stale && actor.activity === 'working'
    const backgroundCount = entry.background?.stale ? 0 : (entry.background?.otherCount ?? 0)
    const stale = !!entry.background?.stale || actors.some((actor) => actor.stale)
    state.waitingChildren = [...entry.children.values()].filter(waiting).length
    state.workingChildren = [...entry.children.values()].filter(
      (actor) => !waiting(actor) && working(actor),
    ).length
    state.workingChildren += backgroundCount
    state.activityState = actors.some(waiting)
      ? 'needs-input'
      : actors.some(working) || backgroundCount > 0
        ? 'working'
        : stale || actors.some((actor) => actor.activity === 'unknown')
          ? 'unknown'
          : entry.main.activity
    state.outcome = ['completed', 'failed', 'interrupted'].includes(state.activityState)
      ? entry.main.outcome
      : 'unknown'
    if (state.activityState !== previous)
      state.unread = ['needs-input', 'completed', 'failed'].includes(state.activityState)
    state.eventSource = entry.source!
    state.observability = stale ? 'unavailable' : entry.capability!
    state.observabilityReason = stale
      ? '部分任务三十分钟未收到原生事件；无法确认当前任务状态。'
      : entry.capability === 'partial'
        ? '本轮结束不代表任务成功；后续原生活动可纠正状态。仅归并已观察到的子任务与后台任务，不读取会话日志。'
        : undefined
  }

  private publish(state: AgentSession, processEvent = true): void {
    if (processEvent) state.lastEventAt = new Date().toISOString()
    state.revision++
    this.send({ type: 'state', session: { ...state } })
  }
}
