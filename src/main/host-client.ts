import { connect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HOST_PROTOCOL, readMessages, sendMessage, type HostMethods } from './host-protocol'
import type { TerminalEvent } from '../shared/contracts'

export class HostClient {
  private nextId = 0
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private attachments = new Map<string, string>()
  private attachmentEpoch = 0

  constructor(
    private readonly socket: Socket,
    private readonly send: (event: TerminalEvent) => void,
  ) {
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('Terminal Host 连接已断开；请重新打开应用以重连。'))
      }
      this.pending.clear()
      for (const [id, attachmentId] of this.attachments)
        this.send({
          type: 'error',
          id,
          attachmentId,
          error: 'Terminal Host 连接已断开；会话不会自动重建，请重新打开应用以重连。',
        })
      this.attachments.clear()
    })
    readMessages(socket, (message) => {
      if (message.type === 'event') {
        this.send(message.event)
        return
      }
      if (
        message.type !== 'response' ||
        !Number.isSafeInteger(message.id) ||
        typeof message.ok !== 'boolean'
      ) {
        socket.destroy()
        return
      }
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.ok) request.resolve(message.value)
      else request.reject(new Error(message.error || 'Terminal Host 操作失败。'))
    })
  }

  async request<K extends keyof HostMethods>(
    method: K,
    args: HostMethods[K]['args'],
  ): Promise<HostMethods[K]['value']> {
    const epoch = this.attachmentEpoch
    const id = ++this.nextId
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Terminal Host 请求超时：${method}；未自动重建会话。`))
        this.socket.destroy()
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        sendMessage(this.socket, { type: 'request', id, method, args })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
    if (method === 'attach') {
      const options = args as HostMethods['attach']['args']
      if (this.socket.destroyed) throw new Error('Terminal Host 连接已断开。')
      if (epoch !== this.attachmentEpoch) {
        await this.request('detach', [options[0].id, options[0].attachmentId])
        throw new Error('终端视图已断开。')
      }
      this.attachments.set(options[0].id, options[0].attachmentId)
    } else if (method === 'detach') {
      const [id, attachmentId] = args as HostMethods['detach']['args']
      if (this.attachments.get(id) === attachmentId) this.attachments.delete(id)
    } else if (method === 'close')
      this.attachments.delete((args as HostMethods['close']['args'])[0])
    return value as HostMethods[K]['value']
  }

  async detachAll(): Promise<void> {
    this.attachmentEpoch++
    await Promise.all(
      [...this.attachments].map(([id, attachmentId]) => this.request('detach', [id, attachmentId])),
    )
  }

  disconnect(): void {
    this.attachmentEpoch++
    this.attachments.clear()
    this.socket.destroy()
  }
}

interface HostInfo {
  pid: number
  token: string
  version: number
}

export function hostDirectory(userData: string): string {
  const hash = createHash('sha256').update(userData).digest('hex').slice(0, 16)
  return join(tmpdir(), `cota-${process.getuid!()}-${hash}`)
}

async function openClient(
  directory: string,
  info: HostInfo,
  send: (event: TerminalEvent) => void,
): Promise<HostClient> {
  const socket = connect(join(directory, 'host.sock'))
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Terminal Host 连接超时。'))
    }, 3000)
    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.removeListener('error', fail)
      resolve()
    })
    const fail = (error: Error) => {
      clearTimeout(timeout)
      reject(error)
    }
    socket.once('error', fail)
  })
  const client = new HostClient(socket, send)
  try {
    await client.request('hello', [info.token, HOST_PROTOCOL])
    return client
  } catch (error) {
    client.disconnect()
    throw error
  }
}

export async function connectTerminalHost(
  userData: string,
  send: (event: TerminalEvent) => void,
): Promise<HostClient> {
  const directory = hostDirectory(userData)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryStat = await lstat(directory)
  if (
    !directoryStat.isDirectory() ||
    directoryStat.uid !== process.getuid!() ||
    (directoryStat.mode & 0o777) !== 0o700
  )
    throw new Error('Terminal Host 目录权限不安全。')
  const file = join(directory, 'runtime.json')
  let info: HostInfo | undefined
  try {
    const fileStat = await lstat(file)
    if (
      !fileStat.isFile() ||
      fileStat.uid !== process.getuid!() ||
      (fileStat.mode & 0o777) !== 0o600 ||
      fileStat.size > 4096
    )
      throw new Error('Terminal Host 元数据权限或大小无效。')
    const value = JSON.parse(await readFile(file, 'utf8')) as HostInfo
    if (
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.token)
    )
      throw new Error('Terminal Host 元数据无效。')
    if (value.version !== HOST_PROTOCOL)
      throw new Error('Terminal Host 协议版本不兼容，请先结束旧会话。')
    info = value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (info) {
    try {
      return await openClient(directory, info, send)
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error
      try {
        process.kill(info.pid, 0)
        throw new Error('Terminal Host 仍在运行但暂不可连接；请稍后重试，不会重建或终止已有会话。')
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError
      }
      await unlink(join(directory, 'host.sock')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      await unlink(file)
    }
  }
  try {
    await lstat(join(directory, 'host.sock'))
    throw new Error('Terminal Host 端点存在但缺少元数据；不会覆盖未知的会话。')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const token = randomBytes(32).toString('hex')
  // shortcut: uses the current Electron runtime; signed stable Helper packaging is required before cross-update survival.
  const child = spawn(process.execPath, [join(__dirname, 'host.js')], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      COTA_HOST_DIRECTORY: directory,
      COTA_HOST_TOKEN: token,
    },
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  info = { pid: child.pid!, token, version: HOST_PROTOCOL }
  try {
    await writeFile(file, JSON.stringify(info), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await openClient(directory, info, send)
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Terminal Host 启动失败；未重建已有会话。')
}
