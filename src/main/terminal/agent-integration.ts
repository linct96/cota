import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { AGENT_PROVIDERS } from '../../shared/contracts'
import type { AgentLifecycleEvent, ManagedAgentEvent } from '../../shared/contracts'
import { isWindows } from '../system/platform'
import { agentCapability, resolveAgent } from '../agents/cli/registry'
import type { AgentSessionManager } from '../agents/runtime/session-manager'
import { validLifecycleEvent } from '../agents/runtime/events'
import { agentOwner, agentProcesses, foregroundAgent } from '../agents/runtime/process-observation'
import type { Session } from './session'

export class TerminalAgentIntegration {
  private agentObservation?: ReturnType<typeof setTimeout>
  private observing = false
  private agentObservationAt = 0
  private agentObservationRequested = false
  private agentObservationErrors = 0

  constructor(
    private readonly sessions: Map<string, Session>,
    private readonly agents: AgentSessionManager,
    private readonly isStopping: () => boolean,
  ) {}

  dispose(): void {
    if (this.agentObservation) clearTimeout(this.agentObservation)
    this.agentObservation = undefined
  }

  authenticManagedEvent(value: unknown): boolean {
    if (!value || typeof value !== 'object' || !('managed' in value) || value.managed !== true)
      return false
    const event = value as ManagedAgentEvent
    const session = this.sessions.get(event.terminalId)
    const context = session?.managed
    return !!(
      context &&
      !session.exited &&
      !session.closing &&
      typeof event.token === 'string' &&
      Buffer.byteLength(event.token) === 64 &&
      timingSafeEqual(Buffer.from(context.token), Buffer.from(event.token))
    )
  }

  async receiveAgentEvent(value: unknown, channel: object): Promise<boolean> {
    if (!value || typeof value !== 'object' || !('managed' in value)) return false
    const { managed, processId, sessionId, ...metadata } = value as Record<
      keyof ManagedAgentEvent,
      unknown
    >
    const event = { ...metadata, launchId: randomUUID() } as AgentLifecycleEvent
    if (
      managed !== true ||
      typeof processId !== 'number' ||
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      typeof sessionId !== 'string' ||
      !/^[\w.-]{1,128}$/.test(sessionId) ||
      !Object.hasOwn(AGENT_PROVIDERS, event.provider) ||
      !validLifecycleEvent(event)
    )
      return false
    const session = this.sessions.get(event.terminalId)
    const context = session?.managed
    if (
      !session?.child ||
      (session.launch.kind === 'agent' && session.launch.provider !== event.provider) ||
      !context ||
      session.exited ||
      session.closing ||
      typeof event.token !== 'string' ||
      Buffer.byteLength(event.token) !== 64 ||
      !timingSafeEqual(Buffer.from(context.token), Buffer.from(event.token))
    )
      return false
    // Session state can change while process discovery or capability checks are awaiting.
    const isUnavailable = () => session.exited || !!session.closing
    let rows = await agentProcesses(false, [session.child.pid])
    if (!rows.some((row) => row.pid === processId))
      rows = await agentProcesses(true, [session.child.pid])
    const descendant = agentOwner(
      rows,
      session.child.pid,
      processId,
      session.launch.kind === 'agent',
    )
    // Menu launches own the foreground PTY root, including native setsid Hook helpers.
    const owner =
      session.launch.kind === 'agent' && descendant
        ? rows.find(
            (row) =>
              row.pid === session.child!.pid && (isWindows || row.group === descendant.group),
          )
        : descendant
    if (!owner || session.managed !== context || isUnavailable()) return false
    const foreground =
      session.launch.kind === 'agent' ? undefined : foregroundAgent(rows, session.child.pid)
    if (
      session.launch.kind !== 'agent' &&
      (!foreground ||
        foreground.owner.pid !== owner.pid ||
        foreground.owner.started !== owner.started ||
        foreground.provider !== event.provider)
    )
      return false
    let run = context.run
    if (
      run?.ended &&
      event.type === 'session-started' &&
      !event.agentId &&
      event.timestamp >= run.eventStartedAt
    ) {
      if (session.launch.kind === 'agent') {
        session.agent = this.agents.create(
          session.id,
          session.launch.launchId,
          session.launch.provider,
          session,
          session.agent!.revision,
        )
        this.agents.runtime(session.id, 'running')
      } else {
        session.agentRevision = this.agents.remove(session.id)
        session.agent = undefined
      }
      context.run = run = undefined
    }
    if (
      run &&
      (run.owner.pid !== owner.pid ||
        run.owner.started !== owner.started ||
        run.provider !== event.provider ||
        (run.process &&
          foreground &&
          (run.process.pid !== foreground.process.pid ||
            run.process.started !== foreground.process.started)))
    ) {
      // Menu launches keep their immutable identity until the PTY actually exits.
      if (session.launch.kind === 'agent') return false
      // A second nested agent must not replace the still-live Agent of this terminal.
      const identity = run.process ?? run.owner
      if (
        rows.some(
          (row) =>
            row.pid === identity.pid && row.started === identity.started && !row.stat.includes('Z'),
        )
      )
        return false
      session.agentRevision = this.agents.remove(session.id)
      session.agent = undefined
      context.run = run = undefined
    }
    if (!run) {
      if (event.agentId || !['session-started', 'turn-started'].includes(event.type)) return false
      context.run = run = {
        owner,
        process: foreground?.process,
        provider: event.provider,
        eventStartedAt: event.timestamp,
      }
      if (!session.agent) {
        session.agent = this.agents.create(
          session.id,
          event.launchId,
          event.provider,
          session,
          session.agentRevision,
        )
        this.agents.runtime(session.id, 'running')
      }
    }
    if (!run.ready) {
      if (event.agentId || !['session-started', 'turn-started'].includes(event.type)) return false
      run.eventStartedAt = event.timestamp
      const activeRun = run
      run.ready = (async () => {
        try {
          const command = await resolveAgent(event.provider, context.settings, context.cliCache)
          const capability = await agentCapability(event.provider, command)
          if (
            session.managed !== context ||
            context.run !== activeRun ||
            session.closing ||
            session.exited
          )
            return
          const source =
            event.provider === 'pi' ? 'pi-extension' : (`${event.provider}-hooks` as const)
          activeRun.token = this.agents.enable(session.id, source, capability)
        } catch (error) {
          if (session.managed === context && context.run === activeRun)
            this.agents.unavailable(
              session.id,
              error instanceof Error ? error.message : '无法确认 CLI 的适配版本。',
            )
        }
      })()
    }
    await run.ready
    if (
      session.managed !== context ||
      context.run !== run ||
      !run.token ||
      !session.agent ||
      isUnavailable()
    )
      return false
    if (event.timestamp < run.eventStartedAt) return true
    if (event.turnId)
      event.turnId = createHash('sha256').update(`${sessionId}:${event.turnId}`).digest('hex')
    event.token = run.token
    event.launchId = session.agent.launchId
    const accepted = this.agents.receive(event, channel)
    if (accepted && event.type === 'session-ended') run.ended = true
    return accepted
  }

