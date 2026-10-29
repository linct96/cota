import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectBranch } from '../src/main/git/project-branch'
import { SourceControlService, parseGitStatus } from '../src/main/git/source-control'
import { SourceControlWatches } from '../src/main/git/source-control-watch'
import { BranchService, readBranchData } from '../src/main/git/branch-service'
import { HostingBranches } from '../src/main/code-hosting/branches'
import { branchReferences } from '../src/shared/git-branches'
import * as gitRunner from '../src/main/git/git-runner'
import { createBranchFormSchema } from '../src/renderer/src/lib/form-schemas'
import { ConfigStore } from '../src/main/config'
import { CodeHostingService } from '../src/main/code-hosting/service'
import { parseHostingRemote } from '../src/main/code-hosting/remote'
import { parseHostingAccounts } from '../src/main/code-hosting/accounts'
import { HostingError } from '../src/main/code-hosting/cli-runner'
import type { HostingAdapter, ReviewScope } from '../src/main/code-hosting/adapter'
import { GitHubAdapter } from '../src/main/code-hosting/github'
import { GitLabAdapter } from '../src/main/code-hosting/gitlab'
import type { HostingRequest } from '../src/main/code-hosting/cli-runner'
import {
  hostingBranchesExpired,
  resolveTargetBranchRef,
  type HostedReview,
  type HostingAccounts,
  type HostingComparison,
  type HostingRepository,
} from '../src/shared/code-hosting'

const sourceControl = new SourceControlService()

