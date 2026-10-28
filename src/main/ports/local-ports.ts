import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, sep, join } from 'node:path'
import { isIP } from 'node:net'
import type {
  PortScanContext,
  WorkspacePort,
  WorkspacePortSnapshot,
} from '../../shared/workspace-ports'
import {
  readProcessSnapshot,
  processStartedAt,
  type ProcessIdentity,
} from '../system/process-snapshot'

export interface ListeningPort {
  pid: number
  address: string
  port: number
}

export function parseEndpoint(value: string): { address: string; port: number } {
  const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(value)
  const address = match?.[1] ?? match?.[2] ?? ''
  const port = Number(match?.[3])
  if (!isIP(address) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('无法识别 TCP 监听地址。')
  return { address, port }
}

export function parseLsofPorts(stdout: string): ListeningPort[] {
  const ports: ListeningPort[] = []
  let pid = 0
  let family = ''
  for (const line of stdout.split('\n')) {
    const value = line.slice(1)
    if (line[0] === 'p') {
      pid = Number(value)
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('无法识别监听进程。')
    } else if (line[0] === 'f') family = ''
    else if (line[0] === 't') family = value
    else if (line[0] === 'n') {
      if (!pid) throw new Error('监听进程信息缺失。')
      const endpoint = value.startsWith('*:')
        ? `${family === 'IPv6' ? '[::]' : '0.0.0.0'}:${value.slice(2)}`
        : value
      ports.push({ pid, ...parseEndpoint(endpoint) })
    }
  }
  return ports
}

export function parseNetstatPorts(stdout: string): ListeningPort[] {
  const ports: ListeningPort[] = []
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue
    const pid = Number(fields[4])
    if (fields.length !== 5 || !Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('无法识别 Windows TCP 监听进程。')
    ports.push({ pid, ...parseEndpoint(fields[1]) })
  }
  return ports
}

export function parseLsofDirectories(stdout: string): Map<number, string> {
  const directories = new Map<number, string>()
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    if (line[0] === 'n' && Number.isSafeInteger(pid) && pid > 0 && isAbsolute(line.slice(1)))
      directories.set(pid, line.slice(1))
  }
  return directories
}

export function portAccess(
  address: string,
  port: number,
): { connectAddress: string; httpUrl?: string } {
  // Validate even internal scan data: never turn a process-provided string into an arbitrary URL.
  parseEndpoint(`${isIP(address) === 6 ? `[${address}]` : address}:${port}`)
  const host = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '::1' : address
  const connectAddress = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`
  try {
    return { connectAddress, httpUrl: new URL(`http://${connectAddress}`).href }
  } catch {
    return { connectAddress } // Scoped IPv6 addresses can be copied but are not browser URLs.
  }
}

function stableIdentity(row: ProcessIdentity, after: Map<number, ProcessIdentity>): boolean {
  const current = after.get(row.pid)
  return (
    !!row.started &&
    current?.started === row.started &&
    current.parent === row.parent &&
    current.instance === row.instance
  )
}

