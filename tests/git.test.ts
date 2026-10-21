import { execFile } from 'node:child_process'
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
import { projectBranch } from '../src/main/git'
import { SourceControlService, parseGitStatus } from '../src/main/source-control'

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
    const initial = await sourceControl.status(nested)
    expect(initial.rootPath).toBe(directory)
    expect(initial.head).toBeNull()
    expect(initial.branch).toBe('feature/工作区')
    expect(await sourceControl.history(directory)).toEqual({ head: null, commits: [], more: false })
    expect(initial.entries).toEqual([expect.objectContaining(file)])
    expect(await sourceControl.diff(directory, file)).toEqual({
      kind: 'text',
      original: '',
      modified: 'first\n',
    })
    const target = { projectPath: directory, workspaceId: 'fixture' }
    const noConfirm = vi.fn().mockResolvedValue(false)
    await sourceControl.mutate(directory, { ...target, action: 'stage', files: [file] }, noConfirm)
    await writeFile(join(directory, name), 'second\n')
    expect((await sourceControl.status(directory)).entries.map((entry) => entry.area)).toEqual([
      'staged',
      'unstaged',
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
    expect(root.entries).toEqual([expect.objectContaining({ path: name, status: 'A' })])
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
    await sourceControl.mutate(
      worktree,
      { ...target, action: 'stage', files: [{ path: 'file.txt', area: 'untracked' }] },
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
    expect(branchReview.entries).toEqual([
      expect.objectContaining({ path: 'renamed 空格.txt', status: 'A' }),
    ])

    const remote = join(directory, 'remote.git')
    const peer = join(directory, 'peer')
    await git('init', '--bare', '--initial-branch=main', remote)
    await git('-C', worktree, 'remote', 'add', 'review', remote)
    expect((await sourceControl.references(worktree)).remotes).toEqual(['review'])
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
    expect(await sourceControl.mutate(worktree, publish, async () => false)).toBe(false)
    await expect(
      git('--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/feature/worktree'),
    ).rejects.toThrow()
    expect(await sourceControl.mutate(worktree, publish, async () => true)).toBe(true)
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
    await expect(sourceControl.mutate(worktree, pull, async () => true)).rejects.toThrow(
      '所有工作区更改',
    )
    await rm(join(worktree, 'dirty.txt'))
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
    expect((await sourceControl.status(worktree)).entries).toEqual([])

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
    await expect(
      sourceControl.mutate(worktree, push, async () => {
        await git('-C', worktree, 'commit', '--allow-empty', '-m', 'agent moved HEAD')
        return true
      }),
    ).rejects.toThrow('HEAD 已改变')
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(beforePush)
    current = await sourceControl.status(worktree)
    await sourceControl.mutate(worktree, { ...push, head: current.head! }, async () => true)
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(current.head)

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

    // Sync merges divergence before pushing, but cancellation keeps the merged commit local.
    await git('-C', worktree, 'config', 'remote.review.mirror', 'false')
    const sync = { ...divergence, action: 'sync' as const }
    const confirmSync = vi.fn().mockResolvedValue(false)
    expect(await sourceControl.mutate(worktree, sync, confirmSync)).toBe(false)
    const merged = await sourceControl.status(worktree)
    expect(merged.entries).toEqual([])
    expect((await git('-C', worktree, 'rev-parse', 'HEAD^1')).stdout.trim()).toBe(current.head)
    expect((await git('-C', worktree, 'rev-parse', 'HEAD^2')).stdout.trim()).toBe(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    )
    expect(confirmSync).toHaveBeenCalledOnce()
    expect(merged.ahead).toBeGreaterThan(0)
    expect(
      await sourceControl.mutate(worktree, { ...sync, head: merged.head! }, async () => true),
    ).toBe(true)
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(merged.head)
    const alreadySynced = vi.fn().mockResolvedValue(true)
    await sourceControl.mutate(worktree, { ...sync, head: merged.head! }, alreadySynced)
    expect(alreadySynced).not.toHaveBeenCalled()

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
    ).rejects.toThrow('所有工作区更改')
    expect(await readFile(join(worktree, 'dirty.txt'), 'utf8')).toBe('keep local changes\n')
    await rm(join(worktree, 'dirty.txt'))
    await expect(
      sourceControl.mutate(worktree, { ...sync, head: current.head! }, noPushOnConflict),
    ).rejects.toThrow('拉取合并未完成，未执行推送')
    expect(noPushOnConflict).not.toHaveBeenCalled()
    expect((await sourceControl.status(worktree)).entries).toContainEqual(
      expect.objectContaining({ area: 'conflict', path: 'renamed 空格.txt' }),
    )
    expect(
      (await git('--git-dir', remote, 'rev-parse', 'refs/heads/feature/worktree')).stdout.trim(),
    ).toBe(conflictRemote)
    expect((await git('-C', worktree, 'stash', 'list')).stdout).toBe('')
    await git('-C', worktree, 'merge', '--abort')

    const occupiedPath = join(directory, 'occupied')
    await git('worktree', 'add', '-b', 'feature/occupied', occupiedPath, 'HEAD')
    expect((await sourceControl.references(worktree)).branches).toContainEqual({
      ref: 'refs/heads/feature/occupied',
      label: 'feature/occupied',
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
    ).rejects.toThrow('本地分支')
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
    await git('-C', worktree, 'switch', '--orphan', 'unrelated')
    await git('-C', worktree, 'commit', '--allow-empty', '-m', 'unrelated')
    await expect(
      sourceControl.compare(worktree, { kind: 'branch', ref: 'refs/heads/main' }),
    ).rejects.toThrow('没有共同祖先')
  }, 30000)

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
