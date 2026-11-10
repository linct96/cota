import { normalize } from 'node:path'
import type { CreateWorktreeInput, WorktreeRecord } from '../../shared/contracts'
import { absolutePath } from './paths'
import { terminalId } from './terminal'

export function createWorktreeInput(value: unknown): CreateWorktreeInput {
  if (!value || typeof value !== 'object') throw new Error('Worktree 参数无效。')
  const input = value as Partial<CreateWorktreeInput>
  const text = (inputValue: unknown): string => {
    if (
      typeof inputValue !== 'string' ||
      !inputValue.trim() ||
      inputValue.length > 1024 ||
      /[\0\r\n]/.test(inputValue)
    )
      throw new Error('Worktree 名称、分支和基准引用不能为空，且不得超过 1024 字符。')
    return inputValue
  }
  return {
    projectPath: absolutePath(input.projectPath),
    name: text(input.name).trim(),
    branchName: text(input.branchName),
    baseRef: text(input.baseRef),
  }
}

export function worktreeNameHistory(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Worktree 名称历史无效。')
  const entries = Object.entries(value)
  let total = 0
  if (entries.length > 10000) throw new Error('Worktree 名称历史过大。')
  return Object.fromEntries(
    entries.map(([repoId, names]) => {
      if (
        !/^[\da-f]{24}$/.test(repoId) ||
        !Array.isArray(names) ||
        names.some(
          (name: unknown) =>
            typeof name !== 'string' ||
            !name ||
            name.length > 4096 ||
            /[\0/]/.test(name) ||
            name === '.' ||
            name === '..',
        )
      )
        throw new Error('Worktree 名称历史无效。')
      const normalized = [...new Set((names as string[]).map((name) => name.toLowerCase()))]
      total += normalized.length
      if (total > 100000) throw new Error('Worktree 名称历史过大。')
      return [repoId, normalized]
    }),
  )
}

export function worktreeRecords(value: unknown): WorktreeRecord[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Worktree 登记列表无效。')
  const path = (inputValue: unknown): string => {
    const result = absolutePath(inputValue)
    if (normalize(result) !== result || result === '/') throw new Error('Worktree 登记路径无效。')
    return result
  }
  const optionalText = (inputValue: unknown): string | undefined => {
    if (inputValue === undefined) return undefined
    if (
      typeof inputValue !== 'string' ||
      !inputValue ||
      inputValue.length > 1024 ||
      /[\0\r\n]/.test(inputValue)
    )
      throw new Error('Worktree 登记引用无效。')
    return inputValue
  }
  const records = value.map((entry: unknown): WorktreeRecord => {
    if (!entry || typeof entry !== 'object') throw new Error('Worktree 登记格式无效。')
    const data = entry as Partial<WorktreeRecord>
    if (
      (data.origin !== 'created' && data.origin !== 'linked') ||
      typeof data.repoId !== 'string' ||
      !/^[\da-f]{24}$/.test(data.repoId) ||
      typeof data.registeredAt !== 'string' ||
      !Number.isFinite(Date.parse(data.registeredAt))
    )
      throw new Error('Worktree 登记来源或仓库标识无效。')
    return {
      id: terminalId(data.id),
      projectPath: path(data.projectPath),
      repoCommonDir: path(data.repoCommonDir),
      repoId: data.repoId,
      path: path(data.path),
      origin: data.origin,
      initialBranch: optionalText(data.initialBranch),
      baseRef: optionalText(data.baseRef),
      registeredAt: data.registeredAt,
    }
  })
  if (
    new Set(records.map((entry) => entry.id)).size !== records.length ||
    new Set(records.map((entry) => entry.path)).size !== records.length
  )
    throw new Error('Worktree 登记标识或路径重复。')
  const repositories = new Map<string, string>()
  const repositoryIds = new Map<string, string>()
  for (const record of records) {
    if (
      (repositories.has(record.repoCommonDir) &&
        repositories.get(record.repoCommonDir) !== record.repoId) ||
      (repositoryIds.has(record.repoId) &&
        repositoryIds.get(record.repoId) !== record.repoCommonDir)
    )
      throw new Error('Worktree 仓库身份冲突。')
    repositories.set(record.repoCommonDir, record.repoId)
    repositoryIds.set(record.repoId, record.repoCommonDir)
  }
  return records
}
