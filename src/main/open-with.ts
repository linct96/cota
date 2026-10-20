import { spawn } from 'node:child_process'
import type { WorkspaceOpener } from '../shared/contracts'
import { parseArguments } from '../shared/open-with'
import { findExecutable, loginShellEnvironment } from './shell'
import { projectDirectory, workspaceOpeners } from './validation'

export async function openWorkspaceWith(path: unknown, value: WorkspaceOpener): Promise<void> {
  const [opener] = workspaceOpeners([value])
  const directory = await projectDirectory(path)
  const env = await loginShellEnvironment()
  const command = await findExecutable(opener.command, env)
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
