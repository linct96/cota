import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_FILES = 5000
export const STATS_BUDGET_MS = 500
export const OID = /^[\da-f]{40}([\da-f]{24})?$/
export const hash = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')
export const literal = (path: string): string => `:(top,literal)${path}`

export function filePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    value.includes('\0') ||
    isAbsolute(value) ||
    value
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
  )
    throw new Error('文件路径无效。')
  return value
}

export const HISTORY_PAGE = 50
