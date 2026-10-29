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
  GitReviewFile,
  GitComparison,
  GitCompareRequest,
  GitReferences,
  GitHistory,
  GitHistoryRequest,
  GitTracking,
  GitMutation,
  GitStatus,
} from '../../shared/source-control'
import { branchReferences } from '../../shared/git-branches'
import { readBranchData, readBranchRemotes, isBranchMutation, mutateBranch } from './branch-service'
import { GitService } from './git-worktrees'
import {
  runGit,
  runGitBytes,
  WorktreeError,
  resolveGitCommit,
  explainGitError as explain,
} from './git-runner'

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

  async repositoryContext(cwd: string): Promise<Pick<GitStatus, 'branch' | 'head' | 'tracking'>> {
    try {
      const { rootPath } = await this.git.requireRepository(cwd)
      const [head, reference] = await Promise.all(
        [
          ['rev-parse', '--verify', '--quiet', 'HEAD'],
          ['symbolic-ref', '--quiet', 'HEAD'],
        ].map(async (args) => {
          try {
            return (await runGit(rootPath, args)).trim()
          } catch (error) {
            // Exit 1 means an unborn HEAD or a detached symbolic ref, not a failed repository read.
            if (
              error instanceof WorktreeError &&
              (error.cause as { code?: number } | undefined)?.code === 1
            )
              return null
            throw error
          }
        }),
      )
      const branch = reference?.startsWith('refs/heads/') ? reference.slice(11) : null
      return { branch, head, tracking: await this.tracking(rootPath, branch) }
    } catch (error) {
      throw explain(error)
    }
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

  private async diffStats(
    root: string,
    entries: GitReviewFile[],
    args: string[],
    deadline: number,
  ): Promise<void> {
    const files = entries.filter((entry) => !entry.submodule)
    const timeout = Math.ceil(deadline - performance.now())
    if (!files.length || timeout <= 0) return
    try {
      const raw = await runGitBytes(
        root,
        [
          ...args,
          '--numstat',
          '-z',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=all',
          '--find-renames',
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
      // Counts are optional display data; a failed diff must not hide valid Git results.
    }
  }

  private async fileStats(root: string, entries: GitChange[]): Promise<void> {
    // Optional counts must not hold the status read lock for slow diffs.
    const deadline = performance.now() + STATS_BUDGET_MS
    for (const area of ['staged', 'unstaged'] as const) {
      await this.diffStats(
        root,
        entries.filter((entry) => entry.area === area),
        ['diff', ...(area === 'staged' ? ['--cached'] : [])],
        deadline,
      )
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
      // Write preconditions deliberately use uncached Git reads.
      return branchReferences(
        await readBranchData(rootPath, this.git),
        await readBranchRemotes(rootPath),
      )
    } catch (error) {
      throw explain(error)
    }
  }

  private resolveCommit(root: string, ref: string): Promise<string> {
    return resolveGitCommit(root, ref)
  }

  private async checkedCommit(root: string, value: unknown): Promise<string> {
    if (typeof value !== 'string' || !OID.test(value)) throw new Error('请提供完整的提交标识。')
    return this.resolveCommit(root, value)
  }

  async history(cwd: string, request: GitHistoryRequest = {}): Promise<GitHistory> {
    try {
      if (!request || typeof request !== 'object') throw new Error('历史查询参数无效。')
      if (request.base !== undefined && request.head === undefined)
        throw new Error('比较范围需要明确的起点和终点提交。')
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
      const base =
        request.base === undefined ? undefined : await this.checkedCommit(rootPath, request.base)
      const raw = await runGitBytes(rootPath, [
        'log',
        '-z',
        '--no-show-signature',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        `--max-count=${HISTORY_PAGE + 1}`,
        `--skip=${offset}`,
        head,
        ...(base ? [`^${base}`] : []),
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
      const entries: GitReviewFile[] = []
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
      await this.diffStats(
        rootPath,
        entries,
        base ? ['diff', base, head] : ['diff-tree', '--root', '--no-commit-id', '-r', head],
        performance.now() + STATS_BUDGET_MS,
      )
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

  async mutate(
    cwd: string,
    input: GitMutation,
    confirm: (description: string) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      if (isBranchMutation(input)) return await mutateBranch(cwd, input, this)
      const status = await this.status(cwd)
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
