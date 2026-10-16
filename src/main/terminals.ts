import * as pty from 'node-pty'
import {
  MAX_TERMINALS,
  type CreateTerminal,
  type Preferences,
  type TerminalEvent,
} from '../shared/contracts'
import { dimensions, projectDirectory, terminalId } from './validation'
import { resolveShell, shellEnvironment } from './shell'
import { stopProcessTree } from './process-tree'

interface Session {
  projectPath: string
  child?: pty.IPty
  starting: boolean
  exited: boolean
  pending: string[]
  timer?: ReturnType<typeof setTimeout>
  inFlight: number
  paused: boolean
  closing?: Promise<void>
  subscriptions: pty.IDisposable[]
}

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private stopping = false
  private creations = new Set<Promise<void>>()

  constructor(private readonly send: (event: TerminalEvent) => void) {}

  create(options: CreateTerminal, settings: Preferences, allowedProjects: string[]): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('应用正在退出。'))
    const id = terminalId(options.id)
    if (this.sessions.has(id)) return Promise.reject(new Error('终端已存在。'))
    if (this.sessions.size >= MAX_TERMINALS)
      return Promise.reject(new Error('最多保留 10 个终端，请先关闭一个标签。'))
    const size = dimensions(options.cols, options.rows)
    if (!allowedProjects.includes(options.projectPath))
      return Promise.reject(new Error('请先打开项目目录。'))
    const session: Session = {
      projectPath: options.projectPath,
      starting: true,
      exited: false,
      pending: [],
      inFlight: 0,
      paused: false,
      subscriptions: [],
    }
    this.sessions.set(id, session)
    const operation = (async () => {
      try {
        const cwd = await projectDirectory(options.projectPath)
        const shell = await resolveShell(settings)
        if (this.stopping) throw new Error('应用正在退出。')
        session.child = pty.spawn(shell, ['-il'], {
          ...size,
          cwd,
          name: 'xterm-256color',
          env: shellEnvironment(),
        })
        session.starting = false
        session.subscriptions.push(
          session.child.onData((data) => {
            session.pending.push(data)
            if (!session.timer) session.timer = setTimeout(() => this.flush(id, session), 12)
          }),
          session.child.onExit(({ exitCode, signal }) => {
            session.exited = true
            this.flush(id, session)
            this.send({ type: 'exit', id, exitCode, signal })
          }),
        )
      } catch (error) {
        this.sessions.delete(id)
        throw error
      }
    })()
    this.creations.add(operation)
    void operation.finally(() => this.creations.delete(operation)).catch(() => {})
    return operation
  }

  isLive(id: string): boolean {
    const session = this.sessions.get(terminalId(id))
    return !!session && !session.exited
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
    // A native close dialog can queue a final layout resize while cleanup is in flight.
    if (!session?.child || session.exited || session.closing) return
    session.child.resize(size.cols, size.rows)
  }

  acknowledge(id: string, length: unknown): void {
    const session = this.sessions.get(terminalId(id))
    if (
      !session ||
      !Number.isInteger(length) ||
      Number(length) < 0 ||
      Number(length) > session.inFlight
    )
      return
    session.inFlight -= Number(length)
    if (session.paused && session.inFlight < 65536 && !session.exited) {
      session.paused = false
      session.child?.resume()
    }
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(terminalId(id))
    if (!session) return
    if (session.starting) throw new Error('终端正在创建，请稍后再关闭。')
    if (!session.closing) {
      session.closing = (async () => {
        if (!session.exited && session.child) await stopProcessTree(session.child.pid)
        if (session.timer) clearTimeout(session.timer)
        for (const subscription of session.subscriptions) subscription.dispose()
        this.sessions.delete(id)
      })().catch((error) => {
        session.closing = undefined
        throw error
      })
    }
    await session.closing
  }

  async closeProject(path: string): Promise<void> {
    // Main blocks new creations for this project until removal finishes.
    await Promise.allSettled([...this.creations])
    for (const [id, session] of this.sessions) {
      if (session.projectPath === path) await this.close(id)
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

  private flush(id: string, session: Session): void {
    if (session.timer) clearTimeout(session.timer)
    session.timer = undefined
    if (!session.pending.length) return
    const data = session.pending.join('')
    session.pending = []
    session.inFlight += data.length
    if (session.inFlight >= 131072 && !session.paused && !session.exited) {
      session.paused = true
      session.child?.pause()
    }
    this.send({ type: 'data', id, data })
  }
}
