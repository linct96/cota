import { isUtf8 } from 'node:buffer'
import type {
  GitHistory,
  GitHistoryRequest,
  GitComparison,
  GitCompareRequest,
  GitReviewFile,
} from '../../../shared/source-control'
import { GitService } from '../worktrees/git'
import {
  runGit,
  runGitBytes,
  resolveGitCommit,
  WorktreeError,
  explainGitError as explain,
} from '../git-runner'
import { diffStats } from './stats'
import { filePath, OID, HISTORY_PAGE, MAX_FILES, STATS_BUDGET_MS } from './shared'
const git = new GitService()

export async function checkedCommit(root: string, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !OID.test(value)) throw new Error('请提供完整的提交标识。')
  return resolveGitCommit(root, value)
}
export async function history(cwd: string, request: GitHistoryRequest = {}): Promise<GitHistory> {
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
    const { rootPath } = await git.requireRepository(cwd)
    let head: string
    if (request.head !== undefined) head = await checkedCommit(rootPath, request.head)
    else {
      const current = await runGit(rootPath, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(
        (error) => {
          if (error instanceof WorktreeError && (error.cause as { code?: number })?.code === 1)
            return ''
          throw error
        },
      )
      if (!current.trim()) return { head: null, commits: [], more: false }
      head = await checkedCommit(rootPath, current.trim())
    }
    const base =
      request.base === undefined ? undefined : await checkedCommit(rootPath, request.base)
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
export async function compare(cwd: string, request: GitCompareRequest): Promise<GitComparison> {
  try {
    if (!request || typeof request !== 'object') throw new Error('比较查询参数无效。')
    const { rootPath } = await git.requireRepository(cwd)
    let head: string, base: string | null, label: string
    if (request.kind === 'commit') {
      head = await checkedCommit(rootPath, request.commit)
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
      head = await resolveGitCommit(rootPath, 'HEAD')
      const tip = await resolveGitCommit(rootPath, request.ref)
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
    await diffStats(
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
