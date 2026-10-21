import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { Preferences } from '../../shared/contracts'
import { executable } from '../validation'
import { isWindows, powershell } from './platform'

export async function resolveShell(settings: Pick<Preferences, 'shellPath'>): Promise<string> {
  if (settings.shellPath) return executable(settings.shellPath)
  if (isWindows) {
    const installed = join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'PowerShell',
      '7',
      'pwsh.exe',
    )
    try {
      return await executable(installed)
    } catch {
      /* A per-user installation may be on PATH. */
    }
    try {
      const candidate = await findExecutable('pwsh.exe', shellEnvironment())
      // App execution aliases launch another process outside the PTY's owned process tree.
      if (!/[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(candidate)) return candidate
    } catch {
      /* PowerShell 7 is optional. */
    }
    return executable(powershell)
  }
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
      env[isWindows && key.toUpperCase() === 'PATH' ? 'PATH' : key] = value
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Cota' }
}

export async function loginShellEnvironment(
  settings: Pick<Preferences, 'shellPath'> = { shellPath: null },
): Promise<Record<string, string>> {
  const env = shellEnvironment()
  if (isWindows) return env
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
    : (env.PATH || '')
        .split(delimiter)
        .map((entry) => entry.replace(/^"|"$/g, ''))
        .filter(isAbsolute)
        .flatMap((entry) =>
          isWindows && !/\.(?:exe|com|cmd|bat)$/i.test(command)
            ? ['.exe', '.com', '.cmd', '.bat', ''].map((extension) =>
                join(entry, command + extension),
              )
            : [join(entry, command)],
        )
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

export function shellArguments(path: string): string[] {
  if (!isWindows) return ['-il']
  const name = basename(path).toLowerCase()
  if (name === 'powershell.exe' || name === 'pwsh.exe') return ['-NoLogo']
  if (name === 'cmd.exe') return ['/d']
  if (['bash.exe', 'zsh.exe', 'fish.exe'].includes(name)) return ['-il']
  return []
}

// Resolve known Node CLI shims to their actual entrypoint, with no cmd.exe string evaluation.
export async function resolveCommand(path: string, args: string[], env: Record<string, string>) {
  if (!isWindows || !/\.(cmd|bat)$/i.test(path)) return { executable: path, args, env }
  const source = await readFile(path, 'utf8')
  const matches = [...source.matchAll(/"%(?:~dp0|dp0%|basedir%)([^"\r\n]+\.js)"/gi)]
  for (const match of matches) {
    const entry = resolve(dirname(path), match[1])
    if (!(await stat(entry).catch(() => undefined))?.isFile()) continue
    const binary = /"%~dp0([^"\r\n]+\.exe)"/i.exec(source)
    const runtime = binary
      ? resolve(dirname(path), binary[1])
      : await findExecutable('node.exe', env)
    return {
      executable: runtime,
      args: [entry, ...args],
      env: binary ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
    }
  }
  throw new Error(`无法安全解析 Windows 启动脚本：${path}。请使用程序的 .exe 可执行文件。`)
}
