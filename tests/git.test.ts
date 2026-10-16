import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectBranch } from '../src/main/git'

const execFileAsync = promisify(execFile)
let directory: string
const git = (...args: string[]) =>
  execFileAsync('git', ['-C', directory, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5000,
  })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cota 分支-'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('project branch', () => {
  it('reads unborn branches and nested project directories without changing the repository', async () => {
    await git('init', '--initial-branch=main')
    const nested = join(directory, 'nested')
    await mkdir(nested)
    vi.stubEnv('GIT_DIR', join(directory, 'not-a-repository'))
    vi.stubEnv('GIT_WORK_TREE', join(directory, 'not-a-worktree'))
    expect(await projectBranch(nested)).toBe('main')
    vi.unstubAllEnvs()
    await git('symbolic-ref', 'HEAD', 'refs/heads/feature/工作区')
    expect(await projectBranch(directory)).toBe('feature/工作区')
    expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('feature/工作区')
  })

  it('reads worktree branches and omits detached HEAD', async () => {
    await git('init', '--initial-branch=main')
    await git(
      '-c',
      'user.name=Cota',
      '-c',
      'user.email=cota@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    )
    const worktree = join(directory, 'worktree')
    await git('worktree', 'add', '-b', 'feature/worktree', worktree)
    expect(await projectBranch(worktree)).toBe('feature/worktree')
    expect(await projectBranch(directory)).toBe('main')
    await git('checkout', '--detach')
    expect(await projectBranch(directory)).toBeNull()
  })

  it('omits the subtitle for non-repositories or missing Git', async () => {
    expect(await projectBranch(directory)).toBeNull()
    await git('init', '--initial-branch=main')
    vi.stubEnv('PATH', directory)
    expect(await projectBranch(directory)).toBeNull()
  })

  it('validates paths before running Git', async () => {
    await expect(projectBranch('relative/path')).rejects.toThrow()
    await expect(projectBranch('/tmp/project\0git')).rejects.toThrow()
    await expect(projectBranch(join(directory, 'missing'))).rejects.toThrow()
  })
})
