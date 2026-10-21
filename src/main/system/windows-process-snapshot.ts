import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { WindowsProcess } from './windows-processes'

const requireNative = createRequire(__filename)
let readSnapshot: (() => WindowsProcess[]) | undefined

// Toolhelp32 enumerates identities without launching PowerShell or reading command lines.
// Koffi ships Node-API prebuilds, so this also works in the standalone Terminal Host.
export function nativeWindowsProcesses(): WindowsProcess[] {
  readSnapshot ??= createSnapshotReader()
  return readSnapshot()
}

function createSnapshotReader(): () => WindowsProcess[] {
  const koffi = requireNative('koffi') as typeof import('koffi')
  const kernel = koffi.load(
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'kernel32.dll'),
  )
  const entryType = koffi.struct('CotaProcessEntry', {
    size: 'uint32_t',
    usage: 'uint32_t',
    pid: 'uint32_t',
    heap: 'uintptr_t',
    module: 'uint32_t',
    threads: 'uint32_t',
    parent: 'uint32_t',
    priority: 'int32_t',
    flags: 'uint32_t',
    name: koffi.array('uint16_t', 260),
  })
  koffi.struct('CotaFileTime', { low: 'uint32_t', high: 'uint32_t' })
  const snapshot = kernel.func(
    'void * __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)',
  )
  const first = kernel.func(
    'int __stdcall Process32FirstW(void *handle, _Inout_ CotaProcessEntry *entry)',
  )
  const next = kernel.func(
    'int __stdcall Process32NextW(void *handle, _Inout_ CotaProcessEntry *entry)',
  )
  const open = kernel.func(
    'void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)',
  )
  const times = kernel.func(
    'int __stdcall GetProcessTimes(void *handle, _Out_ CotaFileTime *creation, _Out_ CotaFileTime *exit, _Out_ CotaFileTime *kernel, _Out_ CotaFileTime *user)',
  )
  const close = kernel.func('int __stdcall CloseHandle(void *handle)')
  const lastError = kernel.func('uint32_t __stdcall GetLastError()')

  const started = (pid: number): string => {
    const handle = open(0x1000, 0, pid) // PROCESS_QUERY_LIMITED_INFORMATION
    if (!handle) return '' // Protected or already-exited processes have no usable identity.
    try {
      const creation = { low: 0, high: 0 }
      if (!times(handle, creation, {}, {}, {})) return ''
      const ticks = (BigInt(creation.high) << 32n) | BigInt(creation.low)
      if (!ticks) return ''
      const date = new Date(Number(ticks / 10000n - 11644473600000n))
      // Match CIM's UTC round-trip format and microsecond precision for agent identity checks.
      const fraction = (((ticks % 10000000n) / 10n) * 10n).toString().padStart(7, '0')
      return date.toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`)
    } finally {
      close(handle)
    }
  }

  return () => {
    const handle = snapshot(2, 0) // TH32CS_SNAPPROCESS
    if (!handle || BigInt.asIntN(koffi.sizeof('void *') * 8, handle) === -1n)
      throw new Error('无法创建 Windows 进程快照。')
    try {
      const entry = { size: koffi.sizeof(entryType), pid: 0, parent: 0, name: [] as number[] }
      if (!first(handle, entry)) throw new Error('无法读取 Windows 进程快照。')
      const rows: WindowsProcess[] = []
      do {
        if (entry.pid === 0) continue
        const end = entry.name.indexOf(0)
        rows.push({
          pid: entry.pid,
          parent: entry.parent,
          command: String.fromCharCode(...entry.name.slice(0, end < 0 ? undefined : end)),
          started: started(entry.pid),
        })
      } while (next(handle, entry))
      if (lastError() !== 18) throw new Error('Windows 进程快照读取不完整。') // ERROR_NO_MORE_FILES
      return rows
    } finally {
      close(handle)
    }
  }
}
