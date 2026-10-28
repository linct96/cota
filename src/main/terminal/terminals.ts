import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { prepareAgentShell } from '../agents/shell-integration'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  MAX_TERMINALS,
  type Preferences,
  type TerminalAttachment,
  type TerminalEvent,
  type TerminalSession,
  type TerminalLaunch,
  AGENT_PROVIDERS,
  type AgentLifecycleEvent,
  type ManagedAgentEvent,
  type AgentUpdate,
  type WorkspaceTarget,
} from '../../shared/contracts'
import {
  dimensions,
  preferences,
  terminalId,
  terminalLaunch,
  workspaceTarget,
  startupCommand,
} from '../validation'
import { resolveShell, shellArguments, shellEnvironment } from '../system/shell'
import { isWindows } from '../system/platform'
import { agentCapability, resolveAgent } from '../agents/registry'
import { AgentSessionManager, validLifecycleEvent } from '../agents/agent-session-manager'
import {
  agentProcesses,
  agentOwner,
  foregroundAgent,
  type AgentProcessRow,
} from '../agents/process-observation'
import { hasRunningJob, stopProcessTree } from '../system/process-tree'
import type { ResolvedTerminalCreate, ResolvedTerminalAttach } from '../host/host-protocol'
import { sameBinding, terminalBinding, validateTerminalBinding } from './terminal-binding'
import { createTerminalKeyboardState } from '../../shared/terminal-keyboard-state'
import { claimServicePort } from './service-port'
import { readProcessSnapshot } from '../system/process-snapshot'
import type { TerminalProcessRoot } from '../../shared/workspace-ports'

