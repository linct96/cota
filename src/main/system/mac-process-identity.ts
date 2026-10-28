import { createRequire } from 'node:module'

const requireNative = createRequire(__filename)
let readIdentity: ((pid: number) => MacProcessIdentity | undefined) | undefined

interface MacProcessIdentity {
  started: string
  uid: number
  system: boolean
}

// proc_bsdinfo supplies microseconds, unlike ps's second-resolution lstart field.
export function macProcessIdentity(pid: number): MacProcessIdentity | undefined {
  readIdentity ??= createIdentityReader()
  return readIdentity(pid)
}

function createIdentityReader(): (pid: number) => MacProcessIdentity | undefined {
  const koffi = requireNative('koffi') as typeof import('koffi')
  const library = koffi.load('/usr/lib/libproc.dylib')
  const info = library.func(
    'int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int size)',
  )
  return (pid) => {
    const buffer = Buffer.alloc(136) // sizeof(struct proc_bsdinfo), macOS arm64/x64
    if (info(pid, 3, 0, buffer, buffer.length) !== buffer.length) return undefined // PROC_PIDTBSDINFO
    return {
      started: `${buffer.readBigUInt64LE(120)}:${buffer.readBigUInt64LE(128)}`,
      uid: buffer.readUInt32LE(20),
      system: !!(buffer.readUInt32LE(0) & 1),
    }
  }
}
