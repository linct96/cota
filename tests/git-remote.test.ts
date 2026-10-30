import { execFile } from 'node:child_process'
import { mkdtemp, realpath, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceControlService } from '../src/main/git/source-control/service'
import { BranchService } from '../src/main/git/branches/service'
import { gitEnvironment } from '../src/main/git/git-runner'
import { gitAvailable } from './helpers/git'

const exec = promisify(execFile)
const sourceControl = new SourceControlService()
let directory: string
let worktree: string
let remote: string
let peer: string
let renameHead: string
const target = { projectPath: '', workspaceId: 'fixture' }
const git = (...args: string[]) =>
  exec('git', ['-C', directory, ...args], {
    env: { ...gitEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5000,
  })

// Each scenario owns its repository; no test depends on another test's mutations.
describe.skipIf(!gitAvailable)('Git remote and history integration (requires Git)', () => {
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'cota-git-remote-')))
    target.projectPath = directory
    worktree = join(directory, 'worktree')
    remote = join(directory, 'remote.git')
    peer = join(directory, 'peer')
    await git('init', '--initial-branch=main')
    await git('config', 'user.name', 'Cota')
    await git('config', 'user.email', 'cota@example.test')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', '/dev/null')
    await git('commit', '--allow-empty', '-m', 'initial')
    await git('worktree', 'add', '-b', 'feature/worktree', worktree)
    await git('checkout', '--detach')
    await writeFile(join(worktree, 'file.txt'), 'one\n')
    await writeFile(join(worktree, 'local.txt'), 'local baseline\n')
    await git('-C', worktree, 'add', '.')
    await git('-C', worktree, 'commit', '-m', 'file')
    await rename(join(worktree, 'file.txt'), join(worktree, 'renamed 空格.txt'))
    await git('-C', worktree, 'add', '-A')
    await git('-C', worktree, 'commit', '-m', 'rename')
    renameHead = (await git('-C', worktree, 'rev-parse', 'HEAD')).stdout.trim()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })
  describe('local remote', () => {
    beforeEach(async () => {
      await git('init', '--bare', '--initial-branch=main', remote)
      await git('-C', worktree, 'remote', 'add', 'review', remote)
    })
    it('publishes only to a configured remote and selects valid default references', async () => {
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
      expect(await branchOperations.mutate(worktree, publish, sourceControl, remoteWrites)).toBe(
        true,
      )
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
    }, 30000)
    describe('published branch and peer', () => {
      beforeEach(async () => {
        await git('-C', worktree, 'push', '--set-upstream', 'review', 'feature/worktree')
        await git(
          'symbolic-ref',
          'refs/remotes/review/HEAD',
          'refs/remotes/review/feature/worktree',
        )
        await git('clone', '--branch', 'feature/worktree', remote, peer)
        await git('-C', peer, 'config', 'user.name', 'Peer')
        await git('-C', peer, 'config', 'user.email', 'peer@example.test')
        await git('-C', peer, 'config', 'commit.gpgsign', 'false')
        await git('-C', peer, 'config', 'core.hooksPath', '/dev/null')
      })
      it('fetches into remote refs and pulls without losing staged, unstaged or ignored files', async () => {
        let current
        await writeFile(join(peer, 'renamed 空格.txt'), 'peer\n')
        await writeFile(join(peer, 'ignored.txt'), 'from remote\n')
        await git('-C', peer, 'add', '-A')
        await git('-C', peer, 'commit', '-m', 'remote change')
        await git('-C', peer, 'push', 'origin', 'HEAD:refs/heads/feature/worktree')
        // A custom fetch mapping must never let Fetch overwrite a local branch namespace.
        await git(
          '-C',
          worktree,
          'config',
          'remote.review.fetch',
          '+refs/heads/*:refs/heads/unsafe/*',
        )
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
          await git(
            '-C',
            worktree,
            'rev-parse',
            '--path-format=absolute',
            '--git-path',
            'info/exclude',
          )
        ).stdout.trim()
        await writeFile(exclude, 'ignored.txt\n')
        await writeFile(join(worktree, 'ignored.txt'), 'precious ignored content')
        await git('-C', worktree, 'config', 'pull.rebase', 'true')
        await git('-C', worktree, 'config', 'merge.autoStash', 'true')
        await expect(sourceControl.mutate(worktree, pull, async () => true)).rejects.toThrow()
        expect(await readFile(join(worktree, 'ignored.txt'), 'utf8')).toBe(
          'precious ignored content',
        )
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
      }, 30000)
      it('rejects moved HEAD before push and never pushes staged-only contents', async () => {
        let current
        const noConfirmation = vi.fn().mockResolvedValue(false)
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
          (
            await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
          ).stdout.trim(),
        ).toBe(beforePush)
        current = await sourceControl.status(worktree)
        await writeFile(join(worktree, 'local.txt'), 'staged, not committed\n')
        await git('-C', worktree, 'add', '--', 'local.txt')
        await sourceControl.mutate(worktree, { ...push, head: current.head! }, noConfirmation)
        expect(noConfirmation).not.toHaveBeenCalled()
        expect(
          (
            await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
          ).stdout.trim(),
        ).toBe(current.head)
        expect((await git('--git-dir', remote, 'show', 'feature/worktree:local.txt')).stdout).toBe(
          'local baseline\n',
        )
        expect((await sourceControl.status(worktree)).entries).toEqual([
          expect.objectContaining({ path: 'local.txt', area: 'staged' }),
        ])
        await git('-C', worktree, 'restore', '--staged', '--worktree', '--', 'local.txt')
      }, 30000)
      it('refuses divergent push/pull and syncs without losing local changes', async () => {
        let current
        const noConfirmation = vi.fn().mockResolvedValue(false)
        const push = {
          ...target,
          action: 'push' as const,
          branch: 'feature/worktree',
          tracking: { remote: 'review', branch: 'feature/worktree' },
        }
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
        expect((await git('-C', worktree, 'rev-parse', 'HEAD^2')).stdout.trim()).toBe(
          syncRemoteHead,
        )
        expect(noConfirmation).not.toHaveBeenCalled()
        expect(merged.ahead).toBe(0)
        expect(
          (
            await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
          ).stdout.trim(),
        ).toBe(merged.head)
        expect((await git('--git-dir', remote, 'show', 'feature/worktree:local.txt')).stdout).toBe(
          'local baseline\n',
        )
        expect(await readFile(join(worktree, 'local.txt'), 'utf8')).toBe('keep during sync\n')
        expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe(
          'keep untracked during sync\n',
        )
        const alreadySynced = vi.fn().mockResolvedValue(true)
        await sourceControl.mutate(worktree, { ...sync, head: merged.head! }, alreadySynced)
        expect(alreadySynced).not.toHaveBeenCalled()
        await rm(join(worktree, 'dirty.txt'))
        await git('-C', worktree, 'restore', '--worktree', '--', 'local.txt')
      }, 30000)
      it('preserves merge conflicts and never pushes a failed sync', async () => {
        let current
        const sync = {
          ...target,
          action: 'sync' as const,
          branch: 'feature/worktree',
          tracking: { remote: 'review', branch: 'feature/worktree' },
        }
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
          (
            await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')
          ).stdout.trim(),
        ).toBe(conflictRemote)
        expect((await git('-C', worktree, 'stash', 'list')).stdout).toBe('')
        await git('-C', worktree, 'merge', '--abort')
        await rm(join(worktree, 'dirty.txt'))
      }, 30000)
      it('switches local and remote branches only after checking occupancy, HEAD and local files', async () => {
        await git('-C', worktree, 'commit', '--allow-empty', '-m', 'local change')
        const current = await sourceControl.status(worktree)
        const noPushOnConflict = vi.fn().mockResolvedValue(true)
        const exclude = (
          await git(
            '-C',
            worktree,
            'rev-parse',
            '--path-format=absolute',
            '--git-path',
            'info/exclude',
          )
        ).stdout.trim()
        const occupiedPath = join(directory, 'occupied')
        await git('worktree', 'add', '-b', 'feature/occupied', occupiedPath, 'HEAD')
        expect((await sourceControl.references(worktree)).branches).toContainEqual({
          ref: 'refs/heads/feature/occupied',
          label: 'feature/occupied',
          date: (
            await git('show', '-s', '--format=%cI', 'refs/heads/feature/occupied')
          ).stdout.trim(),
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
        await expect(
          sourceControl.mutate(worktree, switchBranch, noPushOnConflict),
        ).rejects.toThrow('切换分支前')
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
        await expect(
          sourceControl.mutate(worktree, switchRemote, noPushOnConflict),
        ).rejects.toThrow('切换分支前')
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
      }, 30000)
    })
  })
  it('paginates a fixed commit snapshot and rejects unrelated comparisons', async () => {
    const beforeRemoteSwitch = await sourceControl.status(worktree)
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
  }, 15000)
})
