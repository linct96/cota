import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GitService,
  parseWorktreeList,
  WorktreeError,
  gitEnvironment,
} from '../src/main/git/worktrees/git'
import {
  SPACE_NAMES,
  suggestWorktreeName,
  worktreeBranchSegment,
} from '../src/shared/worktree-names'
import { setupFileLines, worktreeSetupSchema } from '../src/shared/worktree-setup'

describe('NUL-delimited Git worktree parsing', () => {
  it('preserves special paths, detached HEAD, bare, locks and prunable reasons', () => {
    const sha = 'a'.repeat(40)
    const output = [
      'worktree /tmp/主目录 "quote"\\backslash',
      `HEAD ${sha}`,
      'branch refs/heads/main',
      '',
      'worktree /tmp/空格 \n换行',
      `HEAD ${sha}`,
      'detached',
      'locked 手动锁定\n原因',
      '',
      'worktree /tmp/missing',
      `HEAD ${sha}`,
      'branch refs/heads/feature/a',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /tmp/bare.git',
      'bare',
      '',
      '',
    ].join('\0')
    const entries = parseWorktreeList(output)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({
      isMain: true,
      branch: 'main',
      path: '/tmp/主目录 "quote"\\backslash',
    })
    expect(entries[1]).toMatchObject({
      path: '/tmp/空格 \n换行',
      branch: null,
      locked: true,
      lockReason: '手动锁定\n原因',
      isMain: false,
    })
    expect(entries[2]).toMatchObject({
      branch: 'feature/a',
      prunable: true,
      prunableReason: 'gitdir file points to non-existent location',
    })
    expect(entries[3]).toMatchObject({ isBare: true, managedByCota: false })
  })
  it.each([
    '',
    'worktree /tmp/repo\nHEAD abc\n',
    'worktree relative\0bare\0\0',
    'worktree /tmp/repo\0HEAD invalid\0detached\0\0',
  ])('rejects malformed or truncated output rather than returning an empty list', (output) => {
    expect(() => parseWorktreeList(output)).toThrow(WorktreeError)
  })
})

describe('Worktree pure logic and missing Git (no Git required)', () => {
  let repo: string
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cota-worktrees-unit-'))
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(repo, { recursive: true, force: true })
  })
  it('suggests unique names and safe branch segments', () => {
    expect(new Set(SPACE_NAMES).size).toBe(SPACE_NAMES.length)
    expect(SPACE_NAMES.every((name) => /^[a-z]+(?:-[a-z]+)*$/.test(name))).toBe(true)
    expect(suggestWorktreeName([' MERCURY '], () => 0)).toBe('venus')
    expect(suggestWorktreeName(SPACE_NAMES, () => 0)).toBe('mercury-2')
    expect(suggestWorktreeName([...SPACE_NAMES, 'MERCURY-2'], () => 0)).toBe('venus-2')
    expect(worktreeBranchSegment(' A..B.lock @{foo}/ ')).toBe('a-b-lock-foo')
    expect(worktreeBranchSegment(' 功能 工作区 ')).toBe('功能-工作区')
  })
  it('rejects unsafe setup paths and normalizes file lines', () => {
    for (const path of [
      '../secret',
      '/tmp/secret',
      '.git/config',
      'node_modules/a',
      'a\\b',
      'a/../b',
      'C:/secret',
    ])
      expect(worktreeSetupSchema.safeParse({ command: '', copyFiles: [path] }).success).toBe(false)
    expect(setupFileLines(' .env.local\n\n.env.local\r\nconfig/local.json ')).toEqual([
      '.env.local',
      'config/local.json',
    ])
  })
  it('reports missing Git without needing an initialized repository', async () => {
    const service = new GitService()
    vi.stubEnv('PATH', join(repo, 'no-git'))
    expect(await service.inspectRepository(repo)).toMatchObject({
      status: 'gitUnavailable',
      code: 'GIT_UNAVAILABLE',
    })
    await expect(service.listWorktrees(repo)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' })
  })
  it('removes inherited Git configuration and repository overrides', () => {
    for (const key of [
      'GIT_DIR',
      'GIT_COMMON_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_NAMESPACE',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
    ])
      vi.stubEnv(key, 'injected')
    expect(
      Object.keys(gitEnvironment()).some(
        (key) => key.startsWith('GIT_') && key !== 'GIT_TERMINAL_PROMPT',
      ),
    ).toBe(false)
  })
})