interface Session extends TerminalSession {
  launch: TerminalLaunch
  shellActivityToken?: string
  child?: pty.IPty
  processStarted?: Promise<string | undefined>
  shell?: string
  managed?: {
    token: string
    settings: Preferences
    run?: {
      owner: AgentProcessRow
      process?: AgentProcessRow
      provider: ManagedAgentEvent['provider']
      token?: string
      ready?: Promise<void>
      ended?: boolean
      eventStartedAt: number
    }
  }
  creation?: Promise<void>
  stoppingService?: Promise<void>
  screen: Terminal
  serializer: SerializeAddon
  keyboard: ReturnType<typeof createTerminalKeyboardState>
  pending: string[]
  timer?: ReturnType<typeof setTimeout>
  parsing: number
  inFlight: number
  attachmentId?: string
  paused: boolean
  closing?: Promise<void>
  subscriptions: pty.IDisposable[]
  attaching: Set<(error: Error) => void>
}

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private stopping = false
  private creations = new Set<Promise<void>>()

  readonly agents: AgentSessionManager
  private agentObservation?: ReturnType<typeof setTimeout>
  private observing = false
  private agentObservationAt = 0
  private agentObservationRequested = false
  private agentObservationErrors = 0

  constructor(
    private readonly send: (event: TerminalEvent) => void,
    sendAgent: (event: AgentUpdate) => void = () => {},
    private readonly agentSocketPath?: string,
  ) {
    this.agents = new AgentSessionManager(sendAgent)
  }

  create(options: ResolvedTerminalCreate, settings: Preferences): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('应用正在退出。'))
    const id = terminalId(options?.id)
    const target = terminalBinding(options)
    const launch = terminalLaunch(options)
    settings = preferences(settings)
    const definition =
      options.service === undefined
        ? undefined
        : settings.quickCommands.find(
            (entry) =>
              entry.id === options.service?.commandId &&
              entry.mode === 'service' &&
              (entry.scope.type === 'global' || entry.scope.projectPath === target.projectPath),
          )
    if (options.service !== undefined && (!definition || launch.kind !== 'shell'))
      return Promise.reject(new Error('服务定义不存在或不属于当前项目。'))
    const startup = definition?.command ?? startupCommand(options.startupCommand)
    if (startup !== undefined && launch.kind === 'agent')
      return Promise.reject(new Error('快捷命令只能在新建 Shell 中执行。'))
    if (startup !== undefined && !this.agentSocketPath)
      return Promise.reject(new Error('终端 Host 缺少 Shell 初始化目录。'))
    const size = dimensions(options.cols, options.rows)
    const existing = this.sessions.get(id)
    if (existing) {
      // A retry may reattach, but must never change a launch's immutable identity.
      if (
        !sameBinding(existing, target) ||
        existing.launch.kind !== launch.kind ||
        existing.launch.provider !== launch.provider ||
        existing.launch.launchId !== launch.launchId ||
        existing.service?.commandId !== definition?.id ||
        existing.closing
      )
        return Promise.reject(new Error('终端标识已被其他会话占用。'))
      return existing.creation || Promise.resolve()
    }
    if (
      definition &&
      [...this.sessions.values()].some(
        (session) =>
          session.workspaceId === target.workspaceId &&
          session.projectPath === target.projectPath &&
          session.service?.commandId === definition.id &&
          !session.exited,
      )
    )
      return Promise.reject(new Error('该服务已在当前工作区运行，请查看日志或先停止。'))
    if (this.sessions.size >= MAX_TERMINALS)
      return Promise.reject(new Error(`最多保留 ${MAX_TERMINALS} 个终端，请先关闭一个标签。`))
    const screen = new Terminal({
      ...size,
      scrollback: settings.scrollback,
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
    })
    const serializer = new SerializeAddon()
    screen.loadAddon(serializer)
    const keyboard = createTerminalKeyboardState(screen.parser)
    const session: Session = {
      ...target,
      ...size,
      id,
      launch,
      ...(definition ? { service: { commandId: definition.id, name: definition.name } } : {}),
      ...(launch.kind === 'agent'
        ? {
            kind: 'agent' as const,
            provider: launch.provider,
            agent: this.agents.create(id, launch.launchId, launch.provider, target),
          }
        : {}),
      screen,
      serializer,
      keyboard,
      exited: false,
      shellActivity: 'unknown',
      pending: [],
      parsing: 0,
      inFlight: 0,
      paused: false,
      subscriptions: [keyboard],
      attaching: new Set(),
    }
    this.sessions.set(id, session)
    const operation = (async () => {
      let claimed: Awaited<ReturnType<typeof claimServicePort>> | undefined
      try {
        if (definition?.port !== undefined) {
          if (
            typeof definition.port === 'number' &&
            [...this.sessions.values()].some(
              (other) =>
                other !== session && !other.exited && other.service?.port === definition.port,
            )
          )
            throw new Error(`服务端口 ${definition.port} 已被 Cota 中的其他服务使用。`)
          claimed = await claimServicePort(definition.port)
          if (
            [...this.sessions.values()].some(
              (other) =>
                other !== session && !other.exited && other.service?.port === claimed!.port,
            )
          )
            throw new Error(`服务端口 ${claimed.port} 已被 Cota 中的其他服务使用。`)
          session.service!.port = claimed.port
        }
        const command =
          launch.kind === 'agent'
            ? await resolveAgent(launch.provider, settings)
            : await (async () => {
                const executable = await resolveShell(settings)
                return { executable, args: shellArguments(executable), env: shellEnvironment() }
              })()
        if (session.service) {
          command.env.COTA_SERVICE = '1'
          if (session.service.port !== undefined) {
            command.env.PORT = String(session.service.port)
            command.env.COTA_PORT = String(session.service.port)
          }
        }
        if (this.agentSocketPath) {
          const token = randomBytes(32).toString('hex')
          session.managed = { token, settings }
          Object.assign(command.env, {
            COTA_AGENT_SOCKET: this.agentSocketPath,
            COTA_AGENT_TOKEN: token,
            COTA_AGENT_TERMINAL: id,
            COTA_AGENT_MANAGED: '1',
            COTA_AGENT_RUNNER: process.execPath,
            COTA_AGENT_ADAPTER_DIR: __dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'),
          })
          // Optional shell preparation must never prevent a usable terminal.
          if (launch.kind !== 'agent') {
            session.shellActivityToken = randomBytes(32).toString('hex')
            command.env.COTA_SHELL_ACTIVITY = session.shellActivityToken
            const preparation = prepareAgentShell(
              command.executable,
              command.env,
              dirname(this.agentSocketPath),
              startup,
            )
            // A requested command must fail visibly, never silently become an empty shell.
            const args =
              startup === undefined ? await preparation.catch(() => undefined) : await preparation
            if (args) command.args = args
          }
        }
        await validateTerminalBinding(target)
        if (this.stopping) throw new Error('应用正在退出。')
        if (launch.kind !== 'agent') session.shell = command.executable
        if (claimed) {
          await claimed.release()
          claimed = undefined
        }
        session.child = pty.spawn(command.executable, command.args, {
          ...size,
          cwd: target.cwd,
          name: 'xterm-256color',
          env: command.env,
        })
        const pid = session.child.pid
        session.processStarted = readProcessSnapshot()
          .then((rows) => rows.find((row) => row.pid === pid)?.started)
          .catch(() => undefined)
        if (session.agent) this.agents.runtime(id, 'running')
        if (session.managed) this.observeAgents()
        session.subscriptions.push(
          screen.parser.registerOscHandler(133, (data) => {
            if (session.managed && /^[CD](?:;|$)/.test(data)) this.observeAgents()
            const marker = /^([CD]);Cota=([a-f0-9]{64});Shell=(\d+)$/.exec(data)
            if (
              marker &&
              !session.exited &&
              !session.closing &&
              marker[2] === session.shellActivityToken &&
              Number(marker[3]) === session.child?.pid
            ) {
              const activity = marker[1] === 'C' ? 'running' : 'idle'
              if (session.shellActivity !== activity) {
                session.shellActivity = activity
                if (session.attachmentId)
                  this.send({ type: 'activity', id, attachmentId: session.attachmentId, activity })
              }
            }
            return false
          }),
          screen.onData((data) => {
            if (!session.attachmentId && !session.exited && !session.closing)
              session.child?.write(data)
          }),
          session.child.onData((data) => {
            session.parsing += data.length
            screen.write(data, () => {
              session.parsing -= data.length
              // Route parsed output so writes queued after an attach barrier cannot disappear.
              if (session.attachmentId) {
                session.inFlight += data.length
                session.pending.push(data)
                if (!session.timer) session.timer = setTimeout(() => this.flush(session), 12)
              }
              this.flow(session)
            })
            this.flow(session)
          }),
          session.child.onExit(({ exitCode, signal }) => {
            session.exitCode = exitCode
            if (session.service && (session.stoppingService || session.exited)) return
            session.exited = true
            session.shellActivity = 'unknown'
            session.managed = undefined
            if (session.agent) this.agents.runtime(id, 'exited', exitCode)
            screen.write('', () => {
              this.flush(session)
              if (session.attachmentId)
                this.send({
                  type: 'exit',
                  id,
                  attachmentId: session.attachmentId,
                  exitCode,
                  signal,
                })
            })
          }),
        )
      } catch (error) {
        if (claimed) await claimed.release().catch(() => {})
        if (session.agent) {
          this.agents.runtime(id, 'error')
          this.agents.remove(id)
        }
        screen.dispose()
        this.sessions.delete(id)
        throw error
      }
    })()
    session.creation = operation
    this.creations.add(operation)
    void operation
      .finally(() => {
        session.creation = undefined
        this.creations.delete(operation)
      })
      .catch(() => {})
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
    await Promise.allSettled([...this.creations])
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

  async attach(options: ResolvedTerminalAttach): Promise<TerminalAttachment> {
    const id = terminalId(options?.id)
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
    this.flow(session)
  }

  isLive(id: string): boolean {
    const session = this.sessions.get(terminalId(id))
    return !!session && !session.exited
  }

  async needsCloseConfirmation(id: string): Promise<boolean> {
    const session = this.sessions.get(terminalId(id))
    if (!session || session.exited) return false
    await session.creation
    if (session.exited) return false
    if (session.agent || session.service) return true
    if (!session.child || !session.shell) return true
    try {
      const busy = await hasRunningJob(session.child.pid, session.shell)
      return !session.exited && busy
    } catch {
      return !session.exited
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
    if (encoding === 'utf8' && session.managed && /[\r\n]/.test(data)) this.observeAgents()
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
    this.flow(session)
  }

  async stopService(id: string): Promise<void> {
    const session = this.sessions.get(terminalId(id))
    if (!session?.service) throw new Error('服务会话不存在。')
    await session.creation
    if (session.closing) throw new Error('服务正在关闭。')
    if (session.stoppingService) return session.stoppingService
    if (session.exited) return
    if (!session.stoppingService) {
      session.stoppingService = Promise.resolve()
        .then(async () => {
          if (session.child) await stopProcessTree(session.child.pid)
          session.exited = true
          session.shellActivity = 'unknown'
          session.managed = undefined
          if (session.agent) this.agents.runtime(id, 'exited', session.exitCode)
          session.screen.write('', () => {
            this.flush(session)
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
    }
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
    await Promise.allSettled([...this.creations])
    for (const [id, session] of this.sessions)
      if (session.projectPath === path) await this.close(id)
  }

  async closeWorkspace(target: WorkspaceTarget): Promise<void> {
    target = workspaceTarget(target)
    await Promise.allSettled([...this.creations])
    for (const [id, session] of this.sessions) {
      if (session.projectPath === target.projectPath && session.workspaceId === target.workspaceId)
        await this.close(id)
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    try {
      await Promise.allSettled([...this.creations])
      for (const id of this.sessions.keys()) await this.close(id)
      if (this.agentObservation) clearTimeout(this.agentObservation)
      this.agentObservation = undefined
    } catch (error) {
      this.stopping = false
      throw error
    }
  }

  authenticManagedEvent(value: unknown): boolean {
    if (!value || typeof value !== 'object' || !('managed' in value) || value.managed !== true)
      return false
    const event = value as ManagedAgentEvent
    const session = this.sessions.get(event.terminalId)
    const context = session?.managed
    return !!(
      context &&
      !session!.exited &&
      !session!.closing &&
      typeof event.token === 'string' &&
      Buffer.byteLength(event.token) === 64 &&
      timingSafeEqual(Buffer.from(context.token), Buffer.from(event.token))
    )
  }

  async receiveAgentEvent(value: unknown, channel: object): Promise<boolean> {
    if (!value || typeof value !== 'object' || !('managed' in value)) return false
    const { managed, processId, sessionId, ...metadata } = value as ManagedAgentEvent
    const event = { ...metadata, launchId: randomUUID() } as AgentLifecycleEvent
    if (
      managed !== true ||
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
    if (!owner || session.managed !== context || session.exited || session.closing) return false
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
          const command = await resolveAgent(event.provider, context.settings)
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
      session.exited ||
      session.closing
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

  private observeAgents(delay = 350): void {
    if (this.stopping) return
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
              (row) => row.pid === identity.pid && row.started === identity.started,
            )
            const owner = rows.find(
              (row) => row.pid === run.owner.pid && row.started === run.owner.started,
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
                rows.find((row) => row.pid === session.child!.pid)?.foreground !== row.group)
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

  private live(id: string): Session {
    const session = this.sessions.get(terminalId(id))
    if (!session?.child || session.exited || session.closing)
      throw new Error('终端已退出或正在关闭。')
    return session
  }

  private flow(session: Session): void {
    if (session.exited || !session.child) return
    if (!session.paused && (session.parsing >= 131072 || session.inFlight >= 131072)) {
      session.paused = true
      session.child.pause()
    } else if (session.paused && session.parsing < 65536 && session.inFlight < 65536) {
      session.paused = false
      session.child.resume()
    }
  }

  private flush(session: Session): void {
    if (session.timer) clearTimeout(session.timer)
    session.timer = undefined
    const data = session.pending.join('')
    session.pending = []
    if (!data || !session.attachmentId) return
    this.send({ type: 'data', id: session.id, attachmentId: session.attachmentId, data })
  }
}
