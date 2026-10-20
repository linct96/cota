import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { Preferences } from '../shared/contracts'
import { executable } from './validation'

export async function resolveShell(settings: Pick<Preferences, 'shellPath'>): Promise<string> {
  if (settings.shellPath) return executable(settings.shellPath)
  const candidate = process.env.SHELL
  if (candidate) {
    try {
      return await executable(candidate)
    } catch {
      /* Fall back to the macOS default. */
    }
  }
  return executable('/bin/zsh')
}

export function shellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !key.startsWith('ELECTRON_') &&
      !key.startsWith('COTA_') &&
      key !== 'NODE_OPTIONS' &&
      key !== 'NODE_CHANNEL_FD'
    )
      env[key] = value
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Cota' }
}

export async function loginShellEnvironment(
  settings: Pick<Preferences, 'shellPath'> = { shellPath: null },
): Promise<Record<string, string>> {
  const env = shellEnvironment()
  try {
    const shell = await resolveShell(settings)
    const { stdout } = await promisify(execFile)(shell, ['-ilc', 'printf \'\\0%s\\0\' "$PATH"'], {
      cwd: homedir(),
      env,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    })
    env.PATH = stdout.split('\0')[1] || env.PATH
  } catch {
    // Standard install locations remain usable if shell initialization fails.
  }
  env.PATH = [env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    .filter(Boolean)
    .join(':')
  return env
}

export async function findExecutable(
  command: string,
  env: Record<string, string>,
): Promise<string> {
  const candidates = isAbsolute(command)
    ? [command]
    : env.PATH.split(':')
        .filter(isAbsolute)
        .map((entry) => join(entry, command))
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`找不到或无法执行 ${command}。请安装其命令行工具，并检查登录 Shell 的 PATH。`)
}