function within(directory: string, root: string): boolean {
  const path = relative(root, directory)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export function attributePorts(
  listeners: ListeningPort[],
  before: ProcessIdentity[],
  after: ProcessIdentity[],
  directories: Map<number, string>,
  context: PortScanContext,
): WorkspacePort[] {
  const current = new Map(after.map((row) => [row.pid, row]))
  const stable = new Map(
    before.filter((row) => stableIdentity(row, current)).map((row) => [row.pid, row]),
  )
  const unique = new Map<string, WorkspacePort>()
  for (const listener of listeners) {
    const process = stable.get(listener.pid)
    let row = process
    let owner: WorkspacePort['owner']
    let ambiguous = false
    const seen = new Set<number>()
    while (row && !seen.has(row.pid)) {
      seen.add(row.pid)
      const matches = context.roots.filter(
        (root) =>
          root.pid === row!.pid &&
          root.started === row!.started &&
          context.workspaces.some(
            (workspace) =>
              workspace.workspaceId === root.workspaceId &&
              workspace.projectPath === root.projectPath &&
              workspace.cwd === root.cwd,
          ),
      )
      if (matches.length) {
        if (matches.length === 1) {
          const root = matches[0]
          owner = {
            projectPath: root.projectPath,
            workspaceId: root.workspaceId,
            terminalId: root.terminalId,
            evidence: 'terminal',
          }
        } else ambiguous = true
        break
      }
      const parent = stable.get(row.parent)
      if (!parent || processStartedAt(parent.started) > processStartedAt(row.started)) break
      row = parent
    }
    const cwd = process && directories.get(listener.pid)
    if (!owner && !ambiguous && cwd) {
      const candidates = context.workspaces
        .filter((workspace) => within(cwd, workspace.cwd))
        .sort((a, b) => b.cwd.length - a.cwd.length)
      const best = candidates[0]
      if (best && (candidates.length === 1 || best.cwd.length > candidates[1].cwd.length))
        owner = { projectPath: best.projectPath, workspaceId: best.workspaceId, evidence: 'cwd' }
    }
    const id = JSON.stringify([
      listener.pid,
      process?.started ?? '',
      listener.address,
      listener.port,
      process?.instance ?? process?.started ?? '',
    ])
    unique.set(id, {
      ...listener,
      id,
      processName: process ? basename(process.command) : '未知进程',
      ...portAccess(listener.address, listener.port),
      ...(owner ? { owner } : {}),
    })
  }
  return [...unique.values()].sort(
    (a, b) => a.port - b.port || a.pid - b.pid || a.address.localeCompare(b.address),
  )
}

async function lsof(args: string[], warnings: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await promisify(execFile)('/usr/sbin/lsof', args, {
      timeout: 4000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    })
    if (stderr.trim()) warnings.push('部分进程信息不可读取，结果可能不完整。')
    return stdout
  } catch (error) {
    const failure = error as { code?: number; killed?: boolean; stdout?: string; stderr?: string }
    // lsof uses exit 1 for no matches; failures must not masquerade as an empty scan.
    if (
      failure.code === 1 &&
      !failure.killed &&
      typeof failure.stdout === 'string' &&
      !failure.stderr?.trim()
    )
      return failure.stdout
    throw new Error('无法读取本机监听端口，请检查 lsof 是否可用及系统权限。')
  }
}

export async function scanLocalPorts(context: PortScanContext): Promise<WorkspacePortSnapshot> {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('端口扫描目前仅支持 macOS 和 Windows。')
  const warnings: string[] = []
  const before = await readProcessSnapshot(true)
  let listeners: ListeningPort[]
  let directories = new Map<number, string>()
  if (process.platform === 'darwin') {
    listeners = parseLsofPorts(await lsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcftn'], warnings))
    if (listeners.length) {
      try {
        const pids = [...new Set(listeners.map((row) => row.pid))]
        directories = parseLsofDirectories(
          await lsof(['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], warnings),
        )
      } catch {
        warnings.push('进程目录读取失败；无法确定归属的端口显示在“其他本地端口”。')
      }
    }
  } else {
    // shortcut: Windows has no reliable cwd snapshot here; add one only if directory inference is needed.
    warnings.push('Windows 仅按 Cota 终端进程关联工作区；外部启动的服务可能显示在“其他本地端口”。')
    const { stdout } = await promisify(execFile)(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netstat.exe'),
      ['-ano', '-p', 'tcp'],
      {
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    listeners = parseNetstatPorts(stdout)
  }
  const after = await readProcessSnapshot(true)
  const workspaces = await Promise.all(
    context.workspaces.map(async (workspace) => ({
      ...workspace,
      cwd: await realpath(workspace.cwd).catch(() => ''),
    })),
  )
  await Promise.all(
    [...directories].map(async ([pid, cwd]) => {
      const canonical = await realpath(cwd).catch(() => undefined)
      if (canonical) directories.set(pid, canonical)
      else directories.delete(pid)
    }),
  )
  const roots = await Promise.all(
    context.roots.map(async (root) => ({
      ...root,
      cwd: await realpath(root.cwd).catch(() => ''),
    })),
  )
  return {
    scannedAt: Date.now(),
    ports: attributePorts(listeners, before, after, directories, {
      workspaces: workspaces.filter((row) => row.cwd),
      roots,
    }),
    warnings: [...new Set(warnings)],
  }
}
