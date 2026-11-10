import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { GitDiff } from '../../../shared/source-control'
import { runGit, runGitBytes } from '../git-runner'
import { MAX_FILE_BYTES, filePath, literal } from './shared'

function isText(buffer: Buffer): boolean {
  return !buffer.includes(0) && isUtf8(buffer)
}

export function textDiff(original: Buffer, modified: Buffer): GitDiff {
  if ([original, modified].some((buffer) => !isText(buffer)))
    return { kind: 'unavailable', reason: '二进制或非 UTF-8 文件，不提供文本 Diff。' }
  return { kind: 'text', original: original.toString('utf8'), modified: modified.toString('utf8') }
}
export async function safeTarget(root: string, path: string): Promise<string> {
  const target = join(root, filePath(path))
  // Walk to an existing ancestor for tracked files whose whole directory was deleted.
  let parent = dirname(target)
  for (;;) {
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
    .find((candidateRecord) => candidateRecord.slice(candidateRecord.indexOf('\t') + 1) === path)
  if (!record) throw new Error('无法确认 Git 文件对象，请刷新。')
  const metadata = record.slice(0, record.indexOf('\t')).split(' ')
  if (metadata[0] === '160000') throw new Error('子模块不提供文本 Diff，请在终端查看。')
  const oid = side === 'head' ? metadata[2] : metadata[1]
  if (side === 'index' && metadata[2] !== '0')
    throw new Error('文件仍有冲突，请在编辑器或终端解决。')
  return objectBlob(root, oid)
}

async function objectBlob(root: string, oid: string): Promise<Buffer> {
  if (!/^[\da-f]{40}([\da-f]{24})?$/.test(oid)) throw new Error('无法确认 Git 文件对象，请刷新。')
  if (Number(await runGit(root, ['cat-file', '-s', oid])) > MAX_FILE_BYTES)
    throw new Error('文件超过 2 MiB，请在外部编辑器或终端查看。')
  return runGitBytes(root, ['cat-file', 'blob', oid])
}

export async function conflictDiff(root: string, path: string): Promise<GitDiff> {
  path = filePath(path)
  const output = await runGit(root, ['ls-files', '--unmerged', '-z', '--', literal(path)])
  const stages = new Map<string, { mode: string; oid: string }>()
  for (const record of output.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t')
    if (separator < 0 || record.slice(separator + 1) !== path)
      throw new Error('无法确认 Git 冲突对象，请刷新。')
    const [mode, oid, stage] = record.slice(0, separator).split(' ')
    if (!['1', '2', '3'].includes(stage) || stages.has(stage))
      throw new Error('Git 冲突阶段无效，请刷新。')
    stages.set(stage, { mode, oid })
  }
  if (!stages.size) throw new Error('文件冲突状态已改变，请刷新。')
  if ([...stages.values()].some(({ mode }) => !['100644', '100755'].includes(mode)))
    return {
      kind: 'unavailable',
      reason: '符号链接、子模块或文件类型冲突，请在外部编辑器或终端查看。',
    }
  const readStage = (stage: string) => {
    const entry = stages.get(stage)
    return entry ? objectBlob(root, entry.oid) : null
  }
  const [ours, theirs, working] = await Promise.all([
    readStage('2'),
    readStage('3'),
    workingFile(root, path),
  ])
  if ([ours, theirs, working].some((buffer) => buffer !== null && !isText(buffer)))
    return { kind: 'unavailable', reason: '二进制或非 UTF-8 文件，不提供文本 Diff。' }
  return {
    kind: 'conflict',
    ours: ours?.toString('utf8') ?? null,
    theirs: theirs?.toString('utf8') ?? null,
    working: working?.toString('utf8') ?? null,
  }
}
