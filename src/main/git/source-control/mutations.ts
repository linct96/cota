import { lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  GitChange,
  GitStatus,
  GitFileSelection,
  GitMutation,
} from '../../../shared/source-control'
import type { SourceControlService } from './service'
import { isBranchMutation, mutateBranch } from '../branches/mutations'
import { runGit, explainGitError as explain } from '../git-runner'
import { safeTarget, workingFile } from './files'
import { filePath, hash, literal, MAX_FILES } from './shared'

export function selectFiles(status: GitStatus, values: unknown): GitChange[] {
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

export async function mutate(
  cwd: string,
  input: GitMutation,
  confirm: (description: string) => Promise<boolean>,
  sourceControl: Pick<SourceControlService, 'status' | 'references'>,
): Promise<boolean> {
  try {
    if (isBranchMutation(input)) return await mutateBranch(cwd, input, sourceControl)
    const status = await sourceControl.status(cwd)
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
      if (!status.merge && !status.entries.some((entry) => entry.area === 'staged'))
        throw new Error('没有已暂存的更改。')
      if (input.indexVersion !== status.indexVersion)
        throw new Error('暂存区或 HEAD 已改变，请刷新审阅后再提交。')
      await runGit(status.rootPath, ['commit', '-m', input.message], true)
      return true
    }
    if (!['stage', 'unstage', 'discard'].includes(input.action) || !('files' in input))
      throw new Error('不支持的 Git 操作。')
    const entries = selectFiles(status, input.files)
    if (entries.some((entry) => entry.submodule)) throw new Error('子模块写操作请在终端完成。')
    for (const entry of entries) {
      await safeTarget(status.rootPath, entry.path)
      if (entry.oldPath) await safeTarget(status.rootPath, entry.oldPath)
    }
    if (input.action === 'discard') {
      if (entries.some((entry) => entry.area !== 'unstaged' && entry.area !== 'untracked'))
        throw new Error('只能丢弃未暂存或未跟踪的文件。已暂存内容不会被丢弃。')
      const capture = async () => {
        const current = await sourceControl.status(cwd)
        const selected = selectFiles(current, input.files)
        const contents = []
        // Hash one file at a time: a bulk confirmation must not allocate 2 MiB per selected file.
        for (const entry of selected) {
          const bytes = await workingFile(current.rootPath, entry.path)
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
        if (entry.area === 'untracked') await unlink(await safeTarget(status.rootPath, entry.path))
        else
          await runGit(status.rootPath, ['restore', '--worktree', '--', literal(entry.path)], true)
      }
    } else {
      if (input.action === 'unstage' && entries.some((entry) => entry.area !== 'staged'))
        throw new Error('请选择已暂存文件。')
      if (input.action === 'stage' && entries.some((entry) => entry.area === 'staged'))
        throw new Error('请选择未暂存的文件。')
      const paths = [
        ...new Set(
          entries.flatMap((entry) => (entry.oldPath ? [entry.path, entry.oldPath] : [entry.path])),
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
