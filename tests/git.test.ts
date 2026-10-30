import { execFile } from 'node:child_process'
import { gitAvailable } from './helpers/git'
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
import { projectBranch } from '../src/main/git/branches/project-branch'
import { SourceControlService } from '../src/main/git/source-control/service'
import { SourceControlWatches } from '../src/main/git/source-control/watch'
import { BranchService } from '../src/main/git/branches/service'
import { readBranchData } from '../src/main/git/branches/read'
import { branchReferences } from '../src/shared/git-branches'
import * as gitRunner from '../src/main/git/git-runner'
import { ConfigStore } from '../src/main/settings/config-store'
import { CodeHostingService } from '../src/main/code-hosting/service'
import { HostingError } from '../src/main/code-hosting/cli-runner'
import type { HostingAccounts } from '../src/shared/code-hosting'

const sourceControl = new SourceControlService()

const execFileAsync = promisify(execFile)
let directory: string
const git = (...args: string[]) =>
  execFileAsync('git', ['-C', directory, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5000,
  })

describe.skipIf(!gitAvailable)('Git integration (requires Git)', () => {
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'cota 分支-')))
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })

  describe('project branch', () => {
    describe('shared branch resources', () => {
      let linked: string
      let read = vi.fn(readBranchData)
      let notify = vi.fn()
      let service: BranchService
      let target: { projectPath: string; workspaceId: string }
      let releaseRead: (() => void) | undefined
      let pendingRead: Promise<unknown> | undefined
      let main: Awaited<ReturnType<BranchService['query']>>
      let worktree: Awaited<ReturnType<BranchService['query']>>
      beforeEach(async () => {
        releaseRead = undefined
        pendingRead = undefined
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
        linked = join(directory, 'linked')
        await git('worktree', 'add', '-b', 'linked', linked)
        await git('config', 'extensions.worktreeConfig', 'true')
        await git('-C', linked, 'config', '--worktree', 'remote.linked-only.url', directory)
        read = vi.fn(readBranchData)
        notify = vi.fn()
        service = new BranchService(notify, undefined, read, {
          start: vi.fn().mockResolvedValue(true),
          stop: vi.fn(),
        })
        target = { projectPath: directory, workspaceId: 'main' }
        service.subscribe('main', target)
        service.subscribe('linked', { ...target, workspaceId: 'linked' })
        ;[main, worktree] = await Promise.all([
          service.query(directory, 'main'),
          service.query(linked, 'linked'),
        ])
      })
      afterEach(async () => {
        releaseRead?.()
        service?.close()
        await pendingRead?.catch(() => {})
      })
      it('shares snapshots but isolates worktree remotes and config invalidation', async () => {
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
        expect(main.snapshot.branches.every((branch) => /^[a-f0-9]{40}$/.test(branch.oid))).toBe(
          true,
        )
        service.invalidateRepository('/unrelated-repository')
        service.invalidateRepository(join(directory, '.git'), ['config'])
        expect((await service.query(directory, 'main')).snapshot).toBe(main.snapshot)
        expect(read).toHaveBeenCalledTimes(1)
      })
      it('discards invalidated in-flight reads and publishes a fresh generation', async () => {
        let started!: () => void
        let finish!: () => void
        const reading = new Promise<void>((resolve) => {
          started = resolve
        })
        const gate = new Promise<void>((resolve) => {
          finish = resolve
          releaseRead = resolve
        })
        read.mockImplementationOnce(async (...args) => {
          const data = await readBranchData(...args)
          started()
          await gate
          return data
        })
        const pending = service.query(directory, 'main', true)
        pendingRead = pending
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
      })
      it('rejects removed subscriptions while preserving surviving worktrees', async () => {
        let entered!: () => void
        let resume!: () => void
        const enteredRead = new Promise<void>((resolve) => {
          entered = resolve
        })
        const paused = new Promise<void>((resolve) => {
          resume = resolve
          releaseRead = resolve
        })
        read.mockImplementationOnce(async (...args) => {
          const data = await readBranchData(...args)
          entered()
          await paused
          return data
        })
        const removed = service.query(directory, 'main', true)
        pendingRead = removed
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
    })

    describe('unborn staging and committed file safety', () => {
      const name = 'nested/中文 [文件]*\n.txt'
      const file = { path: name, area: 'untracked' as const }

      let nested: string
      let target: { projectPath: string; workspaceId: string }
      let noConfirm = vi.fn().mockResolvedValue(false)
      beforeEach(async () => {
        await git('init', '--initial-branch=main')
        await git('config', 'user.name', 'Cota')
        await git('config', 'user.email', 'cota@example.test')
        await git('config', 'commit.gpgsign', 'false')
        await git('config', 'core.hooksPath', '/dev/null')

        nested = join(directory, 'nested')
        await mkdir(nested)
        target = { projectPath: directory, workspaceId: 'fixture' }
        noConfirm = vi.fn().mockResolvedValue(false)
      })
      it('unborn staging: reads branches and separates staged and working content', async () => {
        vi.stubEnv('GIT_DIR', join(directory, 'not-a-repository'))
        vi.stubEnv('GIT_WORK_TREE', join(directory, 'not-a-worktree'))
        expect(await projectBranch(nested)).toBe('main')
        vi.unstubAllEnvs()
        await git('symbolic-ref', 'HEAD', 'refs/heads/feature/工作区')
        expect(await projectBranch(directory)).toBe('feature/工作区')
        expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('feature/工作区')

        await writeFile(join(directory, name), 'first\n')
        const initial = await sourceControl.status(nested, true)
        expect(initial.rootPath).toBe(directory)
        expect(initial.head).toBeNull()
        expect(initial.branch).toBe('feature/工作区')
        expect(await sourceControl.history(directory)).toEqual({
          head: null,
          commits: [],
          more: false,
        })
        expect(initial.entries).toEqual([
          expect.objectContaining({ ...file, stats: { additions: 1, deletions: 0 } }),
        ])
        expect(await sourceControl.diff(directory, file)).toEqual({
          kind: 'text',
          original: '',
          modified: 'first\n',
        })
        await sourceControl.mutate(
          directory,
          { ...target, action: 'stage', files: [file] },
          noConfirm,
        )
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
        await sourceControl.mutate(
          directory,
          { ...target, action: 'stage', files: [file] },
          noConfirm,
        )
      }, 15000)
      describe('reviewed index', () => {
        beforeEach(async () => {
          await git('symbolic-ref', 'HEAD', 'refs/heads/feature/工作区')
          await writeFile(join(directory, name), 'second\n')
          await git('add', '--', name)
        })
        it('unborn staging: rechecks discard and commit snapshots before modifying data', async () => {
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
            {
              ...target,
              action: 'commit',
              message: 'initial',
              indexVersion: reviewed.indexVersion,
            },
            noConfirm,
          )
          expect((await sourceControl.status(directory)).entries).toEqual([])
          const history = await sourceControl.history(directory)
          expect(history.commits).toHaveLength(1)
          expect(history.commits[0]).toMatchObject({
            subject: 'initial',
            author: 'Cota',
            parents: [],
          })
          const root = await sourceControl.compare(directory, {
            kind: 'commit',
            commit: history.head!,
          })
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
        }, 15000)
      })
      describe('committed files', () => {
        let history: Awaited<ReturnType<SourceControlService['history']>>
        beforeEach(async () => {
          await git('symbolic-ref', 'HEAD', 'refs/heads/feature/工作区')
          await writeFile(join(directory, name), 'second\n')
          await git('add', '--', name)
          await git('commit', '-m', 'initial')
          history = await sourceControl.history(directory)
        })
        it('unborn staging: protects binary files, symlink targets and metadata paths', async () => {
          const discard = {
            ...target,
            action: 'discard' as const,
            files: [{ ...file, area: 'unstaged' as const }],
          }
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
        }, 15000)
        const samples = [
          ['nested/new\t中文\n.txt', Buffer.from('one\r\ntwo')],
          ['nested/empty.txt', Buffer.alloc(0)],
          ['nested/binary.dat', Buffer.from([0, 1, 2])],
          ['nested/large.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65)],
        ] as const

        it('unborn staging: reports deletion, binary, size and rename statistics', async () => {
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
          expect(
            counts.entries.find((entry) => entry.path === samples[3][0])?.stats,
          ).toBeUndefined()
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
            (await sourceControl.status(nested)).entries.every(
              (entry) => entry.stats === undefined,
            ),
          ).toBe(true)
        }, 15000)
        describe('renamed files', () => {
          const renamed = 'nested/renamed\t中文\n.txt'

          beforeEach(async () => {
            for (const [path, bytes] of samples) await writeFile(join(directory, path), bytes)
            await git('mv', '--', name, renamed)
            await git('config', 'diff.external', 'cota-must-not-run-external-diff')
          })
          it('unborn staging: bounds optional statistics and tolerates their failure', async () => {
            const readGit = gitRunner.runGitBytes
            const failedStats = vi
              .spyOn(gitRunner, 'runGitBytes')
              .mockImplementation((cwd, args, writing, timeout) => {
                if (args.includes('--numstat'))
                  return Promise.reject(new Error('Statistics unavailable'))
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
              expect(comparison.entries).toEqual([
                expect.objectContaining({ path: name, status: 'A' }),
              ])
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
              expect(
                limitedStats.mock.calls.filter(([, args]) => args.includes('--numstat')),
              ).toHaveLength(1)
            } finally {
              limitedStats.mockRestore()
              clock.mockRestore()
            }
          }, 15000)
          it('unborn staging: compares rename and binary changes by commit or branch', async () => {
            await git('branch', 'comparison-base', history.head!)
            await writeFile(join(directory, renamed), 'second\n')
            await git('add', '--', renamed, samples[0][0], samples[2][0])
            await git('commit', '-m', 'rename and add files')
            const comparisonHead = (await sourceControl.status(directory)).head!
            for (const comparison of [
              await sourceControl.compare(directory, { kind: 'commit', commit: comparisonHead }),
              await sourceControl.compare(directory, {
                kind: 'branch',
                ref: 'refs/heads/comparison-base',
              }),
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
          }, 15000)
        })
      })
    })

    describe('linked worktree files', () => {
      let worktree: string
      let target: { projectPath: string; workspaceId: string }
      beforeEach(async () => {
        await git('init', '--initial-branch=main')
        await git('config', 'user.name', 'Cota')
        await git('config', 'user.email', 'cota@example.test')
        await git('config', 'commit.gpgsign', 'false')
        await git('config', 'core.hooksPath', '/dev/null')

        await git('commit', '--allow-empty', '-m', 'initial')
        worktree = join(directory, 'worktree')
        await git('worktree', 'add', '-b', 'feature/worktree', worktree)
        target = { projectPath: directory, workspaceId: 'fixture' }
      })
      it('worktree files: isolates status, detached HEAD and staged renames', async () => {
        expect(await projectBranch(worktree)).toBe('feature/worktree')
        expect(await projectBranch(directory)).toBe('main')
        await git('checkout', '--detach')
        expect(await projectBranch(directory)).toBeNull()
        expect((await sourceControl.status(directory)).branch).toBeNull()
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
      }, 15000)
      describe('committed rename', () => {
        beforeEach(async () => {
          await writeFile(join(worktree, 'file.txt'), 'one\n')
          await writeFile(join(worktree, 'local.txt'), 'local baseline\n')
          await git('-C', worktree, 'add', '.')
          await git('-C', worktree, 'commit', '-m', 'file')
          await rename(join(worktree, 'file.txt'), join(worktree, 'renamed 空格.txt'))
          await git('-C', worktree, 'add', '-A')
          await git('-C', worktree, 'commit', '-m', 'rename')
        })
        it('worktree files: reads committed diffs and branch history independently of working edits', async () => {
          const renameHead = (await sourceControl.status(worktree)).head!
          const review = await sourceControl.compare(worktree, {
            kind: 'commit',
            commit: renameHead,
          })
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
        }, 15000)
      })
    })

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
      }
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
        sourceControl.mutate(
          directory,
          { ...createAndSwitch, head: '0'.repeat(40) },
          noConfirmation,
        ),
      ).rejects.toThrow('HEAD 已改变')
      await expect(
        sourceControl.mutate(directory, { ...createAndSwitch, branch: 'stale' }, noConfirmation),
      ).rejects.toThrow('分支已改变')
      await writeFile(join(directory, '.git/index.lock'), '')
      await expect(
        sourceControl.mutate(directory, createAndSwitch, noConfirmation),
      ).rejects.toThrow()
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
      await expect(
        git('config', '--get', `branch.${createAndSwitch.name}.remote`),
      ).rejects.toThrow()
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
      for (const ref of [
        'refs/remotes/origin/feature/可删除',
        'refs/heads/-bad',
        'refs/heads/a..b',
      ])
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
      expect((await git('rev-parse', 'refs/remotes/origin/feature/可删除')).stdout.trim()).toBe(
        head,
      )
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

    it('omits the subtitle for non-repositories', async () => {
      expect(await projectBranch(directory)).toBeNull()
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
  })
})