  observeAgents(delay = 350): void {
    if (this.isStopping()) return
    if (this.observing) {
      this.agentObservationRequested = true
      return
    }
    const at = Date.now() + delay
    if (this.agentObservation && this.agentObservationAt <= at) return
    if (this.agentObservation) clearTimeout(this.agentObservation)
    this.agentObservationAt = at
    this.agentObservation = setTimeout(() => {
      this.agentObservation = undefined
      const sessions = [...this.sessions.values()].filter(
        (session) => session.managed && session.child && !session.closing && !session.exited,
      )
      if (!sessions.length) return
      this.observing = true
      void agentProcesses(
        true,
        sessions.map((session) => session.child!.pid),
      )
        .then((rows) => {
          this.agentObservationErrors = 0
          for (const session of sessions) {
            const context = session.managed
            if (!context || !session.child || session.closing || session.exited) continue
            if (!rows.some((row) => row.pid === session.child!.pid)) {
              this.agents.uncertain(session.id)
              continue
            }
            let run = context.run
            if (!run && session.launch.kind !== 'agent') {
              const found = foregroundAgent(rows, session.child.pid)
              if (found) {
                context.run = run = { ...found, eventStartedAt: 0 }
                session.agent = this.agents.create(
                  session.id,
                  randomUUID(),
                  found.provider,
                  session,
                  session.agentRevision,
                )
                this.agents.runtime(session.id, 'running')
              }
            }
            if (!run) continue
            const identity = run.process ?? run.owner
            const row = rows.find(
              (candidate) =>
                candidate.pid === identity.pid && candidate.started === identity.started,
            )
            const owner = rows.find(
              (candidate) =>
                candidate.pid === run.owner.pid && candidate.started === run.owner.started,
            )
            if (!row || !owner || row.stat.includes('Z') || owner.stat.includes('Z')) {
              if (session.launch.kind === 'agent') this.agents.uncertain(session.id)
              else {
                session.agentRevision = this.agents.remove(session.id)
                session.agent = undefined
                context.run = undefined
              }
            } else if (
              row.stat.includes('T') ||
              owner.stat.includes('T') ||
              (!isWindows &&
                rows.find((candidate) => candidate.pid === session.child!.pid)?.foreground !==
                  row.group)
            )
              this.agents.uncertain(session.id)
          }
        })
        .catch(() => {
          this.agentObservationErrors = Math.min(this.agentObservationErrors + 1, 4)
          for (const session of sessions) this.agents.uncertain(session.id)
        })
        .finally(() => {
          this.observing = false
          const active = [...this.sessions.values()].filter(
            (session) => session.managed && !session.closing && !session.exited,
          )
          const requested = this.agentObservationRequested
          this.agentObservationRequested = false
          if (!active.length) return
          const cadence = active.some((session) => session.agent) ? 750 : 2000
          const backoff = Math.min(10000, cadence * 2 ** this.agentObservationErrors)
          this.observeAgents(requested ? 350 : backoff)
        })
    }, delay)
    this.agentObservation.unref()
  }
}
