import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { vi } from 'vitest'
import { gitEnvironment } from '../../src/main/git/worktrees/git'
import { WorktreeManager } from '../../src/main/git/worktrees/manager'
import { ConfigStore } from '../../src/main/settings/config-store'
import type { TerminalSession } from '../../src/shared/contracts'

const execFileAsync = promisify(execFile)
export const git = async (cwd: string, ...args: string[]) =>
  (
    await execFileAsync('git', args, {
      cwd,
      env: { ...gitEnvironment(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      timeout: 10000,
    })
  ).stdout
export const input = (projectPath: string, branchName = 'feature/中文') => ({
  projectPath,
  branchName,
  name: '功能 工作区',
  baseRef: 'main',
})
export const removalOptions = () => ({
  deleteBranch: false,
  sessions: vi.fn((): Promise<TerminalSession[]> => Promise.resolve([])),
  close: vi.fn(async (_id: string) => {}),
  confirm: vi.fn((_check?: unknown, _force?: boolean) => Promise.resolve(true)),
})
export const init = async (path: string, committed = true) => {
  await mkdir(path, { recursive: true })
  await git(path, 'init', '--initial-branch=main')
  await git(path, 'config', 'user.name', 'Cota Test')
  await git(path, 'config', 'user.email', 'cota@example.test')
  await git(path, 'config', 'commit.gpgsign', 'false')
  await git(path, 'config', 'core.hooksPath', '/dev/null')
  if (committed) {
    await writeFile(join(path, 'example.txt'), 'initial\n')
    await git(path, 'add', 'example.txt')
    await git(path, 'commit', '-m', 'initial')
  }
}

export async function worktreeTestDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'cota worktree 中文-')))
}

export async function worktreeTestRepository(root: string) {
  const repo = join(root, '项目 空格')
  await init(repo)
  const config = new ConfigStore(join(root, 'config.json'))
  await config.load()
  await config.remember(repo)
  const manager = new WorktreeManager(config, join(root, '.cota-dev', 'worktrees'))
  return { repo, config, manager }
}
