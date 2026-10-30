import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

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
