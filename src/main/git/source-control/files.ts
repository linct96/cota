import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { GitDiff } from '../../../shared/source-control'
import { runGit, runGitBytes } from '../git-runner'
import { filePath, literal, MAX_FILE_BYTES } from './shared'

export function textDiff(original: Buffer, modified: Buffer): GitDiff {
  if ([original, modified].some((buffer) => buffer.includes(0) || !isUtf8(buffer)))
    return { kind: 'unavailable', reason: '二进制或非 UTF-8 文件，不提供文本 Diff。' }
  return { kind: 'text', original: original.toString('utf8'), modified: modified.toString('utf8') }
}
export async function safeTarget(root: string, path: string): Promise<string> {
  const target = join(root, filePath(path))
  // Walk to an existing ancestor for tracked files whose whole directory was deleted.
  let parent = dirname(target)
  while (true) {
    try {
      const canonical = await realpath(parent)
      const within = relative(root, canonical)
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
        throw new Error('文件的父目录位于工作树外，已拒绝访问。')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === root) throw error
      const info = await lstat(parent).catch((failure: NodeJS.ErrnoException) => {
        if (failure.code === 'ENOENT') return null
        throw failure
      })
      if (info?.isSymbolicLink()) throw new Error('文件父目录为失效的符号链接，已拒绝访问。')
      parent = dirname(parent)
    }
  }
  return target
}

export async function workingFile(
  root: string,
  path: string,
  limit = MAX_FILE_BYTES,
): Promise<Buffer | null> {
  const target = await safeTarget(root, path)
  let info
  try {
    info = await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (info.isSymbolicLink()) return Buffer.from(await readlink(target))
  if (!info.isFile()) throw new Error('此路径不是普通文件，需在终端处理。')
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const current = await handle.stat()
    if (!current.isFile()) throw new Error('文件类型已改变，请刷新。')
    if (current.size > MAX_FILE_BYTES) throw new Error('文件超过 2 MiB，请在外部编辑器或终端处理。')
    if (current.size > limit) throw new Error('文件大小已改变，请刷新。')
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_FILE_BYTES) throw new Error('文件超过 2 MiB，请在外部编辑器或终端处理。')
    if (length > limit) throw new Error('文件大小已改变，请刷新。')
    return buffer.subarray(0, length)
  } finally {
    await handle.close()
  }
}

export async function blob(
  root: string,
  path: string,
  side: 'head' | 'index',
  head: string | null,
): Promise<Buffer> {
  if (side === 'head' && !head) return Buffer.alloc(0)
  const output = await runGit(
    root,
    side === 'head'
      ? ['ls-tree', '-z', head!, '--', literal(path)]
      : ['ls-files', '--stage', '-z', '--', literal(path)],
  )
  if (!output) return Buffer.alloc(0)
  const record = output
    .split('\0')
    .find((record) => record.slice(record.indexOf('\t') + 1) === path)
  if (!record) throw new Error('无法确认 Git 文件对象，请刷新。')
  const metadata = record.slice(0, record.indexOf('\t')).split(' ')
  if (metadata[0] === '160000') throw new Error('子模块不提供文本 Diff，请在终端查看。')
  const oid = side === 'head' ? metadata[2] : metadata[1]
  if (!/^[\da-f]{40}([\da-f]{24})?$/.test(oid) || (side === 'index' && metadata[2] !== '0'))
    throw new Error('文件仍有冲突，请在编辑器或终端解决。')
  if (Number(await runGit(root, ['cat-file', '-s', oid])) > MAX_FILE_BYTES)
    throw new Error('文件超过 2 MiB，请在外部编辑器或终端查看。')
  return runGitBytes(root, ['cat-file', 'blob', oid])
}
