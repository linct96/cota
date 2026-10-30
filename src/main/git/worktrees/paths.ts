import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize } from 'node:path'
import type { GitWorktreeInfo } from '../../../shared/contracts'
import { WorktreeError } from './git'
import type { WorktreeAccess } from './access'

export class WorktreePaths {
  constructor(private readonly access: WorktreeAccess) {}

  directorySlug(name: string): string {
    return (
      Array.from(
        name
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}._-]+/gu, '-')
          .replace(/-+/g, '-')
          .replace(/^[.-]+|[.-]+$/g, ''),
      )
        .slice(0, 40)
        .join('') || 'worktree'
    )
  }

  async plannedPath(
    repoId: string,
    repoPath: string,
    name: string,
    worktrees: GitWorktreeInfo[],
    preferredPath?: string,
  ): Promise<string> {
    const mainPath = worktrees.find((entry) => entry.isMain)?.path || repoPath
    const parent = await this.repositoryDirectory(
      repoId,
      this.directorySlug(basename(mainPath).replace(/\.git$/, '')),
    )
    const occupied = new Set([
      ...worktrees.map((entry) => entry.path),
      ...this.access.config.snapshot().worktreeRecords.map((entry) => entry.path),
    ])
    const retired = new Set(this.access.config.snapshot().worktreeNameHistory?.[repoId] || [])
    const slug = this.directorySlug(name)
    for (let suffix = 1; suffix <= 10000; suffix++) {
      const path = preferredPath || join(parent, suffix === 1 ? slug : `${slug}-${suffix}`)
      if (dirname(path) !== parent)
        throw new WorktreeError('PATH_CONFLICT', '目录计划与当前仓库登记不一致，请重新预览。')
      if (!occupied.has(path) && !retired.has(basename(path).toLowerCase())) {
        try {
          await lstat(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
          throw error
        }
      }
      if (preferredPath)
        throw new WorktreeError('PATH_CONFLICT', '预览目录已被占用，请重新预览后再创建。')
    }
    throw new WorktreeError('PATH_CONFLICT', '无法找到可用目录，请使用其他工作区名称。')
  }

  async ownsRepositoryDirectory(parent: string, repoId: string): Promise<boolean> {
    const marker = join(parent, '.cota-repository')
    try {
      const info = await lstat(marker)
      return (
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.size === repoId.length &&
        (await readFile(marker, 'utf8')) === repoId
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async repositoryDirectory(repoId: string, repoName: string): Promise<string> {
    const directory = normalize(this.access.directory)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if ((await realpath(directory)) !== directory)
      throw new WorktreeError('PATH_CONFLICT', 'Worktree 根目录经过符号链接，无法确认环境隔离。')
    for (const name of [repoName, `${repoName}-${repoId.slice(0, 8)}`]) {
      const parent = join(directory, name)
      let created = false
      try {
        await mkdir(parent, { mode: 0o700 })
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(parent)) !== parent)
        throw new WorktreeError('PATH_CONFLICT', 'Worktree 仓库目录无效或经过符号链接。')
      // Persist ownership even when creation fails before the config record is saved.
      if (created)
        await writeFile(join(parent, '.cota-repository'), repoId, { flag: 'wx', mode: 0o600 })
      if (await this.ownsRepositoryDirectory(parent, repoId)) return parent
    }
    throw new WorktreeError('PATH_CONFLICT', 'Worktree 仓库目录已被占用，无法确认归属。')
  }
}
