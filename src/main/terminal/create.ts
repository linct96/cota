import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { SerializeAddon } from '@xterm/addon-serialize'
import { agentCliCacheSchema } from '../../shared/agent-cli'
import { prepareAgentShell } from '../agents/hooks/shell-integration'
import { MAX_TERMINALS, type Preferences, type TerminalEvent } from '../../shared/contracts'
import { dimensions, preferences, terminalId, terminalLaunch, startupCommand } from '../validation'
import { resolveShell, shellArguments, shellEnvironment } from '../system/shell'
import { resolveAgent } from '../agents/cli/registry'
import type { AgentSessionManager } from '../agents/runtime/session-manager'
import type { ResolvedTerminalCreate } from '../host/host-protocol'
import { sameBinding, terminalBinding, validateTerminalBinding } from './terminal-binding'
import { createTerminalKeyboardState } from '../../shared/terminal-keyboard-state'
import { claimServicePort } from './service-port'
import { readProcessSnapshot } from '../system/process-snapshot'
import type { Session } from './session'
import type { TerminalAgentIntegration } from './agent-integration'
import { flow, flush } from './output'

interface TerminalCreationRuntime {
  sessions: Map<string, Session>
  agents: AgentSessionManager
  agentSocketPath?: string
  isStopping(): boolean
  integration: TerminalAgentIntegration
  send(event: TerminalEvent): void
}

export function createTerminal(
  options: ResolvedTerminalCreate,
  settings: Preferences,
  runtime: TerminalCreationRuntime,
): Promise<void> {
  if (runtime.isStopping()) return Promise.reject(new Error('应用正在退出。'))
  const id = terminalId(options?.id)
  const target = terminalBinding(options)
  const launch = terminalLaunch(options)
  const cliCache =
    options.agentCliCache === undefined
      ? undefined
      : agentCliCacheSchema.parse(options.agentCliCache)
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
  if (startup !== undefined && !runtime.agentSocketPath)
    return Promise.reject(new Error('终端 Host 缺少 Shell 初始化目录。'))
  const size = dimensions(options.cols, options.rows)
  const existing = runtime.sessions.get(id)
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
    [...runtime.sessions.values()].some(
      (session) =>
        session.workspaceId === target.workspaceId &&
        session.projectPath === target.projectPath &&
        session.service?.commandId === definition.id &&
        !session.exited,
    )
  )
    return Promise.reject(new Error('该服务已在当前工作区运行，请查看日志或先停止。'))
  if (runtime.sessions.size >= MAX_TERMINALS)
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
          agent: runtime.agents.create(id, launch.launchId, launch.provider, target),
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
  runtime.sessions.set(id, session)
  const operation = (async () => {
    let claimed: Awaited<ReturnType<typeof claimServicePort>> | undefined
    try {
      if (definition?.port !== undefined) {
        if (
          typeof definition.port === 'number' &&
          [...runtime.sessions.values()].some(
            (other) =>
              other !== session && !other.exited && other.service?.port === definition.port,
          )
        )
          throw new Error(`服务端口 ${definition.port} 已被 Cota 中的其他服务使用。`)
        claimed = await claimServicePort(definition.port)
        if (
          [...runtime.sessions.values()].some(
            (other) => other !== session && !other.exited && other.service?.port === claimed!.port,
          )
        )
          throw new Error(`服务端口 ${claimed.port} 已被 Cota 中的其他服务使用。`)
        session.service!.port = claimed.port
      }
      const command =
        launch.kind === 'agent'
          ? await resolveAgent(launch.provider, settings, cliCache)
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
      if (runtime.agentSocketPath) {
        const token = randomBytes(32).toString('hex')
        session.managed = { token, settings, cliCache }
        Object.assign(command.env, {
          COTA_AGENT_SOCKET: runtime.agentSocketPath,
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
            dirname(runtime.agentSocketPath),
            startup,
          )
          // A requested command must fail visibly, never silently become an empty shell.
          const args =
            startup === undefined ? await preparation.catch(() => undefined) : await preparation
          if (args) command.args = args
        }
      }
      await validateTerminalBinding(target)
      if (runtime.isStopping()) throw new Error('应用正在退出。')
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
      if (session.agent) runtime.agents.runtime(id, 'running')
      if (session.managed) runtime.integration.observeAgents()
      session.subscriptions.push(
        screen.parser.registerOscHandler(133, (data) => {
          if (session.managed && /^[CD](?:;|$)/.test(data)) runtime.integration.observeAgents()
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
                runtime.send({ type: 'activity', id, attachmentId: session.attachmentId, activity })
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
              if (!session.timer) session.timer = setTimeout(() => flush(session, runtime.send), 12)
            }
            flow(session)
          })
          flow(session)
        }),
        session.child.onExit(({ exitCode, signal }) => {
          session.exitCode = exitCode
          if (session.service && (session.stoppingService || session.exited)) return
          session.exited = true
          session.shellActivity = 'unknown'
          session.managed = undefined
          if (session.agent) runtime.agents.runtime(id, 'exited', exitCode)
          screen.write('', () => {
            flush(session, runtime.send)
            if (session.attachmentId)
              runtime.send({
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
        runtime.agents.runtime(id, 'error')
        runtime.agents.remove(id)
      }
      screen.dispose()
      runtime.sessions.delete(id)
      throw error
    }
  })()
  session.creation = operation
  void operation
    .finally(() => {
      session.creation = undefined
    })
    .catch(() => {})
  return operation
}
