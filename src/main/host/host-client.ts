import { connect, type Socket } from 'node:net'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HOST_PROTOCOL, readMessages, sendMessage, type HostMethods } from './host-protocol'
import type { AgentUpdate, TerminalEvent } from '../../shared/contracts'
import { hostEndpoint, isWindows, powershell, removeEndpoint } from '../system/platform'
import { stopProcessTree } from '../system/process-tree'

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
    private readonly sendAgent: (event: AgentUpdate) => void = () => {},
    readonly pid?: number,
  ) {
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      this.sendAgent({ type: 'disconnected' })
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
      if (message.type === 'agent') {
        this.sendAgent(message.event)
        return
      }
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
    const terminalId = method === 'close' ? (args as HostMethods['close']['args'])[0] : undefined
    const attachmentId = terminalId ? this.attachments.get(terminalId) : undefined
    // Main requests close only after any required user confirmation.
    if (terminalId) this.send({ type: 'closing', id: terminalId, attachmentId, closing: true })
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
    }).catch((error) => {
      if (terminalId) this.send({ type: 'closing', id: terminalId, attachmentId, closing: false })
      throw error
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
  if (isWindows) return join(userData, 'terminal-host')
  const hash = createHash('sha256').update(userData).digest('hex').slice(0, 16)
  return join(tmpdir(), `cota-${process.getuid!()}-${hash}`)
}

async function openClient(
  directory: string,
  info: HostInfo,
  send: (event: TerminalEvent) => void,
  sendAgent: (event: AgentUpdate) => void,
): Promise<HostClient> {
  const socket = connect(hostEndpoint(directory, 'host'))
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
  const client = new HostClient(socket, send, sendAgent, info.pid)
  try {
    await client.request('hello', [info.token, HOST_PROTOCOL])
    return client
  } catch (error) {
    client.disconnect()
    throw error
  }
}

async function privateHostDirectory(userData: string): Promise<string> {
  const directory = hostDirectory(userData)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryStat = await lstat(directory)
  if (
    !directoryStat.isDirectory() ||
    (!isWindows &&
      (directoryStat.uid !== process.getuid!() || (directoryStat.mode & 0o777) !== 0o700))
  )
    throw new Error('Terminal Host 目录权限不安全。')
  if (isWindows) {
    // Use .NET directly: inherited PowerShell module paths can break Set-Acl autoloading.
    await promisify(execFile)(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true,$false); $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($env:COTA_PRIVATE_DIRECTORY,$acl)",
      ],
      {
        windowsHide: true,
        timeout: 5000,
        env: { ...process.env, COTA_PRIVATE_DIRECTORY: directory },
      },
    )
  }
  return directory
}

async function readHostInfo(directory: string): Promise<HostInfo | undefined> {
  const file = join(directory, 'runtime.json')
  try {
    const fileStat = await lstat(file)
    if (
      !fileStat.isFile() ||
      (!isWindows && (fileStat.uid !== process.getuid!() || (fileStat.mode & 0o777) !== 0o600)) ||
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
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

// A failed tree cleanup may have orphaned children; a dead root alone cannot prove success.
const incompleteHostCleanup = new Set<string>()

export async function forceStopTerminalHost(userData: string): Promise<void> {
  const directory = await privateHostDirectory(userData)
  const info = await readHostInfo(directory)
  if (!info) {
    if (incompleteHostCleanup.has(directory))
      throw new Error('后台任务曾清理失败，无法确认残留进程已结束；应用暂未关闭。')
    if (!isWindows)
      for (const name of ['host', 'agent'] as const) {
        try {
          await lstat(hostEndpoint(directory, name))
          throw new Error('Terminal Host 缺少元数据，无法安全确认后台进程；应用暂未关闭。')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    return
  }
  if (info.pid <= 1 || info.pid === process.pid) throw new Error('Terminal Host 进程标识无效。')
  let running = true
  try {
    process.kill(info.pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    running = false
  }
  if (!running && incompleteHostCleanup.has(directory))
    throw new Error('后台任务曾清理失败，无法确认残留进程已结束；应用暂未关闭。')
  if (running) {
    // Verify the exact executable and Host entrypoint before trusting a possibly reused PID.
    const { stdout } = isWindows
      ? await promisify(execFile)(
          powershell,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:COTA_HOST_PID)).CommandLine",
          ],
          {
            windowsHide: true,
            timeout: 5000,
            env: { ...process.env, COTA_HOST_PID: String(info.pid) },
          },
        )
      : await promisify(execFile)('/bin/ps', ['-p', String(info.pid), '-o', 'command='], {
          timeout: 2000,
        })
    const script = join(__dirname, 'host.js')
    const commands = isWindows
      ? [
          `${process.execPath} ${script}`,
          `"${process.execPath}" ${script}`,
          `${process.execPath} "${script}"`,
          `"${process.execPath}" "${script}"`,
        ].map((command) => command.toLowerCase())
      : [`${process.execPath} ${script}`]
    if (!commands.includes(isWindows ? stdout.trim().toLowerCase() : stdout.trim()))
      throw new Error('Terminal Host 进程身份不匹配，未终止未知进程；应用暂未关闭。')
    incompleteHostCleanup.add(directory)
    await stopProcessTree(info.pid)
    try {
      process.kill(info.pid, 0)
      throw new Error('Terminal Host 尚未结束；应用暂未关闭，请重试。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    incompleteHostCleanup.delete(directory)
  }
  const current = await readHostInfo(directory)
  if (current && (current.pid !== info.pid || current.token !== info.token))
    throw new Error('Terminal Host 已变化，应用暂未关闭，请重试。')
  await removeEndpoint(hostEndpoint(directory, 'host'))
  await removeEndpoint(hostEndpoint(directory, 'agent'))
  await unlink(join(directory, 'runtime.json')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export async function connectTerminalHost(
  userData: string,
  send: (event: TerminalEvent) => void,
  sendAgent: (event: AgentUpdate) => void = () => {},
): Promise<HostClient> {
  const directory = await privateHostDirectory(userData)
  const file = join(directory, 'runtime.json')
  let info = await readHostInfo(directory)
  if (info) {
    if (info.version === HOST_PROTOCOL) {
      try {
        return await openClient(directory, info, send, sendAgent)
      } catch (error) {
        if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || ''))
          throw error
      }
    }
    try {
      process.kill(info.pid, 0)
      throw new Error(
        info.version !== HOST_PROTOCOL
          ? 'Terminal Host 协议版本不兼容，请先结束旧会话。'
          : 'Terminal Host 仍在运行但暂不可连接；请稍后重试，不会重建或终止已有会话。',
      )
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError
    }
    await unlink(join(directory, 'host.sock')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await unlink(join(directory, 'agent.sock')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await unlink(file)
  }
  for (const endpoint of ['host.sock', 'agent.sock']) {
    try {
      await lstat(join(directory, endpoint))
      throw new Error('Terminal Host 端点存在但缺少元数据；不会覆盖未知的会话。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const token = randomBytes(32).toString('hex')
  // shortcut: uses the current Electron runtime; signed stable Helper packaging is required before cross-update survival.
  const child = spawn(process.execPath, [join(__dirname, 'host.js')], {
    detached: true,
    windowsHide: true,
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
      return await openClient(directory, info, send, sendAgent)
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Terminal Host 启动失败；未重建已有会话。')
}
