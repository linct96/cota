import { createHash } from 'node:crypto'
import type { CommitMessageContext } from '../../shared/commit-message'
import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, open, readlink, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type {
  GitChange,
  GitDiff,
  GitFileSelection,
  GitDiffSelection,
  GitReviewSelection,
  GitComparison,
  GitCompareRequest,
  GitReferences,
  GitHistory,
  GitHistoryRequest,
  GitRemoteMutation,
  GitTracking,
  GitMutation,
  GitStatus,
} from '../../shared/source-control'
import { GitService } from './git-worktrees'
import { runGit, runGitBytes, WorktreeError } from './git-runner'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 5000
const STATS_BUDGET_MS = 500
const OID = /^[\da-f]{40}([\da-f]{24})?$/
const HISTORY_PAGE = 50

function textDiff(original: Buffer, modified: Buffer): GitDiff {
  if ([original, modified].some((buffer) => buffer.includes(0) || !isUtf8(buffer)))
    return { kind: 'unavailable', reason: '二进制或非 UTF-8 文件，不提供文本 Diff。' }
  return { kind: 'text', original: original.toString('utf8'), modified: modified.toString('utf8') }
}
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const literal = (path: string): string => `:(top,literal)${path}`

function filePath(value: unknown): string {
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

function fields(record: string, count: number): [string[], string] {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const end = record.indexOf(' ', start)
    if (end < 0) throw new Error('Git 状态格式无效。')
    parts.push(record.slice(start, end))
    start = end + 1
  }
  return [parts, filePath(record.slice(start))]
}

export function parseGitStatus(output: string): Omit<GitStatus, 'rootPath' | 'indexVersion'> {
  const result: Omit<GitStatus, 'rootPath' | 'indexVersion'> = {
    branch: null,
    head: null,
    ahead: 0,
    behind: 0,
    entries: [],
  }
  if (output && !output.endsWith('\0')) throw new Error('Git 状态读取不完整。')
  const records = output.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    if (record.startsWith('# branch.head ')) {
      const branch = record.slice(14)
      result.branch = branch === '(detached)' ? null : branch
    } else if (record.startsWith('# branch.oid ')) {
      const oid = record.slice(13)
      result.head = oid === '(initial)' ? null : oid
    } else if (record.startsWith('# branch.upstream ')) result.upstream = record.slice(18)
    else if (record.startsWith('# branch.ab ')) {
      const match = /^# branch.ab \+(\d+) -(\d+)$/.exec(record)
      if (!match) throw new Error('Git 分支状态格式无效。')
      result.ahead = Number(match[1])
      result.behind = Number(match[2])
    } else if (record.startsWith('? ')) {
      const directory = record.endsWith('/')
      result.entries.push({
        path: filePath(directory ? record.slice(2, -1) : record.slice(2)),
        area: 'untracked',
        status: '?',
        submodule: directory,
      })
    } else if (/^[12u] /.test(record)) {
      const [parts, path] = fields(record, record[0] === '1' ? 8 : record[0] === '2' ? 9 : 10)
      const xy = parts[1]
      if (!/^[.MADRCUT?!]{2}$/.test(xy)) throw new Error('Git 文件状态格式无效。')
      const submodule = parts[2] !== 'N...'
      const oldPath = record[0] === '2' ? filePath(records[++i]) : undefined
      if (record[0] === 'u') result.entries.push({ path, area: 'conflict', status: xy, submodule })
      else {
        if (xy[0] !== '.')
          result.entries.push({ path, oldPath, area: 'staged', status: xy[0], submodule })
        if (xy[1] !== '.')
          result.entries.push({
            path,
            oldPath: xy[1] === 'R' ? oldPath : undefined,
            area: 'unstaged',
            status: xy[1],
            submodule,
          })
      }
    } else if (!record.startsWith('# ')) throw new Error('Git 状态格式无效。')
    if (result.entries.length > MAX_FILES)
      throw new Error('变更超过 5,000 项，请先在终端缩小范围后刷新。')
  }
  return result
}

