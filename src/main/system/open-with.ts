import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Preferences, WorkspaceOpener } from '../../shared/contracts'
import { parseArguments, withSystemFileManager } from '../../shared/open-with'
import { findExecutable, loginShellEnvironment, resolveCommand } from './shell'
import { projectDirectory, workspaceOpeners } from '../validation'

async function resolveOpener(opener: WorkspaceOpener, env: Record<string, string>) {
  const commands = opener.command === 'zed' ? ['zed', 'zeditor'] : [opener.command]
  let failure: unknown
  for (const command of commands) {
    try {
      return { command: await findExecutable(command, env) }
    } catch (error) {
      failure = error
    }
  }
  if (process.platform === 'darwin' && ['code', 'zed'].includes(opener.command)) {
    const name = opener.command === 'code' ? 'Visual Studio Code.app' : 'Zed.app'
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      const application = join(root, name)
      if ((await stat(application).catch(() => undefined))?.isDirectory())
        return { command: '/usr/bin/open', application }
    }
  }
  if (process.platform === 'win32' && opener.command === 'code') {
    for (const root of [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
      process.env.ProgramFiles,
    ]) {
      if (!root) continue
      try {
        return { command: await findExecutable(join(root, 'Microsoft VS Code', 'Code.exe'), env) }
      } catch {
        // Try the next standard installation location.
      }
    }
  }
  throw failure
}

export function listWorkspaceOpeners(settings: Preferences): WorkspaceOpener[] {
  return withSystemFileManager(settings.openWith, process.platform)
}

export async function openWorkspaceWith(path: unknown, value: WorkspaceOpener): Promise<void> {
  const [opener] = workspaceOpeners([value])
  const directory = await projectDirectory(path)
  const env = await loginShellEnvironment()
  const { command, application } = await resolveOpener(opener, env)
  const template = parseArguments(opener.arguments)
  const args = template.map((argument) => argument.replaceAll('{path}', directory))
  if (!template.some((argument) => argument.includes('{path}'))) args.push(directory)
  const launch = await resolveCommand(
    command,
    application ? ['-a', application, directory, '--args', ...args] : args,
    env,
  )
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(launch.executable, launch.args, {
      cwd: directory,
      env: launch.env,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 ${opener.name}：${error.message}`))
    })
    child.once('spawn', () => {
      child.unref()
      // Native editor processes can stay alive for the entire editing session.
      timer = setTimeout(resolve, 300)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code) reject(new Error(`${opener.name} 启动命令退出，状态码 ${code}。请检查启动参数。`))
      else resolve()
    })
  })
}
