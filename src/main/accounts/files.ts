import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lock } from 'proper-lockfile'

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`无法读取 ${path}。`, { cause: error })
  }
}

export async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export interface AccountFileChange {
  path: string
  before: string | null
  after: string | null
}

// Account switches may update both auth and config. Roll back completed writes on failure.
export async function applyAccountFiles(
  changes: AccountFileChange[],
  assertLocked: () => void = () => {},
): Promise<void> {
  for (const change of changes) {
    if ((await readOptional(change.path)) !== change.before)
      throw new Error('认证文件已被其他程序修改，请刷新后重试。')
  }
  const applied: AccountFileChange[] = []
  try {
    for (const change of changes) {
      if ((await readOptional(change.path)) !== change.before)
        throw new Error('认证文件已被其他程序修改，请刷新后重试。')
      assertLocked()
      if (change.after === null)
        await unlink(change.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      else await writePrivate(change.path, change.after)
      applied.push(change)
    }
  } catch (error) {
    const failures: string[] = []
    for (const change of applied.reverse()) {
      try {
        if ((await readOptional(change.path)) !== change.after) throw new Error()
        assertLocked()
        if (change.before === null) await unlink(change.path)
        else await writePrivate(change.path, change.before)
      } catch {
        failures.push(change.path)
      }
    }
    if (failures.length)
      throw new Error(`切换失败，以下文件无法恢复，请检查：${failures.join('、')}`, {
        cause: error,
      })
    throw error
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
export function parseObject(content: string, name = '认证信息'): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`${name} 不是有效的 JSON，已停止操作。`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} 必须是 JSON 对象。`)
  return value as Record<string, unknown>
}

export function jwtClaims(token: unknown): Record<string, unknown> {
  try {
    return object(JSON.parse(Buffer.from(text(token).split('.')[1], 'base64url').toString('utf8')))
  } catch {
    return {}
  }
}

export async function withPiAuthLock<T>(
  path: string,
  action: (assertLocked: () => void) => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let compromised: Error | undefined
  let released = false
  let release: () => Promise<void>
  try {
    release = await lock(path, {
      realpath: false,
      // Pi uses proper-lockfile too; keep the heartbeat below its 10-second sync stale limit.
      stale: 30_000,
      update: 4_000,
      onCompromised: (error) => {
        compromised = error
      },
    })
  } catch (error) {
    throw new Error(
      (error as NodeJS.ErrnoException).code === 'ELOCKED'
        ? 'Pi 正在更新认证信息，请稍后再切换账号。'
        : '无法锁定 Pi 认证信息，请检查目录权限。',
      { cause: error },
    )
  }
  const assertLocked = () => {
    if (compromised || released)
      throw new Error('Pi 认证锁已失效，已停止操作，请刷新后重试。', { cause: compromised })
  }
  try {
    const result = await action(assertLocked)
    assertLocked()
    return result
  } finally {
    released = true
    if (!compromised) await release()
  }
}
