import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { Result, WorkspaceTarget } from '../../shared/contracts'
import type {
  PortScanContext,
  WorkspacePort,
  WorkspacePortSnapshot,
} from '../../shared/workspace-ports'

export function requireOwnedPort(
  snapshot: WorkspacePortSnapshot,
  target: WorkspaceTarget,
  id: unknown,
  protectedPids: number[],
): WorkspacePort {
  if (typeof id !== 'string' || !id || id.length > 512) throw new Error('端口标识无效。')
  const port = snapshot.ports.find((row) => row.id === id)
  if (!port) throw new Error('端口已不在监听或进程身份已变化，请刷新后重试。')
  if (
    port.owner?.projectPath !== target.projectPath ||
    port.owner.workspaceId !== target.workspaceId
  )
    throw new Error('只能关闭当前工作区的端口。')
  if (!Number.isSafeInteger(port.pid) || port.pid <= 1 || protectedPids.includes(port.pid))
    throw new Error('不允许终止 Cota 或系统关键进程。')
  if (
    snapshot.ports.some(
      (row) =>
        row.pid === port.pid &&
        row.owner &&
        (row.owner.projectPath !== target.projectPath ||
          row.owner.workspaceId !== target.workspaceId),
    )
  )
    throw new Error('此进程还关联了其他工作区，请在对应终端中手动停止。')
  return port
}

export class WorkspacePorts {
  private pending?: Promise<WorkspacePortSnapshot>
  private cached?: WorkspacePortSnapshot
  private cancel?: () => void

  constructor(private readonly context: () => Promise<PortScanContext>) {}

  scan(fresh = false): Promise<WorkspacePortSnapshot> {
    if (this.pending) return fresh ? this.pending.then(() => this.scan(true)) : this.pending
    if (!fresh && this.cached && Date.now() - this.cached.scannedAt < 1000)
      return Promise.resolve(this.cached)
    this.pending = this.context()
      .then((context) => this.run(context))
      .then((snapshot) => {
        this.cached = snapshot
        return snapshot
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  private run(context: PortScanContext): Promise<WorkspacePortSnapshot> {
    return new Promise((resolve, reject) => {
      const directory = __dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
      const worker = new Worker(join(directory, 'port-scanner.js'), { workerData: context })
      const timer = setTimeout(() => finish(new Error('端口扫描超时，请重试。')), 15000)
      const finish = (error?: Error, snapshot?: WorkspacePortSnapshot) => {
        clearTimeout(timer)
        this.cancel = undefined
        worker.removeAllListeners()
        void worker.terminate()
        if (error) reject(error)
        else resolve(snapshot!)
      }
      this.cancel = () => finish(new Error('端口扫描已取消。'))
      worker.once('message', (result: Result<WorkspacePortSnapshot>) => {
        if (result.ok) finish(undefined, result.value)
        else finish(new Error(result.error))
      })
      worker.once('error', (error) =>
        finish(error instanceof Error ? error : new Error('端口扫描进程失败。')),
      )
      worker.once('exit', () => finish(new Error('端口扫描进程已结束，请重试。')))
    })
  }

  async httpUrl(id: unknown): Promise<string> {
    if (typeof id !== 'string' || id.length > 512) throw new Error('端口标识无效。')
    const port = (await this.scan(true)).ports.find((row) => row.id === id)
    if (!port?.httpUrl) throw new Error('端口已不在监听或地址无法由浏览器打开，请刷新。')
    return port.httpUrl
  }

  invalidate(): void {
    this.cached = undefined
  }

  dispose(): void {
    this.cancel?.()
    this.cached = undefined
  }
}
