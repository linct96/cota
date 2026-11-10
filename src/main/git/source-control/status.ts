import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GitStatus, GitTracking } from '../../../shared/source-control'
import { runGit, runGitBytes } from '../git-runner'
import { MAX_FILES, filePath, hash } from './shared'

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

export async function tracking(
  root: string,
  branch: string | null,
): Promise<GitTracking | undefined> {
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
export async function mergeState(root: string): Promise<GitStatus['merge']> {
  const path = (
    await runGit(root, ['rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'])
  ).trim()
  const read = (metadataPath: string) =>
    readFile(metadataPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
  const head = await read(path)
  if (head === undefined) return undefined
  const message = await read(join(dirname(path), 'MERGE_MSG'))
  return {
    heads: head.trim().split('\n'),
    message:
      (await runGitBytes(root, ['stripspace', '--strip-comments'], false, 10000, message || ''))
        .toString('utf8')
        .trim() || 'Merge commits',
  }
}

export async function indexVersion(
  root: string,
  head: string | null,
  merge: GitStatus['merge'],
): Promise<string> {
  return hash(
    Buffer.concat([
      Buffer.from(JSON.stringify([head || 'unborn', merge])),
      await runGitBytes(root, ['ls-files', '--stage', '-z']),
    ]),
  )
}
