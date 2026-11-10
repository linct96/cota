import type {
  AgentUpdate,
  Preferences,
  TerminalAttachment,
  TerminalEvent,
  TerminalSession,
  WorkspaceTarget,
} from '../../shared/contracts'
import { dimensions, preferences, terminalId, workspaceTarget } from '../validation'
import { AgentSessionManager } from '../agents/runtime/session-manager'
import { hasRunningJob, stopProcessTree } from '../system/process-tree'
import type { ResolvedTerminalAttach, ResolvedTerminalCreate } from '../host/host-protocol'
import { sameBinding, terminalBinding } from './terminal-binding'
import type { TerminalProcessRoot } from '../../shared/workspace-ports'
import type { Session } from './session'
import { flow, flush } from './output'
import { createTerminal } from './create'
import { TerminalAgentIntegration } from './agent-integration'

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private stopping = false
  private creations = new Set<Promise<void>>()

  readonly agents: AgentSessionManager
  private readonly integration: TerminalAgentIntegration
  constructor(
    private readonly send: (event: TerminalEvent) => void,
    sendAgent: (event: AgentUpdate) => void = () => {},
    private readonly agentSocketPath?: string,
  ) {
    this.agents = new AgentSessionManager(sendAgent)
    this.integration = new TerminalAgentIntegration(this.sessions, this.agents, () => this.stopping)
  }

  create(options: ResolvedTerminalCreate, settings: Preferences): Promise<void> {
    const operation = createTerminal(options, settings, {
      sessions: this.sessions,
      agents: this.agents,
      agentSocketPath: this.agentSocketPath,
      isStopping: () => this.stopping,
      integration: this.integration,
      send: this.send,
    })
    this.creations.add(operation)
    void operation.finally(() => this.creations.delete(operation)).catch(() => {})
    return operation
  }

  async processRoots(): Promise<TerminalProcessRoot[]> {
    const roots = await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        const started = await session.processStarted
        if (
          !started ||
          !session.child ||
          session.exited ||
          session.closing ||
          this.sessions.get(session.id) !== session
        )
          return
        return {
          terminalId: session.id,
          projectPath: session.projectPath,
          workspaceId: session.workspaceId,
          cwd: session.cwd,
          pid: session.child.pid,
          started,
        }
      }),
    )
    return roots.filter((root): root is TerminalProcessRoot => root !== undefined)
  }

  async list(): Promise<TerminalSession[]> {
    await Promise.allSettled(this.creations)
    return [...this.sessions.values()].map(
      ({
        id,
        projectPath,
        workspaceId,
        cwd,
        workspaceKind,
        worktreeId,
        repoCommonDir,
        cols,
        rows,
        exited,
        exitCode,
        kind,
        provider,
        agent,
        agentRevision,
        service,
        shellActivity,
      }) => ({
        id,
        projectPath,
        workspaceId,
        cwd,
        workspaceKind,
        worktreeId,
        repoCommonDir,
        cols,
        rows,
        exited,
        exitCode,
        shellActivity,
        ...(kind === 'agent' ? { kind, provider } : {}),
        ...(agent ? { agent: { ...agent } } : {}),
        ...(agentRevision ? { agentRevision } : {}),
        ...(service ? { service: { ...service } } : {}),
      }),
    )
  }

  async attach(value: unknown): Promise<TerminalAttachment> {
    if (!value || typeof value !== 'object') throw new Error('终端参数无效。')
    const options = value as ResolvedTerminalAttach
    const id = terminalId(options.id)
    const attachmentId = terminalId(options.attachmentId)
    const target = terminalBinding(options)
    const session = this.sessions.get(id)
    if (!session || !sameBinding(session, target))
      throw new Error('终端会话不存在或已结束，请新建终端。')
    await session.creation
    if (session.closing || this.sessions.get(id) !== session) throw new Error('终端正在关闭。')
    // The parser barrier and ownership switch form one snapshot/live-output boundary.
    return new Promise((resolve, reject) => {
      session.attaching.add(reject)
      session.screen.write('', () => {
        session.attaching.delete(reject)
        if (session.closing || this.sessions.get(id) !== session) {
          reject(new Error('终端正在关闭。'))
          return
        }
        try {
          this.detach(id, session.attachmentId)
          // shortcut: serialization omits unfinished escape state; track escape tails before promising lossless arbitrary-TUI reconnect.
          const snapshot = session.keyboard.snapshot(session.serializer.serialize())
          session.attachmentId = attachmentId
          resolve({
            id,
            ...target,
            cols: session.cols,
            rows: session.rows,
            exited: session.exited,
            exitCode: session.exitCode,
            shellActivity: session.shellActivity,
            ...(session.service ? { service: { ...session.service } } : {}),
            ...(session.kind === 'agent' ? { kind: session.kind, provider: session.provider } : {}),
            ...(session.agent ? { agent: { ...session.agent } } : {}),
            ...(session.agentRevision ? { agentRevision: session.agentRevision } : {}),
            snapshot,
          })
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  detach(id: string, attachmentId?: string): void {
    const session = this.sessions.get(terminalId(id))
    if (!session || session.attachmentId !== attachmentId) return
    session.attachmentId = undefined
    if (session.timer) clearTimeout(session.timer)
    session.timer = undefined
    session.pending = []
    session.inFlight = 0
    flow(session)
  }

  isLive(id: string): boolean {
    const session = this.sessions.get(terminalId(id))
    return !!session && !session.exited
  }

  async needsCloseConfirmation(id: string): Promise<boolean> {
    const session = this.sessions.get(terminalId(id))
    if (!session) return false
    const hasExited = () => session.exited
    if (hasExited()) return false
    await session.creation
    if (hasExited()) return false
    if (session.agent || session.service) return true
    if (!session.child || !session.shell) return true
    try {
      const busy = await hasRunningJob(session.child.pid, session.shell)
      return !hasExited() && busy
    } catch {
      return !hasExited()
    }
  }

  hasLive(): boolean {
    return [...this.sessions.values()].some((session) => !session.exited)
  }

  write(id: string, data: unknown, encoding: unknown = 'utf8'): void {
    const session = this.live(id)
    if (typeof data !== 'string' || data.length > 1024 * 1024)
      throw new Error('输入文本过大（上限 1 MiB 字符）。')
    if (encoding !== 'utf8' && encoding !== 'binary') throw new Error('终端输入编码无效。')
    if (encoding === 'binary' && /[\u0100-\uffff]/.test(data))
      throw new Error('终端二进制输入包含无效字节。')
    // Legacy mouse coordinates are single bytes, not UTF-8 text.
    session.child!.write(encoding === 'binary' ? Buffer.from(data, 'latin1') : data)
    // A submitted command only requests an identity check, never a task-state transition.
    if (encoding === 'utf8' && session.managed && /[\r\n]/.test(data))
      this.integration.observeAgents()
  }

  resize(id: string, cols: number, rows: number): void {
    const size = dimensions(cols, rows)
    const session = this.sessions.get(terminalId(id))
    if (!session?.child || session.exited || session.closing) return
    session.cols = size.cols
    session.rows = size.rows
    session.screen.resize(size.cols, size.rows)
    session.child.resize(size.cols, size.rows)
  }

  setScrollback(value: unknown): void {
    const { scrollback } = preferences({ shellPath: null, scrollback: value, openWith: [] })
    for (const session of this.sessions.values()) session.screen.options.scrollback = scrollback
  }

  acknowledge(id: string, attachmentId: string, length: unknown): void {
    const session = this.sessions.get(terminalId(id))
    if (
      !session ||
      session.attachmentId !== attachmentId ||
      !Number.isInteger(length) ||
      Number(length) < 0 ||
      Number(length) > session.inFlight
    )
      return
    session.inFlight -= Number(length)
    flow(session)
  }

  async stopService(id: string): Promise<void> {
    const session = this.sessions.get(terminalId(id))
    if (!session?.service) throw new Error('服务会话不存在。')
    await session.creation
    if (session.closing) throw new Error('服务正在关闭。')
    if (session.stoppingService) return session.stoppingService
    if (session.exited) return
    session.stoppingService = Promise.resolve()
      .then(async () => {
        if (session.child) await stopProcessTree(session.child.pid)
        session.exited = true
        session.shellActivity = 'unknown'
        session.managed = undefined
        if (session.agent) this.agents.runtime(id, 'exited', session.exitCode)
        session.screen.write('', () => {
          flush(session, this.send)
          if (session.attachmentId)
            this.send({
              type: 'exit',
              id: session.id,
              attachmentId: session.attachmentId,
              exitCode: session.exitCode ?? 0,
            })
        })
      })
      .finally(() => {
        session.stoppingService = undefined
      })
    await session.stoppingService
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(terminalId(id))
    if (!session) return
    if (session.creation) throw new Error('终端正在创建，请稍后再关闭。')
    if (session.stoppingService) await session.stoppingService
    if (!session.closing) {
      session.managed = undefined
      if (session.agent && !session.exited) this.agents.runtime(id, 'stopping')
      session.closing = (async () => {
        if (!session.exited && session.child) await stopProcessTree(session.child.pid)
        if (session.timer) clearTimeout(session.timer)
        for (const subscription of session.subscriptions) subscription.dispose()
        for (const reject of session.attaching) reject(new Error('终端正在关闭。'))
        session.attaching.clear()
        session.screen.dispose()
        this.sessions.delete(id)
        this.agents.remove(id)
      })().catch((error) => {
        session.closing = undefined
        if (session.agent && !session.exited) {
          this.agents.unavailable(id, '关闭失败；终端仍可操作，任务状态集成需新建 Agent 才能恢复。')
          this.agents.runtime(id, 'running')
        }
        throw error
      })
    }
    await session.closing
  }

  async closeProject(path: string): Promise<void> {
    await Promise.allSettled(this.creations)
    for (const [id, session] of this.sessions)
      if (session.projectPath === path) await this.close(id)
  }

  async closeWorkspace(target: WorkspaceTarget): Promise<void> {
    target = workspaceTarget(target)
    await Promise.allSettled(this.creations)
    for (const [id, session] of this.sessions) {
      if (session.projectPath === target.projectPath && session.workspaceId === target.workspaceId)
        await this.close(id)
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    try {
      await Promise.allSettled(this.creations)
      for (const id of this.sessions.keys()) await this.close(id)
      this.integration.dispose()
    } catch (error) {
      this.stopping = false
      throw error
    }
  }

  authenticManagedEvent(value: unknown): boolean {
    return this.integration.authenticManagedEvent(value)
  }

  receiveAgentEvent(value: unknown, channel: object): Promise<boolean> {
    return this.integration.receiveAgentEvent(value, channel)
  }

  private live(id: string): Session {
    const session = this.sessions.get(terminalId(id))
    if (!session?.child || session.exited || session.closing)
      throw new Error('终端已退出或正在关闭。')
    return session
  }
}
