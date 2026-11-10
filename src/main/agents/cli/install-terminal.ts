import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { AgentProvider } from '../../../shared/contracts'
import { AGENT_CLI_INSTALL_SCROLLBACK } from '../../../shared/agent-cli'
import type {
  AgentCliInstallEvent,
  AgentCliInstallResult,
  AgentCliInstallRun,
  AgentCliInstallTerminal,
} from '../../../shared/agent-cli'
import { dimensions, terminalId } from '../../validation'
import { stopProcessTree } from '../../system/process-tree'
import type { resolveCommand } from '../../system/shell'

export type ExecuteCliInstall = (
  command: Awaited<ReturnType<typeof resolveCommand>>,
) => Promise<{ stdout: string; stderr: string }>

interface Job {
  run: AgentCliInstallRun
  screen: Terminal
  serializer: SerializeAddon
  revision: number
  parsing: number
  inFlight: number
  pending: string[]
  timer?: ReturnType<typeof setTimeout>
  paused: boolean
  child?: pty.IPty
  stop?: () => Promise<void>
  attachmentId?: string
  cancelled: boolean
  done: Promise<unknown>
}

export class AgentCliInstallTerminals {
  private jobs = new Map<AgentProvider, Job>()
  private attachmentEpoch = 0

  constructor(private readonly publish: (event: AgentCliInstallEvent) => void) {}

  get running(): boolean {
    return [...this.jobs.values()].some((job) => job.run.status === 'running')
  }

  list(): AgentCliInstallRun[] {
    return [...this.jobs.values()].map((job) => ({ ...job.run }))
  }

  async run(
    provider: AgentProvider,
    operation: (execute: ExecuteCliInstall) => Promise<AgentCliInstallResult>,
  ): Promise<AgentCliInstallResult> {
    if (this.running) throw new Error('已有 CLI 正在更新，请等待完成。')
    const previous = this.jobs.get(provider)
    if (previous) {
      this.resetAttachment(previous)
      previous.screen.write('', () => previous.screen.dispose())
    }
    const screen = new Terminal({
      cols: 100,
      rows: 28,
      scrollback: AGENT_CLI_INSTALL_SCROLLBACK,
      allowProposedApi: true,
    })
    const serializer = new SerializeAddon()
    screen.loadAddon(serializer)
    const job: Job = {
      run: { id: randomUUID(), provider, status: 'running' },
      screen,
      serializer,
      revision: 0,
      parsing: 0,
      inFlight: 0,
      pending: [],
      paused: false,
      cancelled: false,
      done: Promise.resolve(),
    }
    screen.onData((data) => {
      if (!job.attachmentId && !job.cancelled) job.child?.write(data)
    })
    this.jobs.set(provider, job)
    this.publish({ run: { ...job.run }, revision: job.revision })
    this.append(job, '正在准备更新…\r\n')
    const done = (async () => {
      try {
        const result = await operation((command) => this.execute(job, command))
        job.run.status = result.status.executable ? 'succeeded' : 'not-installed'
        this.append(
          job,
          result.status.executable
            ? '\r\n更新完成。\r\n'
            : '\r\n未检测到 CLI，当前状态为未安装。\r\n',
        )
        return result
      } catch (error) {
        job.run.status = 'failed'
        job.run.error = error instanceof Error ? error.message : String(error)
        this.append(job, `\r\n${job.run.error}\r\n`)
        throw error
      } finally {
        this.publish({ run: { ...job.run }, revision: job.revision })
      }
    })()
    job.done = done
    return done
  }

  async snapshot(
    provider: AgentProvider,
    attachment?: string,
  ): Promise<AgentCliInstallTerminal | undefined> {
    const attachmentId = attachment === undefined ? undefined : terminalId(attachment)
    const epoch = this.attachmentEpoch
    const job = this.jobs.get(provider)
    if (!job) return undefined
    return new Promise((resolve) => {
      job.screen.write('', () => {
        if (attachmentId && epoch === this.attachmentEpoch) {
          this.resetAttachment(job)
          job.attachmentId = attachmentId
        }
        resolve({
          run: { ...job.run },
          revision: job.revision,
          output: job.serializer.serialize(),
          cols: job.screen.cols,
          rows: job.screen.rows,
        })
      })
    })
  }

  detach(provider: AgentProvider, attachmentId: string): void {
    const job = this.jobs.get(provider)
    if (job?.attachmentId === terminalId(attachmentId)) this.resetAttachment(job)
  }

  detachAll(): void {
    this.attachmentEpoch++
    for (const job of this.jobs.values()) this.resetAttachment(job)
  }

  acknowledge(provider: AgentProvider, attachmentId: string, length: unknown): void {
    const job = this.jobs.get(provider)
    if (
      !job ||
      job.attachmentId !== terminalId(attachmentId) ||
      !Number.isInteger(length) ||
      Number(length) <= 0 ||
      Number(length) > job.inFlight
    )
      return
    job.inFlight -= Number(length)
    this.flow(job)
  }

