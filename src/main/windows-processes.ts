import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powershell } from './platform'
import { nativeWindowsProcesses } from './windows-process-snapshot'

export interface WindowsProcess {
  pid: number
  parent: number
  command: string
  started: string
}

let pending: Promise<WindowsProcess[]> | undefined
let cached: { at: number; rows: WindowsProcess[] } | undefined
let nativeAvailable = true

// Query identity only. User prompts and other process command lines are never read here.
export async function windowsProcesses(fresh = false): Promise<WindowsProcess[]> {
  if (!fresh && cached && Date.now() - cached.at < 500) return cached.rows
  if (pending) return pending
  pending = Promise.resolve()
    .then(async () => {
      if (nativeAvailable) {
        try {
          return nativeWindowsProcesses()
        } catch (error) {
          nativeAvailable = false
          console.warn('Windows 原生进程查询不可用，回退到 PowerShell。', error)
        }
      }
      return queryWindowsProcesses()
    })
    .then((rows) => {
      cached = { at: Date.now(), rows }
      return rows
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

async function queryWindowsProcesses(): Promise<WindowsProcess[]> {
  const { stdout } = await promisify(execFile)(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; command=$_.Name; started=if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' } } }) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  )
  const rows = JSON.parse(stdout.trim()) as WindowsProcess[]
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.pid) ||
        !Number.isSafeInteger(row.parent) ||
        typeof row.command !== 'string' ||
        typeof row.started !== 'string',
    )
  )
    throw new Error('无法识别 Windows 进程状态。')
  return rows
}

export function windowsDescendants(rows: WindowsProcess[], pid: number): WindowsProcess[] {
  const owned = new Set([pid])
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  let count = 0
  while (count !== owned.size) {
    count = owned.size
    for (const row of rows) {
      const parent = byPid.get(row.parent)
      if (owned.has(row.parent) && parent?.started && row.started >= parent.started)
        owned.add(row.pid)
    }
  }
  return rows.filter((row) => owned.has(row.pid))
}