const execFileAsync = promisify(execFile)
let directory: string
const git = (...args: string[]) =>
  execFileAsync('git', ['-C', directory, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5000,
  })

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'cota 分支-')))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('project branch', () => {
  it('isolates the platform branch cache and discards invalidated requests without retrying writes', async () => {
    const cache = new HostingBranches()
    const repository: HostingRepository = {
      provider: 'gitlab',
      host: 'gitlab.example.com',
      path: 'team/repo',
    }
    const original = [{ name: 'main' }]
    const adapter = { branches: vi.fn().mockResolvedValue(original) }
    const [first, second] = await Promise.all([
      cache.get(repository, 1, 'alice', adapter),
      cache.get(repository, 1, 'alice', adapter),
    ])
    expect(first.branches).toBe(second.branches)
    expect(adapter.branches).toHaveBeenCalledOnce()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(first.fetchedAt + 59999)
    try {
      expect(hostingBranchesExpired(first.fetchedAt)).toBe(false)
      expect(await cache.get(repository, 1, 'alice', adapter)).toMatchObject({
        stale: false,
        fetchedAt: first.fetchedAt,
      })
      clock.mockReturnValue(first.fetchedAt + 60000)
      expect(hostingBranchesExpired(first.fetchedAt)).toBe(true)
      expect(await cache.get(repository, 1, 'alice', adapter)).toMatchObject({
        stale: true,
        fetchedAt: first.fetchedAt,
      })
      expect(adapter.branches).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
    adapter.branches.mockResolvedValueOnce([{ name: 'published' }])
    expect((await cache.get(repository, 1, 'alice', adapter, true)).branches).toEqual([
      { name: 'published' },
    ])
    expect((await cache.get(repository, 1, 'bob', adapter)).branches).toEqual(original)
    expect(adapter.branches).toHaveBeenCalledTimes(3)
    adapter.branches.mockRejectedValueOnce(new HostingError('forbidden', 'permission lost'))
    await expect(cache.get(repository, 1, 'alice', adapter, true)).rejects.toThrow(
      'permission lost',
    )
    await cache.get(repository, 1, 'bob', adapter)
    expect(adapter.branches).toHaveBeenCalledTimes(5)
    cache.invalidateRemotes(['git@gitlab.example.com:team/repo.git'])
    let finish!: (value: { name: string }[]) => void
    adapter.branches.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = cache.get(repository, 1, 'bob', adapter)
    const rejected = expect(pending).rejects.toThrow('资源已失效')
    cache.clear()
    finish([{ name: 'late' }])
    await rejected
    expect((await cache.get(repository, 1, 'bob', adapter)).branches).toEqual(original)
    adapter.branches.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const firstRefresh = cache.get(repository, 1, 'bob', adapter, true)
    const forcedRefresh = cache.get(repository, 1, 'bob', adapter, true)
    finish([{ name: 'superseded' }])
    expect((await firstRefresh).branches).toEqual(original)
    expect((await forcedRefresh).branches).toEqual(original)
  })

  it('shares branch resources while isolating worktree configuration and invalidating in-flight reads', async () => {
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
    const linked = join(directory, 'linked')
    await git('worktree', 'add', '-b', 'linked', linked)
    await git('config', 'extensions.worktreeConfig', 'true')
    await git('-C', linked, 'config', '--worktree', 'remote.linked-only.url', directory)
    const read = vi.fn(readBranchData)
    const notify = vi.fn()
    const service = new BranchService(notify, undefined, read, {
      start: vi.fn().mockResolvedValue(true),
      stop: vi.fn(),
    })
    const target = { projectPath: directory, workspaceId: 'main' }
    service.subscribe('main', target)
    service.subscribe('linked', { ...target, workspaceId: 'linked' })
    const [main, worktree] = await Promise.all([
      service.query(directory, 'main'),
      service.query(linked, 'linked'),
    ])
    expect(read).toHaveBeenCalledTimes(1)
    expect(worktree.snapshot).toBe(main.snapshot)
    expect(main.remotes).toEqual([])
    expect(worktree.remotes).toEqual(['linked-only'])
    expect(branchReferences(main.snapshot, main.remotes)).toEqual(
      await sourceControl.references(directory),
    )
    expect(
      main.snapshot.branches.find((branch) => branch.ref === 'refs/heads/linked')?.worktreePath,
    ).toBe(linked)
    expect(main.snapshot.branches.every((branch) => /^[a-f0-9]{40}$/.test(branch.oid))).toBe(true)
    service.invalidateRepository('/unrelated-repository')
    service.invalidateRepository(join(directory, '.git'), ['config'])
    expect((await service.query(directory, 'main')).snapshot).toBe(main.snapshot)
    expect(read).toHaveBeenCalledTimes(1)

    let started!: () => void
    let finish!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    read.mockImplementationOnce(async (...args) => {
      const data = await readBranchData(...args)
      started()
      await gate
      return data
    })
    const pending = service.query(directory, 'main', true)
    await reading
    await git('branch', 'external')
    service.invalidate(directory)
    finish()
    const refreshed = await pending
    expect(refreshed.stale).toBe(false)
    expect(refreshed.snapshot.revision).toBeGreaterThan(main.snapshot.revision)
    expect(refreshed.snapshot.branches.some((branch) => branch.label === 'external')).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
    expect(notify).toHaveBeenCalledWith(main.snapshot.repositoryId)

    let entered!: () => void
    let resume!: () => void
    const enteredRead = new Promise<void>((resolve) => {
      entered = resolve
    })
    const paused = new Promise<void>((resolve) => {
      resume = resolve
    })
    read.mockImplementationOnce(async (...args) => {
      const data = await readBranchData(...args)
      entered()
      await paused
      return data
    })
    const removed = service.query(directory, 'main', true)
    const rejected = expect(removed).rejects.toThrow('工作区或分支资源已改变')
    await enteredRead
    const surviving = service.query(linked, 'linked')
    service.prune([{ ...target, workspaceId: 'linked' }])
    resume()
    await rejected
    expect((await surviving).snapshot.repositoryId).toBe(main.snapshot.repositoryId)
    service.release('linked')
    service.subscribe('reopened', target)
    expect((await service.query(directory, 'reopened')).snapshot.repositoryId).not.toBe(
      main.snapshot.repositoryId,
    )
    service.close()
    await expect(service.query(directory, 'reopened')).rejects.toThrow('订阅已结束')
  })

  it('reads unborn branches and safely manages nested, partially staged files', async () => {
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

    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    const name = 'nested/中文 [文件]*\n.txt'
    const file = { path: name, area: 'untracked' as const }
    await writeFile(join(directory, name), 'first\n')
    const initial = await sourceControl.status(nested, true)
    expect(initial.rootPath).toBe(directory)
    expect(initial.head).toBeNull()
    expect(initial.branch).toBe('feature/工作区')
    expect(await sourceControl.history(directory)).toEqual({ head: null, commits: [], more: false })
    expect(initial.entries).toEqual([
      expect.objectContaining({ ...file, stats: { additions: 1, deletions: 0 } }),
    ])
    expect(await sourceControl.diff(directory, file)).toEqual({
      kind: 'text',
      original: '',
      modified: 'first\n',
    })
    const target = { projectPath: directory, workspaceId: 'fixture' }
    const noConfirm = vi.fn().mockResolvedValue(false)
    await sourceControl.mutate(directory, { ...target, action: 'stage', files: [file] }, noConfirm)
    await writeFile(join(directory, name), 'second\n')
    const partial = await sourceControl.status(directory, true)
    expect(partial.entries.map((entry) => [entry.area, entry.stats])).toEqual([
      ['staged', { additions: 1, deletions: 0 }],
      ['unstaged', { additions: 1, deletions: 1 }],
    ])
    expect(await sourceControl.diff(directory, { ...file, area: 'staged' })).toEqual({
      kind: 'text',
      original: '',
      modified: 'first\n',
    })
    expect(await sourceControl.diff(directory, { ...file, area: 'unstaged' })).toEqual({
      kind: 'text',
      original: 'first\n',
      modified: 'second\n',
    })
    await sourceControl.mutate(
      directory,
      { ...target, action: 'unstage', files: [{ ...file, area: 'staged' }] },
      noConfirm,
    )
    expect(await readFile(join(directory, name), 'utf8')).toBe('second\n')
    await sourceControl.mutate(directory, { ...target, action: 'stage', files: [file] }, noConfirm)
    const reviewed = await sourceControl.status(directory)
    await writeFile(join(directory, name), 'third\n')
    const discard = {
      ...target,
      action: 'discard' as const,
      files: [{ ...file, area: 'unstaged' as const }],
    }
    expect(await sourceControl.mutate(directory, discard, noConfirm)).toBe(false)
    expect(await readFile(join(directory, name), 'utf8')).toBe('third\n')
    await expect(
      sourceControl.mutate(directory, discard, async () => {
        await writeFile(join(directory, name), 'agent changed it\n')
        return true
      }),
    ).rejects.toThrow('已改变')
    expect(await readFile(join(directory, name), 'utf8')).toBe('agent changed it\n')
    await sourceControl.mutate(directory, discard, async () => true)
    expect(await readFile(join(directory, name), 'utf8')).toBe('second\n')
    expect(noConfirm).toHaveBeenCalledTimes(1)
    await expect(
      sourceControl.mutate(
        directory,
        { ...target, action: 'commit', message: 'initial', indexVersion: 'outdated' },
        noConfirm,
      ),
    ).rejects.toThrow('已改变')
    await sourceControl.mutate(
      directory,
      { ...target, action: 'commit', message: 'initial', indexVersion: reviewed.indexVersion },
      noConfirm,
    )
    expect((await sourceControl.status(directory)).entries).toEqual([])
    const history = await sourceControl.history(directory)
    expect(history.commits).toHaveLength(1)
    expect(history.commits[0]).toMatchObject({ subject: 'initial', author: 'Cota', parents: [] })
    const root = await sourceControl.compare(directory, { kind: 'commit', commit: history.head! })
    expect(root.base).toBeNull()
    expect(root.entries).toEqual([
      expect.objectContaining({
        path: name,
        status: 'A',
        stats: { additions: 1, deletions: 0 },
      }),
    ])
    expect(
      await sourceControl.diff(directory, {
        ...root.entries[0],
        area: 'review',
        base: root.base,
        head: root.head,
        label: root.label,
      }),
    ).toEqual({ kind: 'text', original: '', modified: 'second\n' })
    await expect(sourceControl.history(directory, { head: '--all' })).rejects.toThrow('完整')
    await expect(sourceControl.history(directory, { offset: -1 })).rejects.toThrow('分页')
    await expect(
      sourceControl.compare(directory, { kind: 'branch', ref: 'HEAD~1' }),
    ).rejects.toThrow('明确')
    await writeFile(join(directory, name), Buffer.from([0, 1, 2]))
    expect(await sourceControl.diff(directory, { ...file, area: 'unstaged' })).toEqual(
      expect.objectContaining({ kind: 'unavailable' }),
    )
    expect((await sourceControl.status(directory, true)).entries[0].stats).toBeNull()
    await sourceControl.mutate(directory, discard, async () => true)
    const outside = join(directory, 'outside.txt')
    await writeFile(outside, 'do not delete')
    await symlink(outside, join(nested, 'link'))
    await sourceControl.mutate(
      directory,
      { ...target, action: 'discard', files: [{ path: 'nested/link', area: 'untracked' }] },
      async () => true,
    )
    expect(await readFile(outside, 'utf8')).toBe('do not delete')
    await expect(
      sourceControl.diff(directory, { path: '../outside.txt', area: 'untracked' }),
    ).rejects.toThrow('路径无效')
    await expect(
      sourceControl.mutate(
        directory,
        { ...target, action: 'discard', files: [{ path: '.git/config', area: 'untracked' }] },
        noConfirm,
      ),
    ).rejects.toThrow('路径无效')
    const samples = [
      ['nested/new\t中文\n.txt', Buffer.from('one\r\ntwo')],
      ['nested/empty.txt', Buffer.alloc(0)],
      ['nested/binary.dat', Buffer.from([0, 1, 2])],
      ['nested/large.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65)],
    ] as const
    for (const [path, bytes] of samples) await writeFile(join(directory, path), bytes)
    await rm(join(directory, name))
    const counts = await sourceControl.status(nested, true)
    expect(counts.entries.find((entry) => entry.path === name)?.stats).toEqual({
      additions: 0,
      deletions: 1,
    })
    expect(counts.entries.find((entry) => entry.path === samples[0][0])?.stats).toEqual({
      additions: 2,
      deletions: 0,
    })
    expect(counts.entries.find((entry) => entry.path === samples[1][0])?.stats).toEqual({
      additions: 0,
      deletions: 0,
    })
    expect(counts.entries.find((entry) => entry.path === samples[2][0])?.stats).toBeNull()
    expect(counts.entries.find((entry) => entry.path === samples[3][0])?.stats).toBeUndefined()
    await git('restore', '--worktree', '--', `:(literal)${name}`)
    const renamed = 'nested/renamed\t中文\n.txt'
    await git('mv', '--', name, renamed)
    await git('config', 'diff.external', 'cota-must-not-run-external-diff')
    expect((await sourceControl.status(nested, true)).entries).toContainEqual(
      expect.objectContaining({
        path: renamed,
        oldPath: name,
        stats: { additions: 0, deletions: 0 },
      }),
    )
    expect(
      (await sourceControl.status(nested)).entries.every((entry) => entry.stats === undefined),
    ).toBe(true)
    const readGit = gitRunner.runGitBytes
    const failedStats = vi
      .spyOn(gitRunner, 'runGitBytes')
      .mockImplementation((cwd, args, writing, timeout) => {
        if (args.includes('--numstat')) return Promise.reject(new Error('Statistics unavailable'))
        return readGit(cwd, args, writing, timeout)
      })
    try {
      const unavailable = (await sourceControl.status(nested, true)).entries.find(
        (entry) => entry.path === renamed,
      )
      expect(unavailable).toMatchObject({ path: renamed, area: 'staged' })
      expect(unavailable?.stats).toBeUndefined()
      const comparison = await sourceControl.compare(directory, {
        kind: 'commit',
        commit: history.head!,
      })
      expect(comparison.entries).toEqual([expect.objectContaining({ path: name, status: 'A' })])
      expect(comparison.entries[0].stats).toBeUndefined()
    } finally {
      failedStats.mockRestore()
    }
    await writeFile(join(directory, renamed), 'third\n')
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const limitedStats = vi
      .spyOn(gitRunner, 'runGitBytes')
      .mockImplementation((cwd, args, writing, timeout) => {
        if (args.includes('--numstat')) {
          expect(timeout).toBe(500)
          clock.mockReturnValue(1500)
          return Promise.reject(new Error('Statistics timed out'))
        }
        return readGit(cwd, args, writing, timeout)
      })
    try {
      const limited = await sourceControl.status(nested, true)
      expect(limited.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: renamed, area: 'staged' }),
          expect.objectContaining({ path: renamed, area: 'unstaged' }),
          expect.objectContaining({ path: samples[0][0], area: 'untracked' }),
        ]),
      )
      expect(limited.entries.every((entry) => entry.stats === undefined)).toBe(true)
      expect(limitedStats.mock.calls.filter(([, args]) => args.includes('--numstat'))).toHaveLength(
        1,
      )
    } finally {
      limitedStats.mockRestore()
      clock.mockRestore()
    }
    await git('branch', 'comparison-base', history.head!)
    await writeFile(join(directory, renamed), 'second\n')
    await git('add', '--', renamed, samples[0][0], samples[2][0])
    await git('commit', '-m', 'rename and add files')
    const comparisonHead = (await sourceControl.status(directory)).head!
    for (const comparison of [
      await sourceControl.compare(directory, { kind: 'commit', commit: comparisonHead }),
      await sourceControl.compare(directory, { kind: 'branch', ref: 'refs/heads/comparison-base' }),
    ]) {
      expect(comparison.entries).toHaveLength(3)
      expect(comparison.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: renamed,
            oldPath: name,
            status: 'R',
            stats: { additions: 0, deletions: 0 },
          }),
          expect.objectContaining({
            path: samples[0][0],
            stats: { additions: 2, deletions: 0 },
          }),
          expect.objectContaining({ path: samples[2][0], stats: null }),
        ]),
      )
    }
  }, 30000)

  // Remote sync/conflict checks and 51 sequential commits need a separate integration-test budget.
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
    expect((await sourceControl.status(directory)).branch).toBeNull()
    const target = { projectPath: directory, workspaceId: 'fixture' }
    await writeFile(join(worktree, 'file.txt'), 'one\n')
    await writeFile(join(worktree, 'local.txt'), 'local baseline\n')
    await sourceControl.mutate(
      worktree,
      {
        ...target,
        action: 'stage',
        files: [
          { path: 'file.txt', area: 'untracked' },
          { path: 'local.txt', area: 'untracked' },
        ],
      },
      async () => false,
    )
    expect((await sourceControl.status(worktree)).branch).toBe('feature/worktree')
    expect((await sourceControl.status(worktree)).rootPath).toBe(worktree)
    expect(
      (await sourceControl.status(directory)).entries.map((entry) => entry.path),
    ).not.toContain('file.txt')
    await git(
      '-C',
      worktree,
      '-c',
      'user.name=Cota',
      '-c',
      'user.email=cota@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'file',
    )
    await rename(join(worktree, 'file.txt'), join(worktree, 'renamed 空格.txt'))
    await git('-C', worktree, 'add', '--', 'file.txt', 'renamed 空格.txt')
    expect((await sourceControl.status(worktree)).entries).toContainEqual(
      expect.objectContaining({ path: 'renamed 空格.txt', oldPath: 'file.txt', status: 'R' }),
    )
    expect(
      await sourceControl.diff(worktree, { path: 'renamed 空格.txt', area: 'staged' }),
    ).toEqual({ kind: 'text', original: 'one\n', modified: 'one\n' })
    await sourceControl.mutate(
      worktree,
      { ...target, action: 'unstage', files: [{ path: 'renamed 空格.txt', area: 'staged' }] },
      async () => false,
    )
    expect(await readFile(join(worktree, 'renamed 空格.txt'), 'utf8')).toBe('one\n')
    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    await git('-C', worktree, 'add', '-A')
    await git('-C', worktree, 'commit', '-m', 'rename')
    const renameHead = (await sourceControl.status(worktree)).head!
    const review = await sourceControl.compare(worktree, { kind: 'commit', commit: renameHead })
    expect(review.entries).toEqual([
      expect.objectContaining({ path: 'renamed 空格.txt', oldPath: 'file.txt', status: 'R' }),
    ])
    await writeFile(join(worktree, 'renamed 空格.txt'), 'not committed\n')
    expect(
      await sourceControl.diff(worktree, {
        ...review.entries[0],
        area: 'review',
        base: review.base,
        head: review.head,
        label: review.label,
      }),
    ).toEqual({ kind: 'text', original: 'one\n', modified: 'one\n' })
    await git('-C', worktree, 'restore', '--worktree', '--', 'renamed 空格.txt')
    const branchReview = await sourceControl.compare(worktree, {
      kind: 'branch',
      ref: 'refs/heads/main',
    })
    expect(branchReview.base).toBe((await git('rev-parse', 'main')).stdout.trim())
    const branchHistory = await sourceControl.history(worktree, {
      head: branchReview.head,
      base: branchReview.base!,
    })
    expect(branchHistory.commits.map((item) => item.oid)).toEqual([renameHead, review.base])
    expect(branchReview.entries).toEqual([
      expect.objectContaining({ path: 'local.txt', status: 'A' }),
      expect.objectContaining({ path: 'renamed 空格.txt', status: 'A' }),
    ])

    const remote = join(directory, 'remote.git')
    const peer = join(directory, 'peer')
    await git('init', '--bare', '--initial-branch=main', remote)
    await git('-C', worktree, 'remote', 'add', 'review', remote)
    const initialReferences = await sourceControl.references(worktree)
    expect(initialReferences.remotes).toEqual(['review'])
    expect(initialReferences.defaultBranchRef).toBeUndefined()
    const publish = {
      ...target,
      action: 'publish' as const,
      remote: 'review',
      branch: 'feature/worktree',
      head: renameHead,
    }
    await expect(
      sourceControl.mutate(worktree, { ...publish, remote: peer }, async () => true),
    ).rejects.toThrow('已配置')
    const noConfirmation = vi.fn().mockResolvedValue(false)
    const branchOperations = new BranchService()
    const remoteWrites = vi.fn()
    expect(await branchOperations.mutate(worktree, publish, sourceControl, remoteWrites)).toBe(true)
    expect(remoteWrites).toHaveBeenCalledExactlyOnceWith([remote])
    branchOperations.close()
    expect(noConfirmation).not.toHaveBeenCalled()
    await git('symbolic-ref', 'refs/remotes/review/HEAD', 'refs/remotes/review/feature/worktree')
    const references = await sourceControl.references(worktree)
    expect(references.defaultBranchRef).toBe('refs/remotes/review/feature/worktree')
    expect(references.branches.some((branch) => branch.ref.endsWith('/HEAD'))).toBe(false)
    await git('remote', 'add', 'origin', remote)
    await git('update-ref', 'refs/remotes/origin/develop', renameHead)
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    expect((await sourceControl.references(worktree)).defaultBranchRef).toBe(
      'refs/remotes/origin/develop',
    )
    await git('update-ref', '-d', 'refs/remotes/origin/develop')
    expect((await sourceControl.references(worktree)).defaultBranchRef).toBe(
      'refs/remotes/review/feature/worktree',
    )
    await git('remote', 'remove', 'origin')
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(renameHead)
    let current = await sourceControl.status(worktree)
    expect(current.tracking).toEqual({ remote: 'review', branch: 'feature/worktree' })
    await git('clone', '--branch', 'feature/worktree', remote, peer)
    await git('-C', peer, 'config', 'user.name', 'Peer')
    await git('-C', peer, 'config', 'user.email', 'peer@example.test')
    await git('-C', peer, 'config', 'commit.gpgsign', 'false')
    await git('-C', peer, 'config', 'core.hooksPath', '/dev/null')
    await writeFile(join(peer, 'renamed 空格.txt'), 'peer\n')
    await writeFile(join(peer, 'ignored.txt'), 'from remote\n')
    await git('-C', peer, 'add', '-A')
    await git('-C', peer, 'commit', '-m', 'remote change')
    await git('-C', peer, 'push', 'origin', 'HEAD:refs/heads/feature/worktree')
    // A custom fetch mapping must never let Fetch overwrite a local branch namespace.
    await git('-C', worktree, 'config', 'remote.review.fetch', '+refs/heads/*:refs/heads/unsafe/*')
    await sourceControl.mutate(
      worktree,
      { ...target, action: 'fetch', remote: 'review' },
      async () => true,
    )
    await expect(
      git('show-ref', '--verify', 'refs/heads/unsafe/feature/worktree'),
    ).rejects.toThrow()
    await git(
      '-C',
      worktree,
      'config',
      'remote.review.fetch',
      '+refs/heads/*:refs/remotes/review/*',
    )
    current = await sourceControl.status(worktree)
    expect(current.head).toBe(renameHead)
    expect(current.behind).toBe(1)
    const pull = {
      ...target,
      action: 'pull' as const,
      branch: current.branch!,
      head: current.head!,
      tracking: current.tracking!,
    }
    await writeFile(join(worktree, 'dirty.txt'), 'keep me')
    await writeFile(join(worktree, 'local.txt'), 'uncommitted local changes\n')
    await writeFile(join(worktree, 'renamed 空格.txt'), 'overlapping local changes\n')
    await expect(sourceControl.mutate(worktree, pull, async () => true)).rejects.toThrow(
      'would be overwritten by merge',
    )
    expect((await sourceControl.status(worktree)).head).toBe(renameHead)
    expect(await readFile(join(worktree, 'renamed 空格.txt'), 'utf8')).toBe(
      'overlapping local changes\n',
    )
    await git('-C', worktree, 'restore', '--worktree', '--', 'renamed 空格.txt')
    await git('-C', worktree, 'add', '--', 'local.txt')
    await writeFile(join(worktree, 'local.txt'), 'unstaged local changes\n')
    const exclude = (
      await git('-C', worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude')
    ).stdout.trim()
    await writeFile(exclude, 'ignored.txt\n')
    await writeFile(join(worktree, 'ignored.txt'), 'precious ignored content')
    await git('-C', worktree, 'config', 'pull.rebase', 'true')
    await git('-C', worktree, 'config', 'merge.autoStash', 'true')
    await expect(sourceControl.mutate(worktree, pull, async () => true)).rejects.toThrow()
    expect(await readFile(join(worktree, 'ignored.txt'), 'utf8')).toBe('precious ignored content')
    expect((await sourceControl.status(worktree)).head).toBe(renameHead)
    await rm(join(worktree, 'ignored.txt'))
    await sourceControl.mutate(worktree, pull, async () => true)
    expect(await readFile(join(worktree, 'renamed 空格.txt'), 'utf8')).toBe('peer\n')
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe('keep me')
    expect(await readFile(join(worktree, 'local.txt'), 'utf8')).toBe('unstaged local changes\n')
    expect((await git('-C', worktree, 'show', ':local.txt')).stdout).toBe(
      'uncommitted local changes\n',
    )
    expect((await sourceControl.status(worktree)).entries).toEqual([
      expect.objectContaining({ path: 'local.txt', area: 'staged' }),
      expect.objectContaining({ path: 'local.txt', area: 'unstaged' }),
      expect.objectContaining({ path: 'dirty.txt', area: 'untracked' }),
    ])
    await rm(join(worktree, 'dirty.txt'))
    await git('-C', worktree, 'restore', '--staged', '--worktree', '--', 'local.txt')

    await git('-C', worktree, 'commit', '--allow-empty', '-m', 'local change')
    current = await sourceControl.status(worktree)
    const push = {
      ...target,
      action: 'push' as const,
      branch: current.branch!,
      head: current.head!,
      tracking: current.tracking!,
    }
    const beforePush = (
      await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
    ).stdout.trim()
    const readStatus = sourceControl.status.bind(sourceControl)
    const movingHead = vi.spyOn(sourceControl, 'status').mockImplementationOnce(async (cwd) => {
      const snapshot = await readStatus(cwd)
      await git('-C', worktree, 'commit', '--allow-empty', '-m', 'agent moved HEAD')
      return snapshot
    })
    try {
      await expect(sourceControl.mutate(worktree, push, noConfirmation)).rejects.toThrow(
        'HEAD 已改变',
      )
    } finally {
      movingHead.mockRestore()
    }
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(beforePush)
    current = await sourceControl.status(worktree)
    await writeFile(join(worktree, 'local.txt'), 'staged, not committed\n')
    await git('-C', worktree, 'add', '--', 'local.txt')
    await sourceControl.mutate(worktree, { ...push, head: current.head! }, noConfirmation)
    expect(noConfirmation).not.toHaveBeenCalled()
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(current.head)
    expect((await git('--git-dir', remote, 'show', 'feature/worktree:local.txt')).stdout).toBe(
      'local baseline\n',
    )
    expect((await sourceControl.status(worktree)).entries).toEqual([
      expect.objectContaining({ path: 'local.txt', area: 'staged' }),
    ])
    await git('-C', worktree, 'restore', '--staged', '--worktree', '--', 'local.txt')

    // Push and Pull must refuse divergence even if user configuration requests mirror/rebase/autostash.
    await git('-C', peer, 'fetch', 'origin')
    await git('-C', peer, 'merge', '--ff-only', 'origin/feature/worktree')
    await git('-C', peer, 'commit', '--allow-empty', '-m', 'peer diverged')
    await git('-C', peer, 'push', 'origin', 'HEAD:refs/heads/feature/worktree')
    await git('-C', worktree, 'commit', '--allow-empty', '-m', 'local diverged')
    current = await sourceControl.status(worktree)
    const divergence = { ...push, head: current.head! }
    await expect(
      sourceControl.mutate(worktree, { ...divergence, action: 'pull' }, async () => true),
    ).rejects.toThrow()
    expect((await sourceControl.status(worktree)).head).toBe(current.head)
    await git('-C', worktree, 'config', 'remote.review.mirror', 'true')
    await expect(sourceControl.mutate(worktree, divergence, async () => true)).rejects.toThrow()
    await expect(git('-C', worktree, 'rev-parse', '--verify', 'MERGE_HEAD')).rejects.toThrow()
    expect((await git('-C', worktree, 'stash', 'list')).stdout).toBe('')

    // Sync merges divergence and pushes without a separate confirmation.
    await git('-C', worktree, 'config', 'remote.review.mirror', 'false')
    const sync = { ...divergence, action: 'sync' as const }
    const syncRemoteHead = (
      await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
    ).stdout.trim()
    await writeFile(join(worktree, 'local.txt'), 'keep during sync\n')
    await writeFile(join(worktree, 'dirty.txt'), 'keep untracked during sync\n')
    await git('-C', worktree, 'add', '--', 'local.txt')
    await expect(sourceControl.mutate(worktree, sync, noConfirmation)).rejects.toThrow(
      '拉取合并未完成，未执行推送',
    )
    expect(noConfirmation).not.toHaveBeenCalled()
    expect((await sourceControl.status(worktree)).head).toBe(current.head)
    expect((await sourceControl.status(worktree)).entries).toContainEqual(
      expect.objectContaining({ path: 'local.txt', area: 'staged' }),
    )
    await git('-C', worktree, 'restore', '--staged', '--', 'local.txt')
    expect(await sourceControl.mutate(worktree, sync, noConfirmation)).toBe(true)
    const merged = await sourceControl.status(worktree)
    expect(merged.entries).toEqual([
      expect.objectContaining({ path: 'local.txt', area: 'unstaged' }),
      expect.objectContaining({ path: 'dirty.txt', area: 'untracked' }),
    ])
    expect((await git('-C', worktree, 'rev-parse', 'HEAD^1')).stdout.trim()).toBe(current.head)
    expect((await git('-C', worktree, 'rev-parse', 'HEAD^2')).stdout.trim()).toBe(syncRemoteHead)
    expect(noConfirmation).not.toHaveBeenCalled()
    expect(merged.ahead).toBe(0)
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(merged.head)
    expect((await git('--git-dir', remote, 'show', 'feature/worktree:local.txt')).stdout).toBe(
      'local baseline\n',
    )
    expect(await readFile(join(worktree, 'local.txt'), 'utf8')).toBe('keep during sync\n')
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe('keep untracked during sync\n')
    const alreadySynced = vi.fn().mockResolvedValue(true)
    await sourceControl.mutate(worktree, { ...sync, head: merged.head! }, alreadySynced)
    expect(alreadySynced).not.toHaveBeenCalled()
    await rm(join(worktree, 'dirty.txt'))
    await git('-C', worktree, 'restore', '--worktree', '--', 'local.txt')

    await git('-C', peer, 'fetch', 'origin')
    await git('-C', peer, 'merge', '--ff-only', 'origin/feature/worktree')
    await writeFile(join(peer, 'renamed 空格.txt'), 'remote conflict\n')
    await git('-C', peer, 'commit', '-am', 'remote conflict')
    await git('-C', peer, 'push', 'origin', 'HEAD:refs/heads/feature/worktree')
    const conflictRemote = (
      await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
    ).stdout.trim()
    await writeFile(join(worktree, 'renamed 空格.txt'), 'local conflict\n')
    await git('-C', worktree, 'commit', '-am', 'local conflict')
    current = await sourceControl.status(worktree)
    const noPushOnConflict = vi.fn().mockResolvedValue(true)
    await writeFile(join(worktree, 'dirty.txt'), 'keep local changes\n')
    await expect(
      sourceControl.mutate(worktree, { ...sync, head: current.head! }, noPushOnConflict),
    ).rejects.toThrow('拉取合并未完成，未执行推送')
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe('keep local changes\n')
    await expect(
      sourceControl.mutate(worktree, { ...sync, head: current.head! }, noPushOnConflict),
    ).rejects.toThrow('请先解决现有合并冲突')
    expect(noPushOnConflict).not.toHaveBeenCalled()
    expect((await sourceControl.status(worktree)).entries).toContainEqual(
      expect.objectContaining({ area: 'conflict', path: 'renamed 空格.txt' }),
    )
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(conflictRemote)
    expect((await git('-C', worktree, 'stash', 'list')).stdout).toBe('')
    await git('-C', worktree, 'merge', '--abort')
    await rm(join(worktree, 'dirty.txt'))

    const occupiedPath = join(directory, 'occupied')
    await git('worktree', 'add', '-b', 'feature/occupied', occupiedPath, 'HEAD')
    expect((await sourceControl.references(worktree)).branches).toContainEqual({
      ref: 'refs/heads/feature/occupied',
      label: 'feature/occupied',
      date: (await git('show', '-s', '--format=%cI', 'refs/heads/feature/occupied')).stdout.trim(),
      subject: 'initial',
      worktreePath: occupiedPath,
    })
    const switchBranch = {
      ...target,
      action: 'switch-branch' as const,
      branch: current.branch,
      head: current.head,
      ref: 'refs/heads/main',
    }
    await expect(
      sourceControl.mutate(
        worktree,
        { ...switchBranch, ref: 'refs/heads/feature/occupied' },
        noPushOnConflict,
      ),
    ).rejects.toThrow('Worktree 占用')
    await expect(
      sourceControl.mutate(
        worktree,
        { ...switchBranch, ref: 'refs/remotes/review/feature/worktree' },
        noPushOnConflict,
      ),
    ).rejects.toThrow('本地分支「feature/worktree」已存在')
    await expect(
      sourceControl.mutate(worktree, { ...switchBranch, head: renameHead }, noPushOnConflict),
    ).rejects.toThrow('HEAD 已改变')
    await writeFile(join(worktree, 'dirty.txt'), 'keep before switching\n')
    await expect(sourceControl.mutate(worktree, switchBranch, noPushOnConflict)).rejects.toThrow(
      '切换分支前',
    )
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe('keep before switching\n')
    await rm(join(worktree, 'dirty.txt'))
    await git('-C', worktree, 'branch', 'feature/切换')
    expect(await sourceControl.mutate(worktree, switchBranch, noPushOnConflict)).toBe(true)
    expect((await sourceControl.status(worktree)).branch).toBe('main')
    const onMain = await sourceControl.status(worktree)
    const switchBack = {
      ...switchBranch,
      branch: onMain.branch,
      head: onMain.head,
      ref: 'refs/heads/feature/切换',
    }
    await writeFile(exclude, 'ignored.txt\nrenamed 空格.txt\n')
    await writeFile(join(worktree, 'renamed 空格.txt'), 'precious ignored content\n')
    await expect(sourceControl.mutate(worktree, switchBack, noPushOnConflict)).rejects.toThrow()
    expect(await readFile(join(worktree, 'renamed 空格.txt'), 'utf8')).toBe(
      'precious ignored content\n',
    )
    expect((await sourceControl.status(worktree)).branch).toBe('main')
    await rm(join(worktree, 'renamed 空格.txt'))
    await sourceControl.mutate(worktree, switchBack, noPushOnConflict)
    expect((await sourceControl.status(worktree)).branch).toBe('feature/切换')
    expect(noPushOnConflict).not.toHaveBeenCalled()

    const beforeRemoteSwitch = await sourceControl.status(worktree)
    const switchRemote = {
      ...switchBranch,
      branch: beforeRemoteSwitch.branch,
      head: beforeRemoteSwitch.head,
      ref: 'refs/remotes/review/feature/远端',
    }
    await git('-C', worktree, 'update-ref', switchRemote.ref, beforeRemoteSwitch.head!)
    await expect(
      sourceControl.mutate(
        worktree,
        { ...switchRemote, ref: 'refs/remotes/review/HEAD' },
        noPushOnConflict,
      ),
    ).rejects.toThrow('明确分支')
    await writeFile(join(worktree, 'dirty.txt'), 'keep before remote switching\n')
    await expect(sourceControl.mutate(worktree, switchRemote, noPushOnConflict)).rejects.toThrow(
      '切换分支前',
    )
    await expect(
      git('-C', worktree, 'show-ref', '--verify', 'refs/heads/feature/远端'),
    ).rejects.toThrow()
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe(
      'keep before remote switching\n',
    )
    await rm(join(worktree, 'dirty.txt'))
    expect(await sourceControl.mutate(worktree, switchRemote, noPushOnConflict)).toBe(true)
    expect(await sourceControl.status(worktree)).toMatchObject({
      branch: 'feature/远端',
      head: beforeRemoteSwitch.head,
      tracking: { remote: 'review', branch: 'feature/远端' },
    })
    expect((await git('-C', worktree, 'rev-parse', switchRemote.ref)).stdout.trim()).toBe(
      beforeRemoteSwitch.head,
    )
    expect(noPushOnConflict).not.toHaveBeenCalled()

    for (let i = 0; i < 51; i++)
      await git('-C', worktree, 'commit', '--allow-empty', '-m', `page ${i}`)
    const page = await sourceControl.history(worktree)
    expect(page.commits).toHaveLength(50)
    expect(page.more).toBe(true)
    await git('-C', worktree, 'commit', '--allow-empty', '-m', 'after snapshot')
    const next = await sourceControl.history(worktree, { head: page.head!, offset: 50 })
    expect(next.more).toBe(false)
    expect(next.head).toBe(page.head)
    expect(next.commits.at(-1)?.subject).toBe('initial')
    expect(new Set([...page.commits, ...next.commits].map((item) => item.oid)).size).toBe(
      50 + next.commits.length,
    )
    expect(
      [...page.commits, ...next.commits].some((item) => item.subject === 'after snapshot'),
    ).toBe(false)
    const range = await sourceControl.history(worktree, {
      head: page.head!,
      base: beforeRemoteSwitch.head!,
    })
    expect(range.commits).toHaveLength(50)
    expect(range.more).toBe(true)
    const rangeNext = await sourceControl.history(worktree, {
      head: page.head!,
      base: beforeRemoteSwitch.head!,
      offset: 50,
    })
    expect(rangeNext.more).toBe(false)
    expect(rangeNext.commits.map((item) => item.subject)).toEqual(['page 0'])
    expect(new Set([...range.commits, ...rangeNext.commits].map((item) => item.oid)).size).toBe(51)
    expect(
      [...range.commits, ...rangeNext.commits].some((item) => item.subject === 'after snapshot'),
    ).toBe(false)
    expect(await sourceControl.history(worktree, { head: page.head!, base: page.head! })).toEqual({
      head: page.head,
      commits: [],
      more: false,
    })
    await expect(
      sourceControl.history(worktree, { head: page.head!, base: '--all' }),
    ).rejects.toThrow('完整')
    await expect(sourceControl.history(worktree, { base: page.head! })).rejects.toThrow('明确')
    await git('-C', worktree, 'switch', '--orphan', 'unrelated')
    await git('-C', worktree, 'commit', '--allow-empty', '-m', 'unrelated')
    await expect(
      sourceControl.compare(worktree, { kind: 'branch', ref: 'refs/heads/main' }),
    ).rejects.toThrow('没有共同祖先')
  }, 120000)

  it('creates local branches with optional atomic switching while preserving staged and working files', async () => {
    await git('init', '--initial-branch=main')
    const target = { projectPath: directory, workspaceId: 'fixture' }
    const noConfirmation = vi.fn().mockResolvedValue(false)
    const create = {
      ...target,
      action: 'create-branch' as const,
      name: 'feature/新分支',
      head: '0'.repeat(40),
    }
    await expect(sourceControl.mutate(directory, create, noConfirmation)).rejects.toThrow(
      '还没有提交',
    )
    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    await git('commit', '--allow-empty', '-m', 'initial')
    await git('config', 'branch.autoSetupMerge', 'always')
    await writeFile(join(directory, 'staged.txt'), 'staged content\n')
    await git('add', 'staged.txt')
    await writeFile(join(directory, 'staged.txt'), 'working content\n')
    await writeFile(join(directory, 'untracked.txt'), 'untracked content\n')
    const before = await sourceControl.status(directory)
    await expect(sourceControl.mutate(directory, create, noConfirmation)).rejects.toThrow(
      'HEAD 已改变',
    )
    const input = { ...create, head: before.head! }
    for (const name of [
      '-bad',
      'a..b',
      '@{-1}',
      'HEAD',
      ' bad ',
      'bad\nname',
      'a//b',
      '.hidden',
      'a.lock',
      'a b',
      'a\\b',
    ]) {
      await expect(
        sourceControl.mutate(directory, { ...input, name }, noConfirmation),
      ).rejects.toThrow()
      if (name !== ' bad ') expect(createBranchFormSchema.safeParse({ name }).success).toBe(false)
    }
    expect(createBranchFormSchema.parse({ name: ` ${input.name} ` }).name).toBe(input.name)
    expect(await sourceControl.mutate(directory, input, noConfirmation)).toBe(true)
    expect((await git('rev-parse', `refs/heads/${input.name}`)).stdout.trim()).toBe(before.head)
    await expect(git('config', '--get', `branch.${input.name}.remote`)).rejects.toThrow()
    await expect(sourceControl.mutate(directory, input, noConfirmation)).rejects.toThrow()
    expect((await git('rev-parse', `refs/heads/${input.name}`)).stdout.trim()).toBe(before.head)
    const after = await sourceControl.status(directory)
    expect(after.head).toBe(before.head)
    expect(after.branch).toBe(before.branch)
    expect(after.entries).toEqual(before.entries)
    expect((await git('show', ':staged.txt')).stdout).toBe('staged content\n')
    expect(await readFile(join(directory, 'staged.txt'), 'utf8')).toBe('working content\n')
    expect(await readFile(join(directory, 'untracked.txt'), 'utf8')).toBe('untracked content\n')
    const createAndSwitch = {
      ...input,
      action: 'create-and-switch-branch' as const,
      branch: before.branch,
      name: 'feature/创建并切换',
    }
    for (const name of ['-bad', 'a..b', '@{-1}', 'HEAD', ' bad ', 'bad\nname', input.name])
      await expect(
        sourceControl.mutate(directory, { ...createAndSwitch, name }, noConfirmation),
      ).rejects.toThrow()
    await expect(
      sourceControl.mutate(directory, { ...createAndSwitch, head: '0'.repeat(40) }, noConfirmation),
    ).rejects.toThrow('HEAD 已改变')
    await expect(
      sourceControl.mutate(directory, { ...createAndSwitch, branch: 'stale' }, noConfirmation),
    ).rejects.toThrow('分支已改变')
    await writeFile(join(directory, '.git/index.lock'), '')
    await expect(sourceControl.mutate(directory, createAndSwitch, noConfirmation)).rejects.toThrow()
    await rm(join(directory, '.git/index.lock'))
    await expect(
      git('show-ref', '--verify', `refs/heads/${createAndSwitch.name}`),
    ).rejects.toThrow()
    expect((await sourceControl.status(directory)).branch).toBe(before.branch)
    expect(await sourceControl.mutate(directory, createAndSwitch, noConfirmation)).toBe(true)
    const switched = await sourceControl.status(directory)
    expect(switched.branch).toBe(createAndSwitch.name)
    expect(switched.head).toBe(before.head)
    expect(switched.entries).toEqual(before.entries)
    expect((await git('show', ':staged.txt')).stdout).toBe('staged content\n')
    expect(await readFile(join(directory, 'staged.txt'), 'utf8')).toBe('working content\n')
    expect(await readFile(join(directory, 'untracked.txt'), 'utf8')).toBe('untracked content\n')
    await expect(git('config', '--get', `branch.${createAndSwitch.name}.remote`)).rejects.toThrow()
    await git('switch', '--detach', 'HEAD')
    expect(
      await sourceControl.mutate(directory, { ...input, name: 'from-detached' }, noConfirmation),
    ).toBe(true)
    expect((await sourceControl.status(directory)).branch).toBeNull()
    expect(
      await sourceControl.mutate(
        directory,
        { ...createAndSwitch, branch: null, name: 'from-detached-and-switch' },
        noConfirmation,
      ),
    ).toBe(true)
    expect((await sourceControl.status(directory)).branch).toBe('from-detached-and-switch')
    expect((await sourceControl.status(directory)).entries).toEqual(before.entries)
    expect(noConfirmation).not.toHaveBeenCalled()
  }, 30000)

  it('safely deletes only unused, merged local branches without changing working files or remote refs', async () => {
    await git('init', '--initial-branch=main')
    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    await git('commit', '--allow-empty', '-m', 'initial')
    await git('branch', 'feature/可删除')
    const head = (await git('rev-parse', 'HEAD')).stdout.trim()
    await git('update-ref', 'refs/remotes/origin/feature/可删除', head)
    const linked = join(directory, 'linked')
    await git('worktree', 'add', '-b', 'occupied', linked)
    await git('switch', '-c', 'unmerged')
    await git('commit', '--allow-empty', '-m', 'not merged')
    const unmerged = (await git('rev-parse', 'HEAD')).stdout.trim()
    await git('switch', 'main')
    await writeFile(join(directory, 'precious.txt'), 'staged content\n')
    await git('add', 'precious.txt')
    await writeFile(join(directory, 'precious.txt'), 'working content\n')
    const before = await sourceControl.status(directory)
    const input = {
      projectPath: directory,
      workspaceId: 'fixture',
      action: 'delete-branch' as const,
      ref: 'refs/heads/feature/可删除',
      branch: before.branch,
      head: before.head,
    }
    const noConfirmation = vi.fn().mockResolvedValue(false)
    for (const ref of ['refs/remotes/origin/feature/可删除', 'refs/heads/-bad', 'refs/heads/a..b'])
      await expect(
        sourceControl.mutate(directory, { ...input, ref }, noConfirmation),
      ).rejects.toThrow()
    await expect(
      sourceControl.mutate(directory, { ...input, head: '0'.repeat(40) }, noConfirmation),
    ).rejects.toThrow('HEAD 已改变')
    await expect(
      sourceControl.mutate(directory, { ...input, ref: 'refs/heads/main' }, noConfirmation),
    ).rejects.toThrow('不能删除当前分支')
    await expect(
      sourceControl.mutate(directory, { ...input, ref: 'refs/heads/occupied' }, noConfirmation),
    ).rejects.toThrow('Worktree 占用')
    await expect(
      sourceControl.mutate(directory, { ...input, ref: 'refs/heads/unmerged' }, noConfirmation),
    ).rejects.toThrow()
    expect((await git('rev-parse', 'refs/heads/unmerged')).stdout.trim()).toBe(unmerged)
    expect((await git('rev-parse', 'refs/heads/occupied')).stdout.trim()).toBe(head)
    expect(await sourceControl.mutate(directory, input, noConfirmation)).toBe(true)
    await expect(git('show-ref', '--verify', input.ref)).rejects.toThrow()
    expect((await git('rev-parse', 'refs/remotes/origin/feature/可删除')).stdout.trim()).toBe(head)
    expect(
      (await sourceControl.references(directory)).branches.some((b) => b.ref === input.ref),
    ).toBe(false)
    const after = await sourceControl.status(directory)
    expect(after.branch).toBe(before.branch)
    expect(after.head).toBe(before.head)
    expect(after.entries).toEqual(before.entries)
    expect((await git('show', ':precious.txt')).stdout).toBe('staged content\n')
    expect(await readFile(join(directory, 'precious.txt'), 'utf8')).toBe('working content\n')
    await expect(sourceControl.mutate(directory, input, noConfirmation)).rejects.toThrow()
    expect(noConfirmation).not.toHaveBeenCalled()
  }, 15000)

  it('watches worktree and shared metadata, filters noise and cleans up races and failures', async () => {
    await git('init', '--initial-branch=main')
    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    await writeFile(join(directory, 'tracked.txt'), 'initial')
    await git('add', '.')
    await git('commit', '-m', 'initial')
    const linked = join(directory, 'linked')
    await git('worktree', 'add', '-b', 'linked', linked)
    const gitDir = (await git('-C', linked, 'rev-parse', '--absolute-git-dir')).stdout.trim()
    const common = join(directory, '.git')
    const paths = new Map<
      string,
      { watcher: FSWatcher; emit(event: 'change' | 'rename', file: string | null): void }
    >()
    const watch = vi.fn((...args: unknown[]) => {
      const [path, , listener] = args
      if (typeof listener !== 'function') throw new Error('Missing listener')
      const watcher = new EventEmitter() as FSWatcher
      watcher.close = vi.fn(() => {
        watcher.emit('close')
      })
      paths.set(String(path), { watcher, emit: (event, file) => listener(event, file) })
      return watcher
    })
    const referencesChanged = vi.fn()
    const service = new SourceControlWatches(watch, referencesChanged)
    const notify = vi.fn()
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const originalRun = gitRunner.runGit
    const run = vi.spyOn(gitRunner, 'runGit').mockImplementation((cwd, args, writing) => {
      if (args[0] !== 'check-ignore') return originalRun(cwd, args, writing)
      if (args.includes('node_modules/generated.js'))
        return Promise.resolve('node_modules/generated.js\0')
      return Promise.reject(Object.assign(new Error('No ignored paths'), { cause: { code: 1 } }))
    })
    try {
      expect(await service.start(id, async () => linked, notify)).toBe(true)
      expect(paths.has(linked)).toBe(true)
      expect(paths.has(gitDir)).toBe(true)
      expect(paths.has(common)).toBe(true)
      expect(paths.has(join(common, 'refs'))).toBe(true)
      expect(paths.has(join(common, 'worktrees'))).toBe(true)
      const watchCount = watch.mock.calls.length
      const sharedId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      expect(await service.start(sharedId, async () => linked, vi.fn(), true)).toBe(true)
      expect(watch).toHaveBeenCalledTimes(watchCount)
      service.stop(sharedId)
      for (const { watcher } of paths.values()) expect(watcher.close).not.toHaveBeenCalled()
      vi.useFakeTimers()
      paths.get(linked)!.emit('change', '.git')
      paths.get(common)!.emit('change', 'index.lock')
      paths.get(join(common, 'refs'))!.emit('change', 'heads/linked.lock')
      await vi.advanceTimersByTimeAsync(3000)
      expect(notify).not.toHaveBeenCalled()
      paths.get(linked)!.emit('change', 'node_modules/generated.js')
      await vi.advanceTimersByTimeAsync(1000)
      expect(run).toHaveBeenCalledWith(linked, [
        'check-ignore',
        '-z',
        '--',
        'node_modules/generated.js',
      ])
      expect(notify).not.toHaveBeenCalled()
      paths.get(linked)!.emit('change', 'tracked.txt')
      await vi.advanceTimersByTimeAsync(4000)
      expect(notify.mock.calls).toEqual([['change']])
      expect(referencesChanged).not.toHaveBeenCalled()
      notify.mockClear()
      paths.get(gitDir)!.emit('rename', 'index')
      paths.get(gitDir)!.emit('rename', 'HEAD')
      paths.get(join(common, 'refs'))!.emit('change', 'remotes/origin/main')
      await vi.advanceTimersByTimeAsync(3000)
      expect(notify.mock.calls).toEqual([['change']])
      expect(referencesChanged).toHaveBeenCalledExactlyOnceWith(linked, ['head', 'refs'], common)
      referencesChanged.mockClear()
      paths.get(join(common, 'worktrees'))!.emit('change', 'another/HEAD')
      await vi.advanceTimersByTimeAsync(3000)
      expect(referencesChanged).toHaveBeenCalledExactlyOnceWith(linked, ['worktrees'], common)
      notify.mockClear()
      paths.get(gitDir)!.emit('change', 'HEAD')
      paths.get(linked)!.watcher.emit('error', new Error('watch limit'))
      expect(notify.mock.calls).toEqual([['unavailable']])
      await vi.advanceTimersByTimeAsync(5000)
      expect(notify).toHaveBeenCalledTimes(1)
      for (const { watcher } of paths.values()) expect(watcher.close).toHaveBeenCalledOnce()

      paths.clear()
      expect(await service.start(id, async () => linked, notify)).toBe(true)
      paths.get(common)!.emit('rename', 'refs')
      expect(notify).toHaveBeenLastCalledWith('unavailable')
      for (const { watcher } of paths.values()) expect(watcher.close).toHaveBeenCalledOnce()
      paths.clear()
      watch.mockImplementationOnce(() => {
        throw new Error('recursive watch unsupported')
      })
      expect(await service.start(id, async () => linked, notify)).toBe(false)
      let resolvePath!: (path: string) => void
      const pending = service.start(
        id,
        () =>
          new Promise((resolve) => {
            resolvePath = resolve
          }),
        notify,
      )
      const count = watch.mock.calls.length
      service.stop(id)
      resolvePath(linked)
      expect(await pending).toBe(false)
      expect(watch).toHaveBeenCalledTimes(count)

      expect(await service.start(id, async () => linked, notify)).toBe(true)
      service.close()
      for (const { watcher } of paths.values()) expect(watcher.close).toHaveBeenCalledOnce()
      await expect(service.start('invalid', async () => linked, notify)).rejects.toThrow()
    } finally {
      service.close()
      vi.useRealTimers()
    }
  })

  it('omits the subtitle for non-repositories or missing Git', async () => {
    expect(await projectBranch(directory)).toBeNull()
    await git('init', '--initial-branch=main')
    vi.stubEnv('PATH', directory)
    expect(await projectBranch(directory)).toBeNull()
  })

  it('scans all hosting accounts without mistaking failed credentials for no login or exposing tokens', () => {
    const github = parseHostingAccounts(
      'github',
      JSON.stringify({
        hosts: {
          'github.com': [
            {
              host: 'github.com',
              login: 'personal',
              active: true,
              state: 'success',
              token: 'secret',
            },
            { host: 'github.com', login: 'work', active: false, state: 'success' },
          ],
          'github.example.com': [
            {
              host: 'github.example.com',
              login: 'expired',
              active: true,
              state: 'error',
              error: 'secret',
            },
          ],
        },
      }),
    )
    expect(github).toEqual({
      status: 'detected',
      accounts: [
        { host: 'github.com', account: 'personal', active: true, status: 'connected' },
        { host: 'github.com', account: 'work', active: false, status: 'connected' },
        { host: 'github.example.com', account: 'expired', active: true, status: 'error' },
      ],
    })
    expect(
      parseHostingAccounts(
        'gitlab',
        JSON.stringify({
          hosts: [
            { host: 'gitlab.com', user: 'personal', state: 'success', token: 'secret' },
            { host: 'gitlab.example.com', state: 'error', error: 'secret' },
          ],
        }),
      ),
    ).toEqual({
      status: 'detected',
      accounts: [
        { host: 'gitlab.com', account: 'personal', active: true, status: 'connected' },
        { host: 'gitlab.example.com', account: '', active: true, status: 'error' },
      ],
    })
    for (const provider of ['github', 'gitlab'] as const) {
      expect(
        parseHostingAccounts(provider, JSON.stringify({ hosts: provider === 'github' ? {} : [] }))
          .status,
      ).toBe('disconnected')
      for (const invalid of [
        'secret',
        '{}',
        '{"hosts":[{"host":"https://secret","state":"success"}]}',
      ]) {
        expect(() => parseHostingAccounts(provider, invalid)).toThrow('账号列表格式无法识别')
      }
    }
    expect(() =>
      parseHostingAccounts('gitlab', '{"hosts":[{"host":"gitlab.com","state":"success"}]}'),
    ).toThrow('账号列表格式无法识别')
  })

  it('resolves hosting remotes using configured CLI endpoints without guessing the platform', async () => {
    await git('init', '--initial-branch=feature/local')
    const gitService = new SourceControlService()
    const unborn = await gitService.repositoryContext(directory)
    expect(unborn).toEqual({ branch: 'feature/local', head: null, tracking: undefined })
    const fullStatus = vi.spyOn(gitService, 'status')
    const status = {
      ...unborn,
      head: 'a'.repeat(40),
      tracking: { remote: 'origin', branch: 'dev-ai-workflow-1.0' },
    }
    const readStatus = vi.spyOn(gitService, 'repositoryContext').mockResolvedValue(status)
    const config = new ConfigStore(join(directory, 'hosting-config.json'))
    let github: HostingAccounts = { status: 'cli-unavailable', message: 'gh unavailable' }
    let gitlab: HostingAccounts = {
      status: 'detected',
      accounts: [
        { host: 'gitlab.leke.cn', account: 'fixture', active: true, status: 'connected' },
        { host: 'gitlab.leke.cn', account: 'old', active: false, status: 'error' },
      ],
    }
    const scan = vi.fn(async (provider: unknown): Promise<HostingAccounts> =>
      provider === 'github' ? github : gitlab,
    )
    const service = new CodeHostingService(config, gitService, undefined, scan)
    const path = 'frontend/leke-webapp/micro-frontends/micro-frontends-web'
    await git('remote', 'add', 'origin', `https://gitlab.leke.cn/${path}.git`)
    await git('remote', 'add', 'mirror', 'https://github.com/team/mirror.git')
    const [first, second] = await Promise.all([
      service.context(directory),
      service.context(directory),
    ])
    expect(first.source).toEqual({ provider: 'gitlab', host: 'gitlab.leke.cn', path })
    expect(first.target).toEqual(first.source)
    expect(first.sourceBranch).toBe('dev-ai-workflow-1.0')
    expect(first.reason).toBeUndefined()
    expect(second.key).toBe(first.key)
    expect(scan).toHaveBeenCalledTimes(2)
    expect(first.remotes).toEqual([
      {
        name: 'mirror',
        repository: { provider: 'github', host: 'github.com', path: 'team/mirror' },
      },
      { name: 'origin', repository: first.source },
    ])
    readStatus.mockResolvedValue({ ...status, tracking: undefined })
    expect((await service.context(directory)).source).toBeNull()
    readStatus.mockResolvedValue(status)
    await git('remote', 'remove', 'mirror')
    await git('remote', 'set-url', 'origin', `git@gitlab.leke.cn:${path}.git`)
    expect((await service.context(directory)).source).toEqual(first.source)
    expect(scan).toHaveBeenCalledTimes(2)

    await git('remote', 'set-url', 'origin', `https://gitlab.leke.cn.evil.test/${path}.git`)
    expect((await service.context(directory)).source).toBeNull()
    await git('remote', 'set-url', 'origin', `https://gitlab.leke.cn:8443/${path}.git`)
    expect((await service.context(directory)).source).toBeNull()
    gitlab = {
      status: 'detected',
      accounts: [{ host: 'gitlab.leke.cn:8443', account: '', active: true, status: 'error' }],
    }
    await service.accounts('gitlab')
    // Expired credentials still identify the platform; scope access checks authorization separately.
    expect((await service.context(directory)).source).toEqual({
      provider: 'gitlab',
      host: 'gitlab.leke.cn:8443',
      path,
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001)
    try {
      const count = scan.mock.calls.length
      expect((await service.context(directory)).source?.provider).toBe('gitlab')
      expect(scan).toHaveBeenCalledTimes(count)
    } finally {
      now.mockRestore()
    }

    github = {
      status: 'detected',
      accounts: [
        { host: 'github.example.com', account: 'fixture', active: true, status: 'connected' },
      ],
    }
    await service.accounts('github')
    await git('remote', 'set-url', 'origin', 'git@github.example.com:team/repo.git')
    expect((await service.context(directory)).source).toEqual({
      provider: 'github',
      host: 'github.example.com',
      path: 'team/repo',
    })
    gitlab = {
      status: 'detected',
      accounts: [
        { host: 'github.example.com', account: 'fixture', active: true, status: 'connected' },
      ],
    }
    await service.accounts('gitlab')
    await git('remote', 'add', 'mirror', 'https://github.com/team/mirror.git')
    const conflict = await service.context(directory)
    expect(conflict.source).toBeNull()
    expect(conflict.reason).toContain('同时出现在 GitHub 和 GitLab')
    await git('remote', 'remove', 'mirror')
    gitlab = { status: 'disconnected', message: 'no accounts' }
    await service.accounts('gitlab')
    expect((await service.context(directory)).source?.provider).toBe('github')
    github = { status: 'disconnected', message: 'no accounts' }
    await service.accounts('github')
    expect((await service.context(directory)).source).toBeNull()

    const failingScan = vi.fn(async (): Promise<HostingAccounts> => {
      throw new HostingError('response', 'safe scan failure')
    })
    const failedService = new CodeHostingService(config, gitService, undefined, failingScan)
    expect((await failedService.context(directory)).reason).toContain('自定义托管端点读取失败')
    await git('remote', 'set-url', 'origin', 'https://github.com/team/repo.git')
    expect((await failedService.context(directory)).source?.provider).toBe('github')
    await git('remote', 'set-url', 'origin', 'file:///tmp/repo')
    expect((await failedService.context(directory)).source).toBeNull()
    expect(failingScan).toHaveBeenCalledTimes(2)
    expect(fullStatus).not.toHaveBeenCalled()
  })

  it('validates hosting context and persists protection after an uncertain PR creation', async () => {
    expect(parseHostingRemote('git@gitlab.com:group/sub/project.git')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      path: 'group/sub/project',
    })
    expect(
      parseHostingRemote('git@work-alias:team/project.git', 'github', 'github.example.com'),
    ).toEqual({ provider: 'github', host: 'github.example.com', path: 'team/project' })
    for (const remote of [
      'file:///tmp/repo',
      'https://github.com/team/%2e%2e',
      'https://github.com/team/repo?token=secret',
      'git@unknown:team/repo.git',
    ])
      expect(parseHostingRemote(remote)).toBeNull()
    await git('init', '--initial-branch=feature/review')
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
      'fixture',
    )
    const file = join(directory, 'hosting-config.json')
    const config = new ConfigStore(file)
    await config.load()
    await config.remember(directory)
    const head = (await git('rev-parse', 'HEAD')).stdout.trim()
    const review = (
      number = 1,
      targetBranch = 'main',
      state: HostedReview['state'] = 'open',
    ): HostedReview => ({
      number,
      title: 'Review fixture',
      draft: false,
      state,
      sourceBranch: 'feature/review',
      targetBranch,
      head,
      url: `https://github.com/team/repo/pull/${number}`,
      checks: 'unknown',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T01:00:00Z',
      mergedAt: state === 'merged' ? '2026-10-28T01:00:00Z' : null,
      closedAt: state !== 'open' ? '2026-10-28T01:00:00Z' : null,
    })
    const remoteBranches = ['main', 'feature/review', 'remote/feature'].map((name) => ({
      name,
      date: '2026-10-28T00:00:00Z',
    }))
    const adapter = {
      account: vi.fn(async () => 'fixture-user'),
      repository: vi.fn(async () => ({ id: 1, path: 'team/repo', defaultBranch: 'main' })),
      branches: vi.fn(async () => remoteBranches),
      listOpen: vi.fn(async (): Promise<HostedReview[]> => []),
      history: vi.fn(async () => ({
        items: [] as HostedReview[],
        nextPage: null as number | null,
        fetchedAt: Date.now(),
      })),
      get: vi.fn(async (_scope: ReviewScope, number: number) => review(number, 'main', 'merged')),
      compare: vi.fn(async (): Promise<HostingComparison> => ({ status: 'changes' })),
      branchHead: vi.fn(async (_repository: HostingRepository, _branch: string) => 'not-pushed'),
      checks: vi.fn(async () => 'success' as const),
      create: vi.fn(async (): Promise<HostedReview> => {
        throw new Error('timeout')
      }),
    } satisfies HostingAdapter
    const service = new CodeHostingService(config, sourceControl, {
      github: adapter,
      gitlab: adapter,
    })
    await expect(service.connection('github', 'github.com')).resolves.toEqual({
      status: 'connected',
      account: 'fixture-user',
    })
    for (const [kind, status] of [
      ['auth', 'disconnected'],
      ['cli', 'cli-unavailable'],
    ] as const) {
      adapter.account.mockRejectedValueOnce(new HostingError(kind, `${kind} fixture`))
      await expect(service.connection('gitlab', 'gitlab.example.com')).resolves.toEqual({
        status,
        message: `${kind} fixture`,
      })
    }
    for (const kind of ['network', 'forbidden', 'rate-limit', 'response'] as const) {
      adapter.account.mockRejectedValueOnce(new HostingError(kind, `${kind} fixture`))
      await expect(service.connection('github', 'github.com')).rejects.toThrow(`${kind} fixture`)
    }
    const accountCalls = adapter.account.mock.calls.length
    await expect(service.connection('github', 'https://github.com/path')).rejects.toThrow()
    expect(adapter.account).toHaveBeenCalledTimes(accountCalls)
    expect((await service.context(directory)).reason).toContain('无法自动识别')
    await git('remote', 'add', 'origin', 'git@github.com:team/repo.git')
    await git('config', 'branch.feature/review.remote', 'origin')
    await git('config', 'branch.feature/review.merge', 'refs/heads/remote/feature')
    expect(await sourceControl.repositoryContext(directory)).toEqual({
      branch: 'feature/review',
      head,
      tracking: { remote: 'origin', branch: 'remote/feature' },
    })
    await git('config', '--unset', 'branch.feature/review.remote')
    await git('config', '--unset', 'branch.feature/review.merge')
    await git('checkout', '--detach')
    expect(await sourceControl.repositoryContext(directory)).toEqual({
      branch: null,
      head,
      tracking: undefined,
    })
    await git('checkout', 'feature/review')
    const context = await service.context(directory)
    const comparisonContext = {
      ...context,
      remotes: [
        { name: 'origin', repository: { ...context.target!, path: 'team/other' } },
        { name: 'upstream', repository: context.target },
      ],
    }
    const references = {
      remotes: ['origin', 'upstream'],
      branches: ['refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/upstream/main'].map(
        (ref) => ({ ref, label: ref, date: '', subject: '' }),
      ),
    }
    expect(resolveTargetBranchRef(comparisonContext, references, 'main')).toBe(
      'refs/remotes/upstream/main',
    )
    expect(
      resolveTargetBranchRef(
        comparisonContext,
        { ...references, branches: references.branches.slice(0, 2) },
        'main',
      ),
    ).toBeUndefined()
    expect(resolveTargetBranchRef(comparisonContext, undefined, 'main')).toBeUndefined()
    expect(resolveTargetBranchRef({ ...context, target: null }, references, 'main')).toBeUndefined()
    const input = {
      key: context.key,
      account: 'fixture-user',
      sourceBranch: 'feature/review',
      title: 'Review fixture',
      description: '',
      targetBranch: 'main',
      draft: false,
    }
    await expect(service.create(directory, { ...input, key: '0'.repeat(64) })).rejects.toThrow(
      '已改变',
    )
    await expect(service.create(directory, { ...input, account: 'other-user' })).rejects.toThrow(
      '账号已改变',
    )
    const creation = await service.creationContext(directory)
    expect(creation).toMatchObject({
      context,
      account: input.account,
      sourceBranches: remoteBranches,
      targetBranches: remoteBranches,
      branchesFetchedAt: expect.any(Number),
    })
    expect(adapter.branches).toHaveBeenCalledOnce()
    expect((await service.creationContext(directory)).branchesFetchedAt).toBe(
      creation.branchesFetchedAt,
    )
    expect(adapter.branches).toHaveBeenCalledOnce()
    const prepareInput = {
      key: input.key,
      account: input.account,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
    }
    adapter.compare.mockResolvedValue({
      status: 'changes',
      defaultTitle: 'Remote title',
      defaultDescription: 'Remote description',
    })
    const initialAccountCalls = adapter.account.mock.calls.length
    const initialRepositoryCalls = adapter.repository.mock.calls.length
    await expect(service.prepare(directory, prepareInput)).resolves.toMatchObject({
      status: 'ready',
      sourceHead: 'not-pushed',
      defaultTitle: 'Remote title',
      defaultDescription: 'Remote description',
      message: '',
    })
    expect(adapter.account).toHaveBeenCalledTimes(initialAccountCalls + 1)
    expect(adapter.repository).toHaveBeenCalledTimes(initialRepositoryCalls)
    adapter.account.mockResolvedValueOnce('other-user')
    await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
    await service.creationContext(directory)
    adapter.account.mockResolvedValueOnce('other-user')
    await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
    await service.creationContext(directory)
    const expired = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5001)
    try {
      adapter.account.mockResolvedValueOnce('other-user')
      await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
    } finally {
      expired.mockRestore()
    }
    await service.creationContext(directory)
    adapter.account.mockResolvedValueOnce('other-user')
    await expect(service.create(directory, input)).rejects.toThrow('账号已改变')
    await expect(
      service.create(directory, { ...input, sourceBranch: '-invalid' }),
    ).rejects.toThrow()
    await expect(service.create(directory, { ...input, sourceBranch: undefined })).rejects.toThrow()
    expect(adapter.compare).toHaveBeenCalledWith(expect.anything(), 'not-pushed', 'not-pushed')
    expect(adapter.create).not.toHaveBeenCalled()
    adapter.branchHead.mockResolvedValue(head)
    expect(
      (await service.prepare(directory, { ...prepareInput, targetBranch: 'feature/review' }))
        .status,
    ).toBe('blocked')
    for (const comparison of ['empty', 'unknown'] as const) {
      adapter.compare.mockResolvedValue({ status: comparison })
      expect((await service.prepare(directory, prepareInput)).status).toBe(comparison)
      await expect(service.create(directory, input)).rejects.toThrow(
        comparison === 'empty' ? '没有可评审差异' : '无法确认远端差异',
      )
    }
    expect(adapter.create).not.toHaveBeenCalled()
    adapter.compare.mockResolvedValue({
      status: 'changes',
      defaultTitle: 'Suggested title',
      defaultDescription: '',
    })
    await expect(service.prepare(directory, prepareInput)).resolves.toMatchObject({
      status: 'ready',
      defaultTitle: 'Suggested title',
      defaultDescription: '',
      message: '',
    })
    adapter.branchHead.mockResolvedValueOnce('not-pushed')
    await expect(service.create(directory, input)).rejects.toThrow('重复创建保护')
    expect(adapter.create).toHaveBeenCalledOnce()
    const reopened = new ConfigStore(file)
    expect((await reopened.load()).warning).toBeUndefined()
    expect(reopened.snapshot().codeHostingPendingCreates).toHaveLength(1)
    const afterRestart = new CodeHostingService(reopened, sourceControl, {
      github: adapter,
      gitlab: adapter,
    })
    await expect(afterRestart.create(directory, input)).rejects.toThrow('阻止重复提交')
    await expect(
      afterRestart.prepare(directory, { ...prepareInput, sourceBranch: 'remote/feature' }),
    ).resolves.toMatchObject({ status: 'ready' })
    expect(adapter.create).toHaveBeenCalledOnce()
    const pending = reopened.snapshot().codeHostingPendingCreates![0]!
    if (typeof pending === 'string') throw new Error('Expected structured creation protection')
    expect(pending).toMatchObject({
      sourceBranch: input.sourceBranch,
      targetBranch: 'main',
      sourceHead: 'not-pushed',
      account: input.account,
    })
    adapter.listOpen.mockResolvedValue([review(8, 'release')])
    expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
    await expect(
      afterRestart.create(directory, { ...input, targetBranch: 'develop' }),
    ).rejects.toThrow('阻止重复提交')
    adapter.listOpen.mockResolvedValue([review(), review(8, 'release')])
    adapter.account.mockResolvedValueOnce('other-user')
    expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
    const recovered = await afterRestart.inspect(directory)
    expect(recovered.activeReviews.map((item) => item.number)).toEqual([1, 8])
    expect(recovered.creationBlocked).toBe(false)
    expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
    await afterRestart.create(directory, input)
    expect(adapter.create).toHaveBeenCalledOnce()

    adapter.listOpen.mockResolvedValue([review(), review(9)])
    expect((await afterRestart.prepare(directory, prepareInput)).existingReviews).toHaveLength(2)
    await expect(afterRestart.create(directory, input)).rejects.toThrow('多个开放评审')
    expect(adapter.create).toHaveBeenCalledOnce()

    // Merging does not permanently bind this source branch to the first PR.
    adapter.listOpen.mockResolvedValue([review(8, 'release')])
    adapter.history.mockResolvedValue({
      items: [review(1, 'main', 'merged')],
      nextPage: null,
      fetchedAt: Date.now(),
    })
    expect((await afterRestart.history(directory, input.key, 1)).items[0]?.state).toBe('merged')
    await expect(afterRestart.history(directory, 'stale', 1)).rejects.toThrow('工作区已改变')
    await expect(afterRestart.history(directory, input.key, 0)).rejects.toThrow()
    expect(await afterRestart.reviewUrl(directory, 1)).toBe(review().url)
    expect(adapter.get).toHaveBeenCalledWith(expect.anything(), 1)
    const commit = async (message: string) => {
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
        message,
      )
      return (await git('rev-parse', 'HEAD')).stdout.trim()
    }
    const secondHead = await commit('second review round')
    adapter.branchHead.mockImplementation(async (_repository, branch) =>
      branch === 'feature/review' ? secondHead : head,
    )
    const secondInput = { ...input, key: (await afterRestart.context(directory)).key }
    adapter.create.mockResolvedValueOnce({ ...review(18), head: secondHead })
    const secondRound = await afterRestart.create(directory, secondInput)
    expect(secondRound).toMatchObject({
      number: 18,
      sourceBranch: input.sourceBranch,
      head: secondHead,
    })
    expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])

    adapter.history.mockResolvedValue({
      items: [review(18, 'main', 'merged'), review(1, 'main', 'merged')],
      nextPage: null,
      fetchedAt: Date.now(),
    })
    const thirdHead = await commit('third review round')
    adapter.branchHead.mockImplementation(async (_repository, branch) =>
      branch === 'feature/review' ? thirdHead : head,
    )
    const thirdInput = { ...input, key: (await afterRestart.context(directory)).key }
    let finish!: (review: HostedReview) => void
    let started!: () => void
    const posting = new Promise<void>((resolve) => {
      started = resolve
    })
    adapter.create.mockImplementationOnce(() => {
      started()
      return new Promise<HostedReview>((resolve) => {
        finish = resolve
      })
    })
    const thirdRound = afterRestart.create(directory, thirdInput)
    await posting
    await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('正在创建')
    await expect(afterRestart.clearCreation(directory, thirdInput.key)).rejects.toThrow(
      '仍在进行中',
    )
    adapter.listOpen.mockResolvedValue([review(8, 'release'), { ...review(24), head: thirdHead }])
    expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
    finish({ ...review(24), head: thirdHead })
    expect(await thirdRound).toMatchObject({ number: 24, head: thirdHead })
    expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
    expect(adapter.create).toHaveBeenCalledTimes(3)
    expect(
      (await afterRestart.history(directory, thirdInput.key, 1)).items.map((item) => item.number),
    ).toEqual([18, 1])

    // A timed-out POST that was already merged must not be unlocked by old history.
    adapter.listOpen.mockResolvedValue([])
    adapter.history.mockResolvedValue({
      items: [review(25, 'main', 'merged')],
      nextPage: null,
      fetchedAt: Date.now(),
    })
    await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('重复创建保护')
    await afterRestart.history(directory, thirdInput.key, 1)
    expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
    await afterRestart.clearCreation(directory, thirdInput.key)
    adapter.create.mockRejectedValueOnce(new HostingError('rejected', '平台拒绝创建'))
    await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('平台拒绝创建')
    expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])

    const legacyFile = join(directory, 'legacy-hosting-config.json')
    await writeFile(
      legacyFile,
      JSON.stringify({ ...reopened.snapshot(), codeHostingPendingCreates: [pending.key] }),
    )
    const legacyConfig = new ConfigStore(legacyFile)
    adapter.listOpen.mockResolvedValue([review(24)])
    expect((await legacyConfig.load()).warning).toBeUndefined()
    const legacyService = new CodeHostingService(legacyConfig, sourceControl, {
      github: adapter,
      gitlab: adapter,
    })
    expect((await legacyService.inspect(directory)).creationBlocked).toBe(true)
    await legacyService.clearCreation(directory, thirdInput.key)
    expect(legacyConfig.snapshot().codeHostingPendingCreates).toEqual([])

    // A remote-only source is independent of the checked-out branch and its HEAD.
    adapter.listOpen.mockResolvedValue([])
    adapter.branchHead.mockImplementation(async (_repository, branch) =>
      branch === 'remote/feature' ? 'remote-head' : head,
    )
    const remoteInput = { ...input, sourceBranch: 'remote/feature' }
    await afterRestart.creationContext(directory)
    await expect(
      afterRestart.prepare(directory, { ...prepareInput, sourceBranch: remoteInput.sourceBranch }),
    ).resolves.toMatchObject({
      status: 'ready',
      sourceHead: 'remote-head',
      defaultTitle: 'Suggested title',
      message: '',
    })
    expect(adapter.compare).toHaveBeenLastCalledWith(
      expect.objectContaining({ branch: 'remote/feature' }),
      'remote-head',
      head,
    )
    adapter.create.mockResolvedValueOnce({
      ...review(40),
      sourceBranch: remoteInput.sourceBranch,
      head: 'remote-head',
    })
    expect(await afterRestart.create(directory, remoteInput)).toMatchObject({
      number: 40,
      sourceBranch: remoteInput.sourceBranch,
      head: 'remote-head',
    })
    expect(adapter.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ branch: remoteInput.sourceBranch }),
      remoteInput,
    )
    await expect(afterRestart.create(directory, remoteInput)).rejects.toThrow('重复创建保护')
    await expect(
      afterRestart.prepare(directory, { ...prepareInput, sourceBranch: remoteInput.sourceBranch }),
    ).resolves.toMatchObject({ status: 'blocked', creationBlocked: true })
    await afterRestart.clearCreation(directory, remoteInput.key, remoteInput.sourceBranch)
    expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
    await afterRestart.reviewUrl(directory, 40, remoteInput.sourceBranch)
    expect(adapter.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ branch: remoteInput.sourceBranch }),
      40,
    )
  }, 30000)

  it.each(['github', 'gitlab'] as const)(
    'reads %s hosting review history with pagination and identity checks',
    async (provider) => {
      const request = vi.fn<HostingRequest>()
      const adapter =
        provider === 'github' ? new GitHubAdapter(request) : new GitLabAdapter(request)
      const repository = { provider, host: `${provider}.com`, path: 'team/repo' }
      const scope: ReviewScope = {
        source: repository,
        target: repository,
        branch: 'feature/review',
        sourceInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
        targetInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
      }
      const time = '2026-10-28T00:00:00Z'
      const payload = (
        number: number,
        state: 'open' | 'merged' | 'closed' | 'locked',
        branch = scope.branch,
        target = 'main',
        sourceId = 1,
      ) => ({
        title: `Review ${number}`,
        draft: false,
        created_at: time,
        updated_at: time,
        merged_at: state === 'merged' ? time : null,
        closed_at: state === 'merged' || state === 'closed' ? time : null,
        ...(provider === 'github'
          ? {
              number,
              state: state === 'open' ? 'open' : 'closed',
              head: { ref: branch, sha: 'a'.repeat(40), repo: { id: sourceId } },
              base: { ref: target, repo: { id: 1 } },
            }
          : {
              iid: number,
              state: state === 'open' ? 'opened' : state,
              source_project_id: sourceId,
              target_project_id: 1,
              source_branch: branch,
              target_branch: target,
              sha: 'a'.repeat(40),
            }),
      })
      request.mockResolvedValueOnce([
        payload(1, 'open'),
        payload(2, 'open', scope.branch, 'release'),
        payload(3, 'open', 'other'),
        payload(4, 'open', scope.branch, 'main', 2),
      ])
      expect((await adapter.listOpen(scope)).map((review) => review.targetBranch)).toEqual([
        'main',
        'release',
      ])
      request.mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => payload(index + 30, 'closed', 'other')),
      )
      expect(await adapter.history(scope, 1)).toMatchObject({ items: [], nextPage: 2 })
      request.mockResolvedValueOnce([payload(12, 'merged'), payload(9, 'closed')])
      const history = await adapter.history(scope, 2)
      expect(history.nextPage).toBeNull()
      expect(history.items.map((review) => [review.number, review.state])).toEqual([
        [12, 'merged'],
        [9, 'closed'],
      ])
      expect(history.items[0]).toMatchObject({ createdAt: time, mergedAt: time })
      expect(request.mock.calls[2]?.[1]).toContain('page=2')
      expect(request.mock.calls[2]?.[1]).toContain('feature%2Freview')
      request.mockResolvedValueOnce(payload(12, 'merged'))
      expect((await adapter.get(scope, 12)).url).toBe(
        provider === 'github'
          ? 'https://github.com/team/repo/pull/12'
          : 'https://gitlab.com/team/repo/-/merge_requests/12',
      )
      request.mockResolvedValueOnce(payload(13, 'merged', 'other'))
      await expect(adapter.get(scope, 13)).rejects.toThrow('不匹配')
      request.mockResolvedValueOnce(
        provider === 'github' ? { files: [] } : { diffs: [], commits: [] },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'empty',
      })
      request.mockResolvedValueOnce(
        provider === 'github'
          ? { files: [{ filename: 'file' }] }
          : { diffs: [{ diff: '+line' }], commits: [] },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'changes',
      })
      request.mockResolvedValueOnce(
        provider === 'github'
          ? { files: Array.from({ length: 300 }, () => ({ filename: 'file' })) }
          : { diffs: [], commits: [], compare_timeout: true },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'unknown',
      })
      if (provider === 'gitlab') {
        const account = {
          username: 'me',
          email: 'me@example.com',
          public_email: 'public@example.com',
          commit_email: 'private@noreply.gitlab.com',
        }
        const emails = [
          { email: 'old@example.com', confirmed_at: time },
          { email: 'pending@example.com', confirmed_at: null },
        ]
        const commit = (
          title: string,
          body = '',
          author = 'me@example.com',
          date = time,
          parents = ['parent'],
        ) => ({
          title,
          message: `${title}\n${body}`,
          author_email: author,
          authored_date: date,
          parent_ids: parents,
        })
        for (const [commits, defaultTitle, defaultDescription] of [
          [
            [commit('Only commit', '\nSingle body\n', 'other@example.com')],
            'Only commit',
            'Single body',
          ],
          [
            [commit('First', '', 'other@example.com'), commit('Second', '', 'pending@example.com')],
            'Feature/review',
            '',
          ],
          [
            [
              commit('Newest', '\nMore'),
              commit('Other author', '\nNot mine', 'other@example.com', '2026-10-01T00:00:00Z'),
              commit('Oldest own commit', '\nDetails', ' OLD@EXAMPLE.COM ', '2026-10-20T00:00:00Z'),
            ],
            'Oldest own commit',
            'Details',
          ],
          [
            [
              commit('With body', '\nDetails'),
              commit('First', '', 'me@example.com', '2026-10-20T00:00:00Z'),
            ],
            'First',
            '',
          ],
          [
            [
              commit('Pending', '\nUnverified', 'pending@example.com', '2026-10-01T00:00:00Z'),
              commit(
                'Private email',
                '\nDetails',
                'private@noreply.gitlab.com',
                '2026-10-20T00:00:00Z',
              ),
              commit('Public email', '\nMore', 'public@example.com'),
            ],
            'Private email',
            'Details',
          ],
          [
            [
              commit('Feature', '\nDetails'),
              commit('Merge', '\nMerged details', 'me@example.com', '2026-10-20T00:00:00Z', [
                'one',
                'two',
              ]),
            ],
            'Merge',
            'Merged details',
          ],
        ] as const) {
          request.mockResolvedValueOnce({ diffs: [{ diff: '+line' }], commits })
          if (commits.length > 1) {
            request.mockResolvedValueOnce(account)
            request.mockResolvedValueOnce(emails)
          }
          expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toEqual({
            status: 'changes',
            defaultTitle,
            defaultDescription,
          })
        }
        for (const confidential of [false, true]) {
          request.mockResolvedValueOnce({
            diffs: [{ diff: '+line' }],
            commits: [
              commit('First', '', 'other@example.com'),
              commit('Second', '', 'other@example.com'),
            ],
          })
          request.mockResolvedValueOnce(account)
          request.mockResolvedValueOnce(emails)
          request.mockResolvedValueOnce({ title: 'Fix issue', confidential })
          expect(
            await adapter.compare(
              { ...scope, branch: '123-fix_issue' },
              'source-sha',
              'target-sha',
            ),
          ).toMatchObject({
            defaultTitle: confidential ? '123 fix issue' : 'Resolve "Fix issue"',
          })
        }
        request.mockResolvedValueOnce(payload(14, 'locked'))
        expect((await adapter.get(scope, 14)).state).toBe('open')
        request.mockResolvedValueOnce({ ...payload(15, 'open'), state: 'unexpected' })
        await expect(adapter.get(scope, 15)).rejects.toThrow()
      }
      const branchPage = (names: string[], hasNextPage: boolean) =>
        provider === 'github'
          ? {
              data: {
                repository: {
                  refs: {
                    nodes: names.map((name) => ({ name, target: { committedDate: time } })),
                    pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next-page' : null },
                  },
                },
              },
            }
          : names.map((name) => ({ name, commit: { committed_date: time } }))
      request.mockResolvedValueOnce(
        branchPage(
          Array.from({ length: 100 }, (_, index) => `branch-${index}`),
          true,
        ),
      )
      request.mockResolvedValueOnce(branchPage(['remote/only'], false))
      const branches = await adapter.branches(repository)
      expect(branches).toHaveLength(101)
      expect(branches.at(-1)).toEqual({ name: 'remote/only', date: time })
      if (provider === 'github') {
        expect(request.mock.calls.at(-1)).toEqual([
          repository,
          'graphql',
          expect.objectContaining({
            variables: { owner: 'team', name: 'repo', cursor: 'next-page' },
          }),
        ])
      } else {
        expect(request.mock.calls.at(-1)?.[1]).toContain('page=2')
      }
      request.mockRejectedValueOnce(new Error('remote branches unavailable'))
      await expect(adapter.branches(repository)).rejects.toThrow('remote branches unavailable')
      if (provider === 'github') {
        request.mockResolvedValueOnce({
          files: [{ filename: 'file' }],
          commits: [{ commit: { message: 'Remote commit title\n\nBody' } }],
        })
        expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
          defaultTitle: 'Remote commit title',
          defaultDescription: 'Body',
        })
      }
    },
  )

  it('validates paths before running Git', async () => {
    await expect(projectBranch('relative/path')).rejects.toThrow()
    await expect(projectBranch('/tmp/project\0git')).rejects.toThrow()
    await expect(projectBranch(join(directory, 'missing'))).rejects.toThrow()
    const oid = 'a'.repeat(40)
    expect(
      parseGitStatus(`u UU N... 100644 100644 100644 100644 ${oid} ${oid} ${oid} conflict file\0`)
        .entries,
    ).toEqual([expect.objectContaining({ path: 'conflict file', area: 'conflict', status: 'UU' })])
    expect(() => parseGitStatus('? missing-terminator')).toThrow('不完整')
    expect(() => parseGitStatus('? ../escape\0')).toThrow('路径无效')
    expect(() =>
      parseGitStatus(`2 R. N... 100644 100644 100644 ${oid} ${oid} R100 renamed\0`),
    ).toThrow('路径无效')
  })
})
