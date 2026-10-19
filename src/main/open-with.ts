import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceOpener } from '../shared/contracts'
import { parseArguments } from '../shared/open-with'
import { shellEnvironment } from './shell'
import { projectDirectory, workspaceOpeners } from './validation'

const execFileAsync = promisify(execFile)

export async function openWorkspaceWith(path: unknown, value: WorkspaceOpener): Promise<void> {
  const [opener] = workspaceOpeners([value])
  const directory = await projectDirectory(path)
  const env = shellEnvironment()
  // Finder-launched apps do not inherit the user's login-shell PATH.
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', 'printf \'\\0%s\\0\' "$PATH"'], {
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
  const candidates = isAbsolute(opener.command)
    ? [opener.command]
    : env.PATH.split(':')
        .filter(isAbsolute)
        .map((entry) => join(entry, opener.command))
  let command: string | undefined
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue
      await access(candidate, constants.X_OK)
      command = candidate
      break
    } catch {
      // Try the next PATH entry.
    }
  }
  if (!command)
    throw new Error(
      `找不到或无法执行 ${opener.command}。请安装其命令行工具，或在设置中填写可执行文件绝对路径。`,
    )
  const template = parseArguments(opener.arguments)
  const args = template.map((argument) => argument.replaceAll('{path}', directory))
  if (!template.some((argument) => argument.includes('{path}'))) args.push(directory)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: directory, env, detached: true, stdio: 'ignore' })
    child.once('error', (error) => reject(new Error(`无法启动 ${opener.name}：${error.message}`)))
    child.once('spawn', () => child.unref())
    child.once('exit', (code) => {
      if (code) reject(new Error(`${opener.name} 启动命令退出，状态码 ${code}。请检查启动参数。`))
      else resolve()
    })
  })
}
