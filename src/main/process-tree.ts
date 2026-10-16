import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

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

export async function stopProcessTree(pid: number): Promise<void> {
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
