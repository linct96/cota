import { createHash } from 'node:crypto'
import { chmod, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const isWindows = process.platform === 'win32'
export const powershell = join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

export function hostEndpoint(directory: string, name: 'host' | 'agent'): string {
  if (!isWindows) return join(directory, `${name}.sock`)
  const hash = createHash('sha256').update(directory.toLowerCase()).digest('hex')
  return `\\\\.\\pipe\\cota-${hash}-${name}`
}

export async function protectEndpoint(path: string): Promise<void> {
  if (!isWindows) await chmod(path, 0o600)
}

export async function removeEndpoint(path: string): Promise<void> {
  if (isWindows) return // Named pipes disappear when their server closes.
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}