  private resetAttachment(job: Job): void {
    job.attachmentId = undefined
    if (job.timer) clearTimeout(job.timer)
    job.timer = undefined
    job.pending = []
    job.inFlight = 0
    this.flow(job)
  }

  write(id: string, data: unknown, encoding: unknown = 'utf8'): void {
    const job = this.find(id)
    if (typeof data !== 'string' || data.length > 65536) throw new Error('终端输入无效。')
    if (encoding !== 'utf8' && encoding !== 'binary') throw new Error('终端输入编码无效。')
    if (encoding === 'binary' && /[\u0100-\uffff]/.test(data))
      throw new Error('终端二进制输入包含无效字节。')
    if (job.child && !job.cancelled)
      job.child.write(encoding === 'binary' ? Buffer.from(data, 'latin1') : data)
  }

  resize(id: string, cols: unknown, rows: unknown): void {
    const job = this.find(id)
    const size = dimensions(cols, rows)
    job.child?.resize(size.cols, size.rows)
    job.screen.resize(size.cols, size.rows)
  }

  async close(): Promise<void> {
    const jobs = [...this.jobs.values()].filter((job) => job.run.status === 'running')
    for (const job of jobs) {
      job.cancelled = true
      this.resetAttachment(job)
      await job.stop?.()
    }
    await Promise.allSettled(jobs.map((job) => job.done))
  }

  private find(id: string): Job {
    const job = [...this.jobs.values()].find(
      (candidateJob) => candidateJob.run.id === terminalId(id),
    )
    if (!job) throw new Error('更新终端已失效。')
    return job
  }

  private flow(job: Job): void {
    if (!job.child) return
    if (!job.paused && (job.parsing >= 128 * 1024 || job.inFlight >= 64 * 1024)) {
      job.paused = true
      job.child.pause()
    } else if (job.paused && job.parsing < 32 * 1024 && job.inFlight < 32 * 1024) {
      job.paused = false
      job.child.resume()
    }
  }

  private append(job: Job, data: string): void {
    job.parsing += data.length
    this.flow(job)
    job.screen.write(data, () => {
      job.parsing -= data.length
      job.revision++
      if (job.attachmentId) {
        job.inFlight += data.length
        job.pending.push(data)
        job.timer ??= setTimeout(() => {
          job.timer = undefined
          const output = job.pending.join('')
          job.pending = []
          if (job.attachmentId && output)
            this.publish({
              run: { ...job.run },
              revision: job.revision,
              attachmentId: job.attachmentId,
              data: output,
            })
        }, 32)
      }
      this.flow(job)
    })
  }

  private execute(
    job: Job,
    command: Parameters<ExecuteCliInstall>[0],
  ): ReturnType<ExecuteCliInstall> {
    if (job.cancelled) return Promise.reject(new Error('更新已中断。'))
    return new Promise((resolve, reject) => {
      let output = ''
      let timedOut = false
      const child = pty.spawn(command.executable, command.args, {
        name: 'xterm-256color',
        cols: job.screen.cols,
        rows: job.screen.rows,
        cwd: homedir(),
        env: { ...command.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      })
      job.child = child
      const data = child.onData((text) => {
        output = (output + text).slice(-4096)
        this.append(job, text)
      })
      let exited!: () => void
      const exitDone = new Promise<void>((complete) => {
        exited = complete
      })
      let stopping: Promise<void> | undefined
      job.stop = () =>
        (stopping ??= stopProcessTree(child.pid)
          .then(async () => {
            await exitDone
            job.child = undefined
            job.stop = undefined
            reject(new Error(timedOut ? '更新超时。' : '更新已中断。'))
          })
          .catch((error) => {
            stopping = undefined
            throw error
          }))
      const timeout = setTimeout(() => {
        timedOut = true
        job.cancelled = true
        void job.stop!().catch((error) => {
          // Keep the install lock until cleanup succeeds; quitting can retry cleanup.
          this.append(
            job,
            `\r\n更新超时，进程清理失败：${String(error)}。请退出应用以重试清理。\r\n`,
          )
        })
      }, 180000)
      const exit = child.onExit(({ exitCode, signal }) => {
        exited()
        clearTimeout(timeout)
        data.dispose()
        exit.dispose()
        if (job.cancelled) return
        job.child = undefined
        job.stop = undefined
        this.append(job, '\r\n命令已退出，正在检测 CLI…\r\n')
        if (signal) reject(new Error(`更新被信号 ${signal} 中断。`))
        else if (exitCode !== 0) reject(new Error(`更新失败，退出码 ${exitCode}。`))
        else resolve({ stdout: output, stderr: '' })
      })
    })
  }
}
