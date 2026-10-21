import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { isWindows } from './platform'
import { join } from 'node:path'
import { windowsProcesses, windowsDescendants } from './windows-processes'

const exec = promisify(execFile)

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

export async function hasRunningJob(pid: number, shell: string): Promise<boolean> {
  if (isWindows) {
    const rows = await windowsProcesses(true)
    const root = rows.find((row) => row.pid === pid)
    if (!root) throw new Error('无法读取终端进程状态。')
    return (
      root.command.toLowerCase() !== basename(shell).toLowerCase() ||
      windowsDescendants(rows, pid).some(
        (row) => row.pid !== pid && !/^(?:conhost|OpenConsole)\.exe$/i.test(row.command),
      )
    )
  }
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,stat=,comm='], {
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const processes = stdout
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)
      if (!match) throw new Error('无法识别终端进程状态。')
      return { pid: Number(match[1]), parent: Number(match[2]), stat: match[3], command: match[4] }
    })
  const root = processes.find((process) => process.pid === pid)
  if (!root) throw new Error('无法读取终端进程状态。')
  // shortcut: pure shell builtins have no child process; precise prompt detection needs shell integration.
  return (
    basename(root.command).replace(/^-/, '') !== basename(shell) ||
    processes.some((process) => process.parent === pid && !process.stat.includes('Z'))
  )
}

export async function stopProcessTree(pid: number): Promise<void> {
  if (isWindows) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid)
      throw new Error('终端进程标识无效。')
    if (!alive(pid)) return
    const targets = windowsDescendants(await windowsProcesses(true), pid)
    await exec(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(pid), '/t', '/f'],
      { windowsHide: true, timeout: 5000 },
    ).catch((error) => {
      if (alive(pid)) throw error
    })
    for (let attempt = 0; attempt < 20 && targets.some((row) => alive(row.pid)); attempt++)
      await delay(50)
    if (targets.some((row) => alive(row.pid)))
      throw new Error(`终端进程 ${pid} 或子进程无法结束，请重试。`)
    return
  }
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid='], { maxBuffer: 4 * 1024 * 1024 })
  const processes = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
  const owned = new Set([pid])
  let count = 0
  while (count !== owned.size) {
    count = owned.size
    for (const [child, parent] of processes) if (owned.has(parent)) owned.add(child)
  }
  // Foreground jobs can have their own process group; include descendants, not only -pid.
  const targets = [...owned].reverse()
  for (const target of targets) signal(target, 'SIGHUP')
  signal(-pid, 'SIGHUP')
  for (let attempt = 0; attempt < 10 && targets.some(alive); attempt++) await delay(50)
  for (const target of targets) if (alive(target)) signal(target, 'SIGKILL')
  signal(-pid, 'SIGKILL')
  for (let attempt = 0; attempt < 20 && targets.some(alive); attempt++) await delay(50)
  if (alive(pid)) throw new Error(`终端进程 ${pid} 无法结束，请重试。`)
}
