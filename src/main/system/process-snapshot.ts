import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isWindows } from './platform'
import { macProcessIdentity } from './mac-process-identity'
import { windowsProcesses, type WindowsProcess } from './windows-processes'

export type ProcessIdentity = WindowsProcess & { instance?: string }

export function parseProcessSnapshot(stdout: string): ProcessIdentity[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(line)
      if (!match) throw new Error('无法识别端口进程身份。')
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        started: match[3],
        command: match[4],
      }
    })
}

export async function readProcessSnapshot(withInstance = false): Promise<ProcessIdentity[]> {
  if (isWindows) return windowsProcesses(true)
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,comm='], {
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const rows = parseProcessSnapshot(stdout)
  if (!withInstance) return rows
  return rows.map((row) => ({ ...row, instance: macProcessIdentity(row.pid)?.started ?? '' }))
}

export function processStartedAt(started: string): number {
  return Date.parse(/^\d{4}-/.test(started) ? started : `${started} UTC`)
}
