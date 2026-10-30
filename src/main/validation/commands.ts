import { isAbsolute } from 'node:path'
import type { WorkspaceOpener, QuickCommand } from '../../shared/contracts'
import { parseArguments } from '../../shared/open-with'
import { absolutePath } from './paths'

export function workspaceOpeners(value: unknown): WorkspaceOpener[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('打开方式最多配置 50 项。')
  const openers = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('打开方式格式无效。')
    const { id, name, command, arguments: args } = entry as Partial<WorkspaceOpener>
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('打开方式标识无效。')
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\0\r\n]/.test(name))
      throw new Error('请输入程序名称（上限 80 字符）。')
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 4096 ||
      /[\0\r\n]/.test(command) ||
      (!isAbsolute(command.trim()) && !/^[\w.+-]+$/.test(command.trim()))
    )
      throw new Error('启动命令需为命令名或可执行文件绝对路径，请将参数单独填写。')
    if (typeof args !== 'string' || args.length > 4096 || args.includes('\0'))
      throw new Error('启动参数无效（上限 4096 字符）。')
    parseArguments(args)
    return { id, name: name.trim(), command: command.trim(), arguments: args }
  })
  if (new Set(openers.map((entry) => entry.id)).size !== openers.length)
    throw new Error('打开方式标识重复。')
  return openers
}

export function startupCommand(value: unknown): string | undefined {
  if (value === undefined) return
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 8192 ||
    // oxlint-disable-next-line no-control-regex -- Allow line breaks and tabs, not terminal escape sequences.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    throw new Error('请输入 Shell 命令（上限 8192 字符，不能包含控制字符）。')
  return value.replace(/\r\n?/g, '\n')
}

export function savedQuickCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('快捷命令最多配置 50 项。')
  const commands = value.map((entry: unknown): QuickCommand => {
    if (!entry || typeof entry !== 'object') throw new Error('快捷命令格式无效。')
    const { id, name, command, scope, mode, port } = entry as Partial<QuickCommand>
    if (mode !== undefined && mode !== 'task' && mode !== 'service')
      throw new Error('快捷命令运行类型无效。')
    if (
      port !== undefined &&
      (mode !== 'service' ||
        (port !== 'auto' &&
          (!Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535)))
    )
      throw new Error('服务端口须为 auto 或 1024–65535 的整数。')
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('快捷命令标识无效。')
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\0\r\n]/.test(name))
      throw new Error('请输入命令名称（上限 80 字符，不能包含换行）。')
    const text = startupCommand(command)
    if (text === undefined) throw new Error('请输入 Shell 命令。')
    if (!scope || (scope.type !== 'global' && scope.type !== 'project'))
      throw new Error('快捷命令作用域无效。')
    return {
      id,
      name: name.trim(),
      command: text,
      ...(mode ? { mode } : {}),
      ...(port !== undefined ? { port } : {}),
      scope:
        scope.type === 'global'
          ? { type: 'global' }
          : { type: 'project', projectPath: absolutePath(scope.projectPath) },
    }
  })
  if (new Set(commands.map((entry) => entry.id)).size !== commands.length)
    throw new Error('快捷命令标识重复。')
  return commands
}
