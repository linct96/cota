import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, isAbsolute } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { AgentProvider } from '../../shared/contracts'
import { isWindows, powershell } from '../platform'
import { windowsDescendants, windowsProcesses } from '../windows-processes'

export interface AgentProcessRow {
  pid: number
  parent: number
  group: number
  foreground: number
  stat: string
  started: string
  command?: string
  provider?: AgentProvider
}

export function parseAgentProcesses(stdout: string): AgentProcessRow[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})(?:\s+(.+?))?\s*$/.exec(
          line,
        )
      if (!match) throw new Error('无法识别 Agent 进程身份。')
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        foreground: Number(match[4]),
        stat: match[5],
        started: match[6],
        command: match[7],
      }
    })
}

let pending: Promise<AgentProcessRow[]> | undefined
let cached: { at: number; rows: AgentProcessRow[] } | undefined
async function processSnapshot(fresh: boolean): Promise<AgentProcessRow[]> {
  if (!fresh && cached && Date.now() - cached.at < 500) return cached.rows
  if (pending) return pending
  pending = promisify(execFile)(
    '/bin/ps',
    ['-axo', 'pid=,ppid=,pgid=,tpgid=,stat=,lstart=,comm='],
    {
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
      timeout: 1000,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
    .then(({ stdout }) => {
      const rows = parseAgentProcesses(stdout)
      cached = { at: Date.now(), rows }
      return rows
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

export function agentOwner(
  rows: AgentProcessRow[],
  rootPid: number,
  reporterPid: number,
  agentRoot = false,
): AgentProcessRow | undefined {
  if (isWindows) {
    const owned = windowsDescendants(
      rows.map((row) => ({ ...row, command: row.command || '' })),
      rootPid,
    )
    if (!owned.some((row) => row.pid === reporterPid)) return
    const root = rows.find((row) => row.pid === rootPid)
    if (!root?.started) return
    // Windows has no POSIX foreground group. Reject sibling jobs rather than guess ownership.
    const children = owned.filter(
      (row) => row.parent === rootPid && !/^(?:conhost|OpenConsole)\.exe$/i.test(row.command),
    )
    if (children.length > 1) return
    let row = rows.find((row) => row.pid === reporterPid)
    const seen = new Set<number>()
    while (row && row.pid !== rootPid && !seen.has(row.pid)) {
      seen.add(row.pid)
      if (row.parent === rootPid) return row
      row = rows.find((parent) => parent.pid === row!.parent)
    }
    return row?.pid === rootPid ? root : undefined
  }
  const byId = new Map(rows.map((row) => [row.pid, row]))
  const root = byId.get(rootPid)
  if (!root || root.foreground <= 0 || /[TZ]/.test(root.stat)) return
  let row = byId.get(reporterPid)
  const seen = new Set<number>()
  while (row && row.pid !== rootPid && !seen.has(row.pid)) {
    seen.add(row.pid)
    if (row.parent === rootPid) {
      if (/[TZ]/.test(row.stat)) return
      if (row.group === root.foreground) return row
      // Native Hooks use setsid; only an explicit foreground Agent root may own detached helpers.
      return agentRoot && root.group === root.foreground ? root : undefined
    }
    row = byId.get(row.parent)
  }
  // exec replaces the PTY shell; its foreground group still owns the same terminal.
  if (row?.pid === rootPid && root.group === root.foreground) return root
}

function nativeProvider(command = ''): AgentProvider | undefined {
  const name = basename(command).replace(/\.exe$/i, '')
  if (name === 'claude' || name === 'pi' || name === 'codex') return name
  if (/^codex-(?:aarch64|x86_64|arm64)(?:-[a-z0-9_]+)+$/.test(name)) return 'codex'
}

function nodeEntrypoint(command: string): string | undefined {
  // shortcut: ambiguous unquoted paths/Node flags stay unknown; use Hooks for custom launchers.
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command)
  const executable = match?.[1] ?? match?.[2] ?? match?.[3]
  if (executable && ['node', 'nodejs'].includes(basename(executable).replace(/\.exe$/i, '')))
    return match?.[4] ?? match?.[5] ?? match?.[6]
}

function entrypointProvider(entrypoint: string): AgentProvider | undefined {
  entrypoint = entrypoint.replaceAll('\\', '/')
  if (
    /(?:^|\/)node_modules\/@(?:earendil-works|mariozechner)\/pi-coding-agent\/dist\/(?:bundle\/)?cli\.js$/.test(
      entrypoint,
    )
  )
    return 'pi'
  if (/(?:^|\/)node_modules\/@anthropic-ai\/claude-code\/cli\.js$/.test(entrypoint)) return 'claude'
  if (/(?:^|\/)node_modules\/@openai\/codex\/bin\/codex\.js$/.test(entrypoint)) return 'codex'
}

export function recognizeNodeAgent(command: string): AgentProvider | undefined {
  const entrypoint = nodeEntrypoint(command)
  return entrypoint ? entrypointProvider(entrypoint) : undefined
}

export async function agentProcesses(
  fresh = false,
  rootPids: readonly number[] = [],
): Promise<AgentProcessRow[]> {
  if (isWindows) {
    const snapshot = await windowsProcesses(fresh)
    const rows: AgentProcessRow[] = snapshot.map((row) => ({
      ...row,
      group: row.pid,
      foreground: row.pid,
      stat: 'S',
    }))
    const owned = new Set(
      rootPids.flatMap((pid) => windowsDescendants(snapshot, pid).map((row) => row.pid)),
    )
    const wrappers = rows
      .filter((row) => owned.has(row.pid) && /^node(?:js)?\.exe$/i.test(row.command || ''))
      .slice(0, 64)
    if (wrappers.length) {
      try {
        const filter = wrappers.map((row) => `ProcessId = ${row.pid}`).join(' OR ')
        const { stdout } = await promisify(execFile)(
          powershell,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @(Get-CimInstance -ClassName Win32_Process -Filter $env:COTA_PROCESS_FILTER -Property ProcessId,ParentProcessId,CreationDate,CommandLine | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; started=$_.CreationDate.ToUniversalTime().ToString('o'); command=$_.CommandLine } }) | ConvertTo-Json -Compress",
          ],
          {
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, COTA_PROCESS_FILTER: filter },
          },
        )
        for (const current of JSON.parse(stdout.trim()) as {
          pid: number
          parent: number
          started: string
          command: string
        }[]) {
          const row = wrappers.find(
            (row) =>
              row.pid === current.pid &&
              row.parent === current.parent &&
              row.started === current.started,
          )
          if (row) row.provider = recognizeNodeAgent(current.command || '')
        }
      } catch {
        /* Missing Node entrypoint evidence leaves identity unknown. */
      }
    }
    return rows
  }
  const rows = await processSnapshot(fresh)
  const wrappers = rows
    .filter(
      (row) =>
        ['node', 'nodejs'].includes(basename(row.command || '')) &&
        !/[TZ]/.test(row.stat) &&
        row.group === row.foreground &&
        rootPids.some((pid) => agentOwner(rows, pid, row.pid)),
    )
    .slice(0, 64)
  if (!wrappers.length) return rows
  try {
    // Only inspect owned foreground Node entrypoints; never retain or publish their argv.
    const { stdout } = await promisify(execFile)(
      '/bin/ps',
      [
        '-ww',
        '-p',
        wrappers.map((row) => row.pid).join(','),
        '-o',
        'pid=,ppid=,pgid=,tpgid=,stat=,lstart=,args=',
      ],
      {
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
        timeout: 1000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    const providers = new Map<number, AgentProvider>()
    for (const current of parseAgentProcesses(stdout)) {
      const previous = wrappers.find((row) => row.pid === current.pid)
      if (
        !previous ||
        previous.started !== current.started ||
        previous.parent !== current.parent ||
        previous.group !== current.group ||
        current.foreground !== current.group ||
        /[TZ]/.test(current.stat)
      )
        continue
      const entrypoint = nodeEntrypoint(current.command || '')
      if (!entrypoint || !isAbsolute(entrypoint)) continue
      const provider =
        recognizeNodeAgent(current.command || '') ??
        entrypointProvider(await realpath(entrypoint).catch(() => ''))
      if (provider) providers.set(current.pid, provider)
    }
    return rows.map((row) =>
      wrappers.includes(row) && providers.has(row.pid)
        ? { ...row, provider: providers.get(row.pid) }
        : row,
    )
  } catch {
    // Missing argv evidence must not hide native agents or imply an existing agent exited.
    return rows
  }
}

export function foregroundAgent(
  rows: AgentProcessRow[],
  rootPid: number,
): { owner: AgentProcessRow; provider: AgentProvider } | undefined {
  const root = rows.find((row) => row.pid === rootPid)
  if (!root) return
  if (isWindows) {
    const owned = windowsDescendants(
      rows.map((row) => ({ ...row, command: row.command || '' })),
      rootPid,
    )
    const candidates = owned.flatMap((row) => {
      const original = rows.find((entry) => entry.pid === row.pid)!
      const provider = original.provider ?? nativeProvider(row.command)
      const owner = provider ? agentOwner(rows, rootPid, row.pid) : undefined
      return owner && provider ? [{ owner, provider }] : []
    })
    if (
      new Set(candidates.map(({ owner }) => owner.pid)).size === 1 &&
      new Set(candidates.map(({ provider }) => provider)).size === 1
    )
      return candidates[0]
    return
  }
  const owners = new Map<number, { owner: AgentProcessRow; provider: AgentProvider }>()
  const providers = new Set<AgentProvider>()
  for (const row of rows) {
    if (row.group !== root.foreground || /[TZ]/.test(row.stat)) continue
    const provider = row.provider ?? nativeProvider(row.command)
    if (!provider) continue
    const owner = agentOwner(rows, rootPid, row.pid)
    if (owner) {
      owners.set(owner.pid, { owner, provider })
      providers.add(provider)
    }
  }
  // Process identity never authorizes Hooks; mixed or sibling agents remain ambiguous.
  if (owners.size === 1 && providers.size === 1) return owners.values().next().value
}
