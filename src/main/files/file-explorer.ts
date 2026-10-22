import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, open, opendir, readlink, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { FileEntry, FilePreview } from '../../shared/file-explorer'
import { runGitBytes } from '../git/git-runner'
import type { FileExplorerPreferences } from '../../shared/contracts'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 10000
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function explorerPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    /[\0\\:]/.test(value) ||
    isAbsolute(value) ||
    (value !== '' &&
      value
        .split('/')
        .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))
  )
    throw new Error('文件路径无效。')
  return value
}

export class FileExplorerService {
  constructor(
    private readonly options: () => FileExplorerPreferences = () => ({
      showIgnored: true,
      followSymlinks: false,
    }),
  ) {}

  async location(root: string, value: unknown, allowLink = true): Promise<string> {
    const path = explorerPath(value)
    if ((await realpath(root)) !== root) throw new Error('工作区真实路径已改变，请重新选择工作区。')
    let target = root
    const parts = path ? path.split('/') : []
    const ancestors = new Set([root])
    if (parts.length > 128) throw new Error('目录层级过深。')
    for (const [index, part] of parts.entries()) {
      target = join(target, part)
      const info = await lstat(target)
      if (info.isSymbolicLink()) {
        if (allowLink && index === parts.length - 1) break
        if (!this.options().followSymlinks) throw new Error('不跟随符号链接目录，请在设置中开启。')
        if (!(await stat(target)).isDirectory()) throw new Error('仅允许跟随符号链接目录。')
      }
      const canonical = await realpath(target)
      const within = relative(root, canonical)
      if (
        within === '..' ||
        within.startsWith(`..${sep}`) ||
        isAbsolute(within) ||
        (!this.options().followSymlinks && canonical !== target) ||
        within.split(sep).some((part) => part.toLowerCase() === '.git')
      )
        throw new Error('文件真实路径已改变或位于工作区外，已拒绝访问。')
      if (ancestors.has(canonical)) throw new Error('符号链接指向上级目录，已阻止循环访问。')
      ancestors.add(canonical)
      target = canonical
    }
    return target
  }

  async list(root: string, value: unknown): Promise<FileEntry[]> {
    const path = explorerPath(value)
    const target = await this.location(root, path, false)
    const before = await lstat(target)
    if (!before.isDirectory()) throw new Error('此路径不是目录，请刷新文件树。')
    const directory = await opendir(target)
    const entries: FileEntry[] = []
    let count = 0
    for await (const entry of directory) {
      if (++count > MAX_DIRECTORY_ENTRIES)
        throw new Error('目录超过 10,000 项，请在终端或外部编辑器中查看。')
      if (entry.name.toLowerCase() === '.git') continue
      entries.push({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        kind: entry.isSymbolicLink()
          ? 'link'
          : entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : 'other',
      })
      if (entry.isSymbolicLink() && this.options().followSymlinks) {
        const listed = entries[entries.length - 1]!
        try {
          const linked = await this.location(root, listed.path, false)
          if ((await stat(linked)).isDirectory()) {
            listed.kind = 'directory'
            listed.symlink = true
          }
        } catch {
          /* Broken, external, and cyclic links remain inspectable as links. */
        }
      }
    }
    if (entries.length) {
      const names = entries.map(
        (entry) => entry.name + (entry.kind === 'directory' && !entry.symlink ? '/' : ''),
      )
      // Ignore styling is optional: ordinary folders and unavailable Git must remain browsable.
      const output = await runGitBytes(
        target,
        ['check-ignore', '-z', '--stdin'],
        false,
        2000,
        names.join('\0') + '\0',
      ).catch(() => Buffer.alloc(0))
      const ignored = new Set(output.toString('utf8').split('\0'))
      for (const [index, entry] of entries.entries()) {
        if (ignored.has(names[index])) entry.ignored = true
      }
    }
    await this.location(root, path, false)
    const after = await lstat(target)
    if (before.ino !== after.ino || before.dev !== after.dev)
      throw new Error('目录在读取期间被替换，请刷新。')
    return entries
      .filter((entry) => this.options().showIgnored || !entry.ignored)
      .sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          names.compare(a.name, b.name) ||
          a.name.localeCompare(b.name),
      )
  }

  async read(root: string, value: unknown): Promise<FilePreview> {
    const path = explorerPath(value)
    if (!path) throw new Error('请选择文件。')
    const target = await this.location(root, path)
    const before = await lstat(target)
    if (before.isSymbolicLink()) return { kind: 'link', target: await readlink(target) }
    if (!before.isFile()) return { kind: 'unavailable', reason: '不是普通文件，不提供文本预览。' }
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev)
        throw new Error('文件类型或路径已改变，请刷新。')
      if (info.size > MAX_FILE_BYTES)
        return { kind: 'unavailable', reason: '文件超过 2 MiB，请在终端或外部编辑器中查看。' }
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      await this.location(root, path, false)
      const after = await lstat(target)
      if (after.ino !== info.ino || after.dev !== info.dev)
        throw new Error('文件在读取期间被替换，请刷新。')
      if (length > MAX_FILE_BYTES)
        return { kind: 'unavailable', reason: '文件超过 2 MiB，请在终端或外部编辑器中查看。' }
      const content = buffer.subarray(0, length)
      if (content.includes(0) || !isUtf8(content))
        return { kind: 'unavailable', reason: '二进制或非 UTF-8 文件，不提供文本预览。' }
      return { kind: 'text', content: content.toString('utf8') }
    } finally {
      await handle.close()
    }
  }
}
