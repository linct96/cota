import { isUtf8 } from 'node:buffer'
import type { CommitMessageContext } from '../../../shared/commit-message'
import type {
  GitCompareRequest,
  GitComparison,
  GitDiff,
  GitDiffSelection,
  GitHistory,
  GitHistoryRequest,
  GitMutation,
  GitReferences,
  GitReviewSelection,
  GitStatus,
} from '../../../shared/source-control'
import { branchReferences } from '../../../shared/git-branches'
import { readBranchData, readBranchRemotes } from '../branches/read'
import { GitService } from '../worktrees/git'
import { WorktreeError, explainGitError as explain, runGit, runGitBytes } from '../git-runner'
import { indexVersion, mergeState, parseGitStatus, tracking } from './status'
import { fileStats } from './stats'
import { blob, conflictDiff, textDiff, workingFile } from './files'
import { checkedCommit, compare, history } from './history'
import { filePath } from './shared'
import { mutate, selectFiles } from './mutations'

export class SourceControlService {
  private readonly git = new GitService()

  async commitMessageContext(
    cwd: string,
    expectedIndexVersion: string,
  ): Promise<CommitMessageContext> {
    const status = await this.status(cwd)
    this.checkCommitMessageStatus(status, expectedIndexVersion)
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

  private checkCommitMessageStatus(status: GitStatus, expectedIndexVersion: string): void {
    if (status.entries.some((entry) => entry.area === 'conflict'))
      throw new Error('请先解决所有合并冲突。')
    if (!status.entries.some((entry) => entry.area === 'staged'))
      throw new Error('没有已暂存的更改。')
    if (status.indexVersion !== expectedIndexVersion)
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
      return { branch, head, tracking: await tracking(rootPath, branch) }
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
      const merge = await mergeState(rootPath)
      const result = {
        ...status,
        rootPath,
        tracking: await tracking(rootPath, status.branch),
        merge,
        indexVersion: await indexVersion(rootPath, status.head, merge),
      }
      if (includeStats) await fileStats(rootPath, result.entries)
      return result
    } catch (error) {
      throw explain(error)
    }
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

  private async reviewDiff(cwd: string, selection: GitReviewSelection): Promise<GitDiff> {
    const { rootPath } = await this.git.requireRepository(cwd)
    const head = await checkedCommit(rootPath, selection.head)
    const base = selection.base === null ? null : await checkedCommit(rootPath, selection.base)
    const path = filePath(selection.path)
    const oldPath = selection.oldPath === undefined ? path : filePath(selection.oldPath)
    if (selection.submodule)
      return { kind: 'unavailable', reason: '子模块不提供文本 Diff，请在终端查看。' }
    return textDiff(
      await blob(rootPath, oldPath, 'head', base),
      await blob(rootPath, path, 'head', head),
    )
  }

  async diff(cwd: string, selection: GitDiffSelection): Promise<GitDiff> {
    try {
      if (selection.area === 'review') return await this.reviewDiff(cwd, selection)
      const status = await this.status(cwd)
      const [entry] = selectFiles(status, [selection])
      if (entry.submodule)
        return { kind: 'unavailable', reason: '子模块变更请在外部编辑器或终端查看。' }
      if (entry.area === 'conflict') return await conflictDiff(status.rootPath, entry.path)
      const original =
        entry.area === 'untracked'
          ? Buffer.alloc(0)
          : await blob(
              status.rootPath,
              entry.oldPath || entry.path,
              entry.area === 'staged' ? 'head' : 'index',
              status.head,
            )
      const modified =
        entry.area === 'staged'
          ? await blob(status.rootPath, entry.path, 'index', status.head)
          : await workingFile(status.rootPath, entry.path)
      if (modified === null && entry.status !== 'D') throw new Error('文件已移除，请刷新状态。')
      const right = modified || Buffer.alloc(0)
      return textDiff(original, right)
    } catch (error) {
      throw explain(error)
    }
  }

  history(cwd: string, request: GitHistoryRequest = {}): Promise<GitHistory> {
    return history(cwd, request)
  }

  compare(cwd: string, request: GitCompareRequest): Promise<GitComparison> {
    return compare(cwd, request)
  }

  mutate(
    cwd: string,
    input: GitMutation,
    confirm: (description: string) => Promise<boolean>,
  ): Promise<boolean> {
    return mutate(cwd, input, confirm, this)
  }
}
