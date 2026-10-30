import { isUtf8 } from 'node:buffer'
import { lstat } from 'node:fs/promises'
import type { GitChange, GitReviewFile } from '../../../shared/source-control'
import { runGitBytes } from '../git-runner'
import { safeTarget, workingFile } from './files'
import { filePath, MAX_FILE_BYTES, STATS_BUDGET_MS } from './shared'

export async function diffStats(
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
    if (!isUtf8(raw) || (raw.length && raw.at(-1) !== 0)) throw new Error('Git 行数统计格式无效。')
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
export async function fileStats(root: string, entries: GitChange[]): Promise<void> {
  // Optional counts must not hold the status read lock for slow diffs.
  const deadline = performance.now() + STATS_BUDGET_MS
  for (const area of ['staged', 'unstaged'] as const) {
    await diffStats(
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
      const info = await lstat(await safeTarget(root, entry.path))
      if (info.size > Math.min(MAX_FILE_BYTES, remaining)) continue
      const bytes = await workingFile(root, entry.path, info.size)
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
