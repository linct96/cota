import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Preferences } from '../shared/contracts'

export function absolutePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.includes('\0') ||
    value.length > 4096
  ) {
    throw new Error('请输入不带命令参数的可执行文件或目录绝对路径。')
  }
  return value
}

export async function projectDirectory(value: unknown): Promise<string> {
  const path = absolutePath(value)
  try {
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory')
    await access(canonical, constants.R_OK | constants.X_OK)
    return canonical
  } catch {
    throw new Error(`项目目录不可访问，可能已移动或删除：${path}`)
  }
}

export async function executable(value: unknown): Promise<string> {
  const path = absolutePath(value)
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a file')
    await access(path, constants.X_OK)
    return path
  } catch {
    throw new Error(`Shell 不存在或不可执行：${path}`)
  }
}

export function preferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('设置格式无效。')
  const { shellPath, scrollback } = value as Partial<Preferences>
  if (shellPath !== null) absolutePath(shellPath)
  if (!Number.isInteger(scrollback) || scrollback! < 1000 || scrollback! > 20000) {
    throw new Error('Scrollback 必须是 1,000–20,000 之间的整数。')
  }
  return { shellPath: shellPath as string | null, scrollback: scrollback! }
}

export function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new Error('终端标识无效。')
  }
  return value
}

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 1000 ||
    Number(rows) < 1 ||
    Number(rows) > 500
  ) {
    throw new Error('终端尺寸无效。')
  }
  return { cols: Number(cols), rows: Number(rows) }
}