function explain(error: unknown): Error {
  if (error instanceof WorktreeError && error.cause && typeof error.cause === 'object') {
    const cause = error.cause as { stderr?: Buffer; stdout?: Buffer; killed?: boolean }
    if (cause.killed)
      return new Error('Git 操作超时，结果可能已生效。请刷新核对后再操作，不要直接重复提交。')
    const detail = (cause.stderr?.toString() || cause.stdout?.toString())?.trim().slice(0, 8000)
    if (detail) return new Error(`${error.message}\n${detail}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

export class SourceControlService {
  private readonly git = new GitService()

  async commitMessageContext(cwd: string, indexVersion: string): Promise<CommitMessageContext> {
    const status = await this.status(cwd)
    this.checkCommitMessageStatus(status, indexVersion)
    let patch = ''
    try {
      patch = await runGit(status.rootPath, [
        'diff',
        '--cached',
        '--patch',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--submodule=short',
        '--find-renames',
        '--',
      ])
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      if (
        !cause ||
        typeof cause !== 'object' ||
        !('code' in cause) ||
        cause.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      )
        throw error
    }
    const context = {
      rootPath: status.rootPath,
      branch: status.branch,
      indexVersion: status.indexVersion,
      summary: status.entries
        .filter((entry) => entry.area === 'staged')
        .map(
          (entry) =>
            `${entry.status}\t${JSON.stringify(entry.path)}${entry.oldPath ? ` (from ${JSON.stringify(entry.oldPath)})` : ''}`,
        )
        .join('\n'),
      patch,
    }
    await this.validateCommitMessageContext(cwd, context)
    return context
  }

  async validateCommitMessageContext(cwd: string, context: CommitMessageContext): Promise<void> {
    const status = await this.status(cwd)
    this.checkCommitMessageStatus(status, context.indexVersion)
    if (status.rootPath !== context.rootPath || status.branch !== context.branch)
      throw new Error('工作目录或分支已改变，请刷新后重新生成提交信息。')
  }

  private checkCommitMessageStatus(status: GitStatus, indexVersion: string): void {
    if (status.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('请先解决所有合并冲突。')
    if (!status.entries.some((entry) => entry.area === 'staged'))
      throw new Error('没有已暂存的更改。')
    if (status.indexVersion !== indexVersion)
      throw new Error('暂存区或 HEAD 已改变，请刷新后重新生成提交信息。')
  }

  async status(cwd: string, includeStats = false): Promise<GitStatus> {
    try {
      const repository = await this.git.requireRepository(cwd)
      const rootPath = repository.rootPath
      const raw = await runGitBytes(rootPath, [
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ])
      if (!isUtf8(raw)) throw new Error('仓库包含非 UTF-8 文件名，请在终端处理这些路径。')
      const status = parseGitStatus(raw.toString('utf8'))
      const result = {
        ...status,
        rootPath,
        tracking: await this.tracking(rootPath, status.branch),
        indexVersion: await this.indexVersion(rootPath, status.head),
      }
      if (includeStats) await this.fileStats(rootPath, result.entries)
      return result
    } catch (error) {
      throw explain(error)
    }
  }

  private async fileStats(root: string, entries: GitChange[]): Promise<void> {
    // Optional counts must not hold the status read lock for slow diffs.
    const deadline = performance.now() + STATS_BUDGET_MS
    for (const area of ['staged', 'unstaged'] as const) {
      const files = entries.filter((entry) => entry.area === area && !entry.submodule)
      if (!files.length) continue
      const timeout = Math.ceil(deadline - performance.now())
      if (timeout <= 0) return
      try {
        const raw = await runGitBytes(
          root,
          [
            'diff',
            '--numstat',
            '-z',
            '--no-ext-diff',
            '--no-textconv',
            '--ignore-submodules=all',
            '--find-renames',
            ...(area === 'staged' ? ['--cached'] : []),
            '--',
          ],
          false,
          timeout,
        )
        if (!isUtf8(raw) || (raw.length && raw.at(-1) !== 0))
          throw new Error('Git 行数统计格式无效。')
        const records = raw.toString('utf8').split('\0')
        const stats = new Map<string, GitChange['stats']>()
        for (let i = 0; i < records.length; i++) {
          if (performance.now() >= deadline) return
          if (!records[i]) continue
          const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(records[i])
          if (!match) throw new Error('Git 行数统计格式无效。')
          let path = match[3]
          if (!path) {
            filePath(records[++i])
            path = records[++i]
          }
          const counts =
            match[1] === '-' && match[2] === '-'
              ? null
              : { additions: Number(match[1]), deletions: Number(match[2]) }
          if (
            counts &&
            !Object.values(counts).every((count) => Number.isSafeInteger(count) && count >= 0)
          )
            throw new Error('Git 行数统计格式无效。')
          stats.set(filePath(path), counts)
        }
        for (const entry of files) entry.stats = stats.get(entry.path)
      } catch {
        // Counts are optional display data; a failed diff must not hide the valid Git status.
      }
    }
    // shortcut: untracked counts read at most 8 MiB per refresh; use on-demand counts for larger trees.
    let remaining = 8 * 1024 * 1024
    for (const entry of entries) {
      if (performance.now() >= deadline) break
      if (entry.area !== 'untracked' || entry.submodule || remaining <= 0) continue
      try {
        const info = await lstat(await this.safeTarget(root, entry.path))
        if (info.size > Math.min(MAX_FILE_BYTES, remaining)) continue
        const bytes = await this.workingFile(root, entry.path, info.size)
        if (!bytes) continue
        remaining -= bytes.length
        if (bytes.includes(0) || !isUtf8(bytes)) entry.stats = null
        else {
          let lines = bytes.length && bytes.at(-1) !== 10 ? 1 : 0
          for (const byte of bytes) if (byte === 10) lines++
          entry.stats = { additions: lines, deletions: 0 }
        }
      } catch {
        // Files can disappear or change type while a terminal or Agent edits them.
      }
    }
  }

  private async tracking(root: string, branch: string | null): Promise<GitTracking | undefined> {
    if (!branch) return undefined
    const raw = await runGit(root, [
      'for-each-ref',
      '--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)',
      `refs/heads/${branch}`,
    ])
    const record = raw
      .split('\n')
      .map((line) => line.split('\0'))
      .find(([ref]) => ref === `refs/heads/${branch}`)
    if (!record?.[1] || !record[2]?.startsWith('refs/heads/')) return undefined
    return { remote: record[1], branch: record[2].slice(11) }
  }

  async references(cwd: string): Promise<GitReferences> {
    try {
      const { rootPath } = await this.git.requireRepository(cwd)
      const remotes = (await runGit(rootPath, ['remote'])).split('\n').filter(Boolean)
      const raw = await runGitBytes(rootPath, [
        'for-each-ref',
        '--format=%(refname)%00%(symref)',
        'refs/heads/',
        'refs/remotes/',
      ])
      if (!isUtf8(raw)) throw new Error('分支名称不是 UTF-8，请在终端处理。')
      const worktrees = await this.git.listWorktrees(rootPath)
      const branches = raw
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((record) => record.split('\0'))
        .filter(([, symbolic]) => !symbolic)
        .map(([ref]) => ({
          ref,
          label: ref.replace(/^refs\/(heads|remotes)\//, ''),
          worktreePath: worktrees.find(
            (entry) => entry.branch !== null && `refs/heads/${entry.branch}` === ref,
          )?.path,
        }))
      if (branches.length > 5000 || remotes.length > 100)
        throw new Error('引用过多，请在终端处理。')
      return { remotes, branches }
    } catch (error) {
      throw explain(error)
    }
  }

  private async resolveCommit(root: string, ref: string): Promise<string> {
    const oid = (
      await runGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    ).trim()
    if (!OID.test(oid)) throw new Error('Git 提交标识无效。')
    return oid
  }

  private async checkedCommit(root: string, value: unknown): Promise<string> {
    if (typeof value !== 'string' || !OID.test(value)) throw new Error('请提供完整的提交标识。')
    return this.resolveCommit(root, value)
  }

  async history(cwd: string, request: GitHistoryRequest = {}): Promise<GitHistory> {
    try {
      if (!request || typeof request !== 'object') throw new Error('历史查询参数无效。')
      const offset = request.offset ?? 0
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= 10000 ||
        (offset > 0 && !request.head)
      )
        throw new Error('历史分页无效（上限 10,000 条），请在终端查看更早记录。')
      const { rootPath } = await this.git.requireRepository(cwd)
      let head: string
      if (request.head !== undefined) head = await this.checkedCommit(rootPath, request.head)
      else {
        const current = await runGit(rootPath, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(
          (error) => {
            if (error instanceof WorktreeError && (error.cause as { code?: number })?.code === 1)
              return ''
            throw error
          },
        )
        if (!current.trim()) return { head: null, commits: [], more: false }
        head = await this.checkedCommit(rootPath, current.trim())
      }
      const raw = await runGitBytes(rootPath, [
        'log',
        '-z',
        '--no-show-signature',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        `--max-count=${HISTORY_PAGE + 1}`,
        `--skip=${offset}`,
        head,
        '--',
      ])
      if (!isUtf8(raw)) throw new Error('提交信息不是 UTF-8，请在终端查看历史。')
      const fields = raw.toString('utf8').split('\0')
      if (fields.pop() !== '' || fields.length % 5) throw new Error('提交历史格式无效。')
      const commits = []
      for (let i = 0; i < fields.length; i += 5) {
        const [oid, parentList, author, date, subject] = fields.slice(i, i + 5)
        const parents = parentList ? parentList.split(' ') : []
        if (
          !OID.test(oid) ||
          parents.some((parent) => !OID.test(parent)) ||
          !Number.isFinite(Date.parse(date))
        )
          throw new Error('提交历史格式无效。')
        commits.push({ oid, parents, author, date, subject })
      }
      return {
        head,
        commits: commits.slice(0, HISTORY_PAGE),
        more: offset + HISTORY_PAGE < 10000 && commits.length > HISTORY_PAGE,
      }
    } catch (error) {
      throw explain(error)
    }
  }

  async compare(cwd: string, request: GitCompareRequest): Promise<GitComparison> {
    try {
      if (!request || typeof request !== 'object') throw new Error('比较查询参数无效。')
      const { rootPath } = await this.git.requireRepository(cwd)
      let head: string, base: string | null, label: string
      if (request.kind === 'commit') {
        head = await this.checkedCommit(rootPath, request.commit)
        const parents = (await runGit(rootPath, ['rev-list', '--parents', '-n', '1', head, '--']))
          .trim()
          .split(' ')
        base = parents[1] || null
        label = `${head.slice(0, 8)} · ${base ? '相对第一父提交' : '首次提交'}`
      } else if (request.kind === 'branch') {
        if (
          typeof request.ref !== 'string' ||
          request.ref.length > 4096 ||
          !/^refs\/(heads|remotes)\//.test(request.ref) ||
          /[\0\r\n]/.test(request.ref)
        )
          throw new Error('请选择明确的本地或远端分支引用。')
        await runGit(rootPath, ['check-ref-format', request.ref])
        head = await this.resolveCommit(rootPath, 'HEAD')
        const tip = await this.resolveCommit(rootPath, request.ref)
        base = (
          await runGit(rootPath, ['merge-base', tip, head]).catch((error) => {
            if (error instanceof WorktreeError && (error.cause as { code?: number })?.code === 1)
              throw new Error('分支没有共同祖先（或浅克隆缺少历史），请在终端处理。')
            throw error
          })
        ).trim()
        if (!OID.test(base)) throw new Error('共同祖先标识无效。')
        label = `${request.ref.replace(/^refs\/(heads|remotes)\//, '')} · 共同祖先 → HEAD`
      } else throw new Error('不支持的比较方式。')
      const options = ['--raw', '-z', '-r', '--no-abbrev', '--no-ext-diff', '--no-textconv', '-M']
      const raw = await runGitBytes(
        rootPath,
        base
          ? ['diff', ...options, base, head, '--']
          : ['diff-tree', '--root', '--no-commit-id', ...options, head, '--'],
      )
      if (!isUtf8(raw)) throw new Error('仓库包含非 UTF-8 文件名，请在终端查看。')
      const records = raw.toString('utf8').split('\0')
      if (records.pop() !== '') throw new Error('Git 比较结果不完整。')
      const entries = []
      for (let i = 0; i < records.length;) {
        const metadata = /^:(\d{6}) (\d{6}) ([\da-f]+) ([\da-f]+) ([ADMT]|[RC]\d+)$/.exec(
          records[i++],
        )
        if (!metadata || !OID.test(metadata[3]) || !OID.test(metadata[4]))
          throw new Error('Git 比较格式无效。')
        const first = filePath(records[i++])
        const renamed = /^[RC]/.test(metadata[5])
        const path = renamed ? filePath(records[i++]) : first
        entries.push({
          path,
          oldPath: renamed ? first : undefined,
          status: metadata[5][0],
          submodule: metadata[1] === '160000' || metadata[2] === '160000',
        })
        if (entries.length > MAX_FILES) throw new Error('比较超过 5,000 项，请在终端缩小范围。')
      }
      return { base, head, label, entries }
    } catch (error) {
      throw explain(error)
    }
  }

  private async indexVersion(root: string, head: string | null): Promise<string> {
    return hash(
      Buffer.concat([
        Buffer.from(head || 'unborn'),
        await runGitBytes(root, ['ls-files', '--stage', '-z']),
      ]),
    )
  }

  private select(status: GitStatus, values: unknown): GitChange[] {
    if (!Array.isArray(values) || !values.length || values.length > MAX_FILES)
      throw new Error('请选择要操作的文件。')
    const selected = values.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('文件选择无效。')
      const selection = value as GitFileSelection
      const path = filePath(selection.path)
      const entry = status.entries.find(
        (entry) => entry.path === path && entry.area === selection.area,
      )
      if (!entry) throw new Error('文件状态已改变，请刷新后重新选择。')
      return entry
    })
    return [...new Map(selected.map((entry) => [`${entry.area}:${entry.path}`, entry])).values()]
  }

  private async safeTarget(root: string, path: string): Promise<string> {
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

  private async workingFile(
    root: string,
    path: string,
    limit = MAX_FILE_BYTES,
  ): Promise<Buffer | null> {
    const target = await this.safeTarget(root, path)
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
      if (current.size > MAX_FILE_BYTES)
        throw new Error('文件超过 2 MiB，请在外部编辑器或终端处理。')
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

  private async blob(
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

  private async reviewDiff(cwd: string, selection: GitReviewSelection): Promise<GitDiff> {
    const { rootPath } = await this.git.requireRepository(cwd)
    const head = await this.checkedCommit(rootPath, selection.head)
    const base = selection.base === null ? null : await this.checkedCommit(rootPath, selection.base)
    const path = filePath(selection.path)
    const oldPath = selection.oldPath === undefined ? path : filePath(selection.oldPath)
    if (selection.submodule)
      return { kind: 'unavailable', reason: '子模块不提供文本 Diff，请在终端查看。' }
    return textDiff(
      await this.blob(rootPath, oldPath, 'head', base),
      await this.blob(rootPath, path, 'head', head),
    )
  }

  async diff(cwd: string, selection: GitDiffSelection): Promise<GitDiff> {
    try {
      if (selection.area === 'review') return await this.reviewDiff(cwd, selection)
      const status = await this.status(cwd)
      const [entry] = this.select(status, [selection])
      if (entry.submodule)
        return { kind: 'unavailable', reason: '子模块变更请在外部编辑器或终端查看。' }
      if (entry.area === 'conflict')
        return {
          kind: 'unavailable',
          reason: '文件存在合并冲突。请在外部编辑器解决，之后暂存以标记已解决。',
        }
      const original =
        entry.area === 'untracked'
          ? Buffer.alloc(0)
          : await this.blob(
              status.rootPath,
              entry.oldPath || entry.path,
              entry.area === 'staged' ? 'head' : 'index',
              status.head,
            )
      const modified =
        entry.area === 'staged'
          ? await this.blob(status.rootPath, entry.path, 'index', status.head)
          : await this.workingFile(status.rootPath, entry.path)
      if (modified === null && entry.status !== 'D') throw new Error('文件已移除，请刷新状态。')
      const right = modified || Buffer.alloc(0)
      return textDiff(original, right)
    } catch (error) {
      throw explain(error)
    }
  }

  private async mutateRemote(
    cwd: string,
    status: GitStatus,
    input: GitRemoteMutation,
  ): Promise<boolean> {
    const remote =
      input.action === 'fetch' || input.action === 'publish' ? input.remote : input.tracking?.remote
    const references = await this.references(cwd)
    if (typeof remote !== 'string' || !references.remotes.includes(remote))
      throw new Error('请选择仓库中已配置的远端；本地上游请使用终端。')
    const root = status.rootPath
    await runGit(root, ['check-ref-format', `refs/remotes/${remote}/cota-check`])
    if (input.action === 'fetch') {
      // An empty refmap disables Git's implicit updates from configured fetch mappings.
      await runGit(
        root,
        [
          'fetch',
          '--refmap=',
          '--no-tags',
          '--no-prune',
          '--no-prune-tags',
          '--no-recurse-submodules',
          '--',
          remote,
          `+refs/heads/*:refs/remotes/${remote}/*`,
        ],
        true,
      )
      return true
    }
    const verify = (current: GitStatus) => {
      if (
        !current.branch ||
        !current.head ||
        current.branch !== input.branch ||
        current.head !== input.head
      )
        throw new Error('分支或 HEAD 已改变，请刷新后重试。')
      if (input.action === 'publish') {
        if (current.tracking || current.upstream)
          throw new Error('分支已有上游，请使用推送而非重新发布。')
      } else if (
        !current.tracking ||
        current.tracking.remote !== input.tracking?.remote ||
        current.tracking.branch !== input.tracking?.branch
      )
        throw new Error('上游配置已改变，请刷新后重试。')
    }
    verify(status)
    const branch = input.action === 'publish' ? status.branch! : input.tracking.branch
    await runGit(root, ['check-ref-format', `refs/heads/${branch}`])
    if (input.action === 'pull' || input.action === 'sync') {
      if (status.entries.some((entry) => entry.area === 'conflict'))
        throw new Error('请先解决现有合并冲突，再拉取或同步；不会自动 stash。')
      const upstream = `refs/remotes/${remote}/${branch}`
      await runGit(
        root,
        [
          'fetch',
          '--refmap=',
          '--no-tags',
          '--no-prune',
          '--no-prune-tags',
          '--no-recurse-submodules',
          '--',
          remote,
          `+refs/heads/${branch}:${upstream}`,
        ],
        true,
      )
      const tip = await this.resolveCommit(root, upstream)
      const current = await this.status(cwd)
      verify(current)
      if (current.entries.some((entry) => entry.area === 'conflict'))
        throw new Error('获取期间出现合并冲突，仅完成 Fetch，未更新工作文件。')
      try {
        await runGit(
          root,
          [
            '-c',
            'merge.autoStash=false',
            'merge',
            input.action === 'sync' ? '--ff' : '--ff-only',
            '--commit',
            '--no-squash',
            '--no-autostash',
            '--no-overwrite-ignore',
            '--no-edit',
            tip,
          ],
          true,
        )
      } catch (error) {
        if (input.action === 'sync')
          throw new Error(
            `拉取合并未完成，未执行推送。如有冲突，请在编辑器或终端解决。\n${explain(error).message}`,
          )
        throw error
      }
      if (input.action === 'pull') return true
      try {
        const merged = await this.status(cwd)
        if (
          merged.branch !== status.branch ||
          merged.tracking?.remote !== input.tracking.remote ||
          merged.tracking?.branch !== input.tracking.branch
        )
          throw new Error('分支或上游已改变，请刷新后重试。')
        if (!merged.head || merged.entries.some((entry) => entry.area === 'conflict'))
          throw new Error('合并后 HEAD 无效或仍有冲突，未执行推送。请检查 Git 状态。')
        if (!merged.ahead) return true
        return await this.mutateRemote(cwd, merged, { ...input, action: 'push', head: merged.head })
      } catch (error) {
        throw new Error(`已完成拉取合并，但同步未完成。\n${explain(error).message}`)
      }
    }
    const urls = await runGit(root, ['remote', 'get-url', '--push', '--all', remote])
    if (urls.trim().split('\n').length !== 1)
      throw new Error('此远端有多个推送地址，请在终端明确处理。')
    verify(await this.status(cwd))
    if (urls !== (await runGit(root, ['remote', 'get-url', '--push', '--all', remote])))
      throw new Error('推送前远端推送地址已改变，未执行推送。')
    // Push the selected commit, not a HEAD that an Agent could advance while Git connects.
    await runGit(
      root,
      [
        'push',
        '--porcelain',
        '--no-force',
        '--no-mirror',
        '--no-follow-tags',
        '--recurse-submodules=no',
        '--',
        remote,
        `${status.head}:refs/heads/${branch}`,
      ],
      true,
    )
    if (input.action === 'publish') {
      try {
        verify(await this.status(cwd))
        await runGit(
          root,
          ['branch', `--set-upstream-to=refs/remotes/${remote}/${branch}`, '--', status.branch!],
          true,
        )
      } catch (error) {
        throw new Error(
          `远端推送已完成，但上游未能设置。请刷新并在终端检查，不要直接重复推送。\n${explain(error).message}`,
        )
      }
    }
    return true
  }

  async mutate(
    cwd: string,
    input: GitMutation,
    confirm: (description: string) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      const status = await this.status(cwd)
      if (
        input.action === 'fetch' ||
        input.action === 'push' ||
        input.action === 'publish' ||
        input.action === 'pull' ||
        input.action === 'sync'
      )
        return await this.mutateRemote(cwd, status, input)
      if (input.action === 'create-branch' || input.action === 'create-and-switch-branch') {
        if (
          typeof input.name !== 'string' ||
          !input.name ||
          input.name !== input.name.trim() ||
          input.name.length > 1013 ||
          input.name.startsWith('-') ||
          input.name === 'HEAD' ||
          /[\0\r\n]/.test(input.name)
        )
          throw new Error('请输入有效的本地分支名（上限 1,013 字符）。')
        if (!status.head) throw new Error('当前分支还没有提交，暂不能创建分支。')
        if (typeof input.head !== 'string' || !OID.test(input.head) || input.head !== status.head)
          throw new Error('HEAD 已改变，请刷新后重试。')
        if (input.action === 'create-and-switch-branch' && input.branch !== status.branch)
          throw new Error('分支已改变，请刷新后重试。')
        await runGit(status.rootPath, ['check-ref-format', `refs/heads/${input.name}`])
        if (input.action === 'create-and-switch-branch') {
          // Git creates the branch only if switching succeeds; never leave a half-created branch.
          await runGit(
            status.rootPath,
            [
              'switch',
              '--no-track',
              '--no-guess',
              '--no-overwrite-ignore',
              '--no-recurse-submodules',
              '--create',
              input.name,
              '--',
              input.head,
            ],
            true,
          )
        } else {
          await runGit(
            status.rootPath,
            ['branch', '--no-track', '--', input.name, input.head],
            true,
          )
        }
        return true
      }
      if (input.action === 'switch-branch') {
        if (
          typeof input.ref !== 'string' ||
          !input.ref.startsWith('refs/heads/') ||
          input.ref.length > 1024 ||
          /[\0\r\n]/.test(input.ref) ||
          input.ref.slice(11).startsWith('-')
        )
          throw new Error('请选择明确的本地分支。')
        if (input.branch !== status.branch || input.head !== status.head)
          throw new Error('分支或 HEAD 已改变，请刷新后重试。')
        await runGit(status.rootPath, ['check-ref-format', input.ref])
        await this.resolveCommit(status.rootPath, input.ref)
        const branch = input.ref.slice(11)
        if (status.branch === branch) return true
        const occupied = (await this.git.listWorktrees(status.rootPath)).find(
          (entry) => entry.branch === branch && entry.path !== status.rootPath,
        )
        if (occupied) throw new Error(`分支已被其他 Worktree 占用：${occupied.path}`)
        if (status.entries.length)
          throw new Error('切换分支前请提交或自行处理工作区更改；不会自动 stash 或丢弃改动。')
        await runGit(
          status.rootPath,
          [
            'switch',
            '--no-guess',
            '--no-overwrite-ignore',
            '--no-recurse-submodules',
            '--',
            branch,
          ],
          true,
        )
        return true
      }
      if (input.action === 'commit') {
        if (
          typeof input.message !== 'string' ||
          !input.message.trim() ||
          input.message.length > 20000 ||
          input.message.includes('\0')
        )
          throw new Error('请输入有效的提交信息（上限 20,000 字符）。')
        if (status.entries.some((entry) => entry.area === 'conflict'))
          throw new Error('请先解决所有合并冲突。')
        if (!status.entries.some((entry) => entry.area === 'staged'))
          throw new Error('没有已暂存的更改。')
        if (input.indexVersion !== status.indexVersion)
          throw new Error('暂存区或 HEAD 已改变，请刷新审阅后再提交。')
        await runGit(status.rootPath, ['commit', '-m', input.message], true)
        return true
      }
      if (!['stage', 'unstage', 'discard'].includes(input.action) || !('files' in input))
        throw new Error('不支持的 Git 操作。')
      const entries = this.select(status, input.files)
      if (entries.some((entry) => entry.submodule)) throw new Error('子模块写操作请在终端完成。')
      for (const entry of entries) {
        await this.safeTarget(status.rootPath, entry.path)
        if (entry.oldPath) await this.safeTarget(status.rootPath, entry.oldPath)
      }
      if (input.action === 'discard') {
        if (entries.some((entry) => entry.area !== 'unstaged' && entry.area !== 'untracked'))
          throw new Error('只能丢弃未暂存或未跟踪的文件。已暂存内容不会被丢弃。')
        const capture = async () => {
          const current = await this.status(cwd)
          const selected = this.select(current, input.files)
          const contents = []
          // Hash one file at a time: a bulk confirmation must not allocate 2 MiB per selected file.
          for (const entry of selected) {
            const bytes = await this.workingFile(current.rootPath, entry.path)
            const info = await lstat(join(current.rootPath, entry.path)).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return null
                throw error
              },
            )
            contents.push([entry, bytes === null ? null : hash(bytes), info?.mode, info?.ino])
          }
          return hash(JSON.stringify([current.rootPath, current.indexVersion, contents]))
        }
        const before = await capture()
        const untracked = entries.filter((entry) => entry.area === 'untracked').length
        if (
          !(await confirm(
            `将丢弃 ${entries.length} 个文件的工作区改动，恢复到暂存区版本。${untracked ? `其中 ${untracked} 个未跟踪文件将永久删除，无法通过 Git 恢复。` : ''}已暂存内容保留。\n\n${entries
              .slice(0, 20)
              .map((entry) => entry.path)
              .join('\n')}${entries.length > 20 ? '\n…' : ''}`,
          ))
        )
          return false
        if (before !== (await capture()))
          throw new Error('确认期间文件、暂存区或 HEAD 已改变，未执行丢弃。请重新审阅。')
        for (const entry of entries) {
          // Never recursively delete directories or use an unbounded git clean/reset.
          if (entry.area === 'untracked')
            await unlink(await this.safeTarget(status.rootPath, entry.path))
          else
            await runGit(
              status.rootPath,
              ['restore', '--worktree', '--', literal(entry.path)],
              true,
            )
        }
      } else {
        if (input.action === 'unstage' && entries.some((entry) => entry.area !== 'staged'))
          throw new Error('请选择已暂存文件。')
        if (input.action === 'stage' && entries.some((entry) => entry.area === 'staged'))
          throw new Error('请选择未暂存的文件。')
        const paths = [
          ...new Set(
            entries.flatMap((entry) =>
              entry.oldPath ? [entry.path, entry.oldPath] : [entry.path],
            ),
          ),
        ]
        // Bound argv while retaining literal pathspecs, including names with whitespace or metacharacters.
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100).map(literal)
          await runGit(
            status.rootPath,
            input.action === 'stage'
              ? ['add', '--', ...chunk]
              : status.head
                ? ['restore', '--staged', '--', ...chunk]
                : ['rm', '--cached', '--force', '--', ...chunk],
            true,
          )
        }
      }
      return true
    } catch (error) {
      throw explain(error)
    }
  }
}
