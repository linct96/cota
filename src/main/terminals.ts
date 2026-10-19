import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  MAX_TERMINALS,
  type Preferences,
  type TerminalAttachment,
  type TerminalEvent,
  type TerminalSession,
  type WorkspaceTarget,
} from '../shared/contracts'
import { dimensions, preferences, terminalId, workspaceTarget } from './validation'
import { resolveShell, shellEnvironment } from './shell'
import { hasRunningJob, stopProcessTree } from './process-tree'
import type { ResolvedTerminalCreate, ResolvedTerminalAttach } from './host-protocol'
import { sameBinding, terminalBinding, validateTerminalBinding } from './terminal-binding'

interface Session extends TerminalSession {
  child?: pty.IPty
  shell?: string
  creation?: Promise<void>
  screen: Terminal
  serializer: SerializeAddon
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

  constructor(private readonly send: (event: TerminalEvent) => void) {}

  create(options: ResolvedTerminalCreate, settings: Preferences): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('应用正在退出。'))
    const id = terminalId(options?.id)
    const target = terminalBinding(options)
    const size = dimensions(options.cols, options.rows)
    settings = preferences(settings)
    const existing = this.sessions.get(id)
    if (existing) {
      // Stable IDs make an interrupted create retryable without spawning a second shell.
      if (!sameBinding(existing, target) || existing.closing)
        return Promise.reject(new Error('终端标识已被其他会话占用。'))
      return existing.creation || Promise.resolve()
    }
    if (this.sessions.size >= MAX_TERMINALS)
      return Promise.reject(new Error('最多保留 10 个终端，请先关闭一个标签。'))
    const screen = new Terminal({
      ...size,
      scrollback: settings.scrollback,
      allowProposedApi: true,
    })
    const serializer = new SerializeAddon()
    screen.loadAddon(serializer)
    const session: Session = {
      ...target,
      ...size,
      id,
      screen,
      serializer,
      exited: false,
      pending: [],
      parsing: 0,
      inFlight: 0,
      paused: false,
      subscriptions: [],
      attaching: new Set(),
    }
    this.sessions.set(id, session)
    const operation = (async () => {
      try {
        const shell = await resolveShell(settings)
        await validateTerminalBinding(target)
        if (this.stopping) throw new Error('应用正在退出。')
        session.shell = shell
        session.child = pty.spawn(shell, ['-il'], {
          ...size,
          cwd: target.cwd,
          name: 'xterm-256color',
          env: shellEnvironment(),
        })
        session.subscriptions.push(
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
            session.exited = true
            session.exitCode = exitCode
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
          const snapshot = session.serializer.serialize()
          session.attachmentId = attachmentId
          resolve({
            id,
            ...target,
            cols: session.cols,
            rows: session.rows,
            exited: session.exited,
            exitCode: session.exitCode,
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

  write(id: string, data: unknown): void {
    const session = this.live(id)
    if (typeof data !== 'string' || data.length > 1024 * 1024)
      throw new Error('输入文本过大（上限 1 MiB 字符）。')
    session.child!.write(data)
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

  async close(id: string): Promise<void> {
    const session = this.sessions.get(terminalId(id))
    if (!session) return
    if (session.creation) throw new Error('终端正在创建，请稍后再关闭。')
    if (!session.closing) {
      session.closing = (async () => {
        if (!session.exited && session.child) await stopProcessTree(session.child.pid)
        if (session.timer) clearTimeout(session.timer)
        for (const subscription of session.subscriptions) subscription.dispose()
        for (const reject of session.attaching) reject(new Error('终端正在关闭。'))
        session.attaching.clear()
        session.screen.dispose()
        this.sessions.delete(id)
      })().catch((error) => {
        session.closing = undefined
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
    } catch (error) {
      this.stopping = false
      throw error
    }
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
