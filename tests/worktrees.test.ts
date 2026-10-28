import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../src/main/config'
import {
  GitService,
  gitEnvironment,
  parseWorktreeList,
  WorktreeError,
} from '../src/main/git/git-worktrees'
import { WorktreeManager } from '../src/main/git/worktree-manager'
import { WorktreeSetupService } from '../src/main/git/worktree-setup'
import * as shells from '../src/main/system/shell'
import { setupFileLines, worktreeSetupSchema } from '../src/shared/worktree-setup'
import { DEFAULT_CONFIG, type WorktreeRecord, type TerminalSession } from '../src/shared/contracts'
import {
  SPACE_NAMES,
  suggestWorktreeName,
  worktreeBranchSegment,
} from '../src/shared/worktree-names'

const execFileAsync = promisify(execFile)
const service = new GitService()
let root: string
let repo: string
let config: ConfigStore
let manager: WorktreeManager
const git = async (cwd: string, ...args: string[]) =>
  (
    await execFileAsync('git', args, {
      cwd,
      env: { ...gitEnvironment(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      timeout: 10000,
    })
  ).stdout
const input = (projectPath: string, branchName = 'feature/中文') => ({
  projectPath,
  branchName,
  name: '功能 工作区',
  baseRef: 'main',
})
const removalOptions = () => ({
  deleteBranch: false,
  sessions: vi.fn(async (): Promise<TerminalSession[]> => []),
  close: vi.fn(async (_id: string) => {}),
  confirm: vi.fn(async (_check?: unknown, _force?: boolean) => true),
})
const init = async (path: string, committed = true) => {
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

beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  root = await realpath(await mkdtemp(join(tmpdir(), 'cota worktree 中文-')))
  repo = join(root, '项目 空格')
  await init(repo)
  config = new ConfigStore(join(root, 'config.json'))
  await config.load()
  await config.remember(repo)
  manager = new WorktreeManager(config, join(root, '.cota-dev', 'worktrees'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('Main-authorized workspace and Worktree lifecycle', () => {
  it('uses the exact Main preview and atomically persists registry plus workspace before returning', async () => {
    expect(new Set(SPACE_NAMES).size).toBe(SPACE_NAMES.length)
    expect(SPACE_NAMES.every((name) => /^[a-z]+(?:-[a-z]+)*$/.test(name))).toBe(true)
    expect(suggestWorktreeName([' MERCURY '], () => 0)).toBe('venus')
    expect(suggestWorktreeName(SPACE_NAMES, () => 0)).toBe('mercury-2')
    expect(suggestWorktreeName([...SPACE_NAMES, 'MERCURY-2'], () => 0)).toBe('venus-2')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const before = config.snapshot()
    const suggested = await manager.suggestName(repo)
    expect(suggested).toEqual({ name: 'mercury', branchPrefix: 'cota-test' })
    expect(await manager.suggestName(repo)).toEqual(suggested)
    expect(config.snapshot()).toEqual(before)
    expect(worktreeBranchSegment(' A..B.lock @{foo}/ ')).toBe('a-b-lock-foo')
    expect(worktreeBranchSegment(' 功能 工作区 ')).toBe('功能-工作区')
    await git(repo, 'config', 'user.name', '')
    await expect(manager.suggestName(repo)).rejects.toThrow('git config user.name')
    await git(repo, 'config', 'user.name', 'Cota Test')
    await git(repo, 'branch', 'cota-test')
    await expect(manager.suggestName(repo)).rejects.toMatchObject({ code: 'BRANCH_EXISTS' })
    await git(repo, 'branch', '-D', 'cota-test')
    await git(repo, 'branch', 'cota-test/mercury/task')
    expect(await manager.suggestName(repo)).toEqual({ name: 'venus', branchPrefix: 'cota-test' })
    const creationInput = {
      ...input(repo),
      branchName: `${suggested.branchPrefix}/${worktreeBranchSegment(input(repo).name)}`,
    }
    const plan = await manager.planWorktree(creationInput)
    await mkdir(join(dirname(plan.path), 'venus'))
    const result = await manager.createWorktree({ ...creationInput, planId: plan.id })
    expect(result.record.initialBranch).toBe('cota-test/功能-工作区')
    await config.reserveWorktreeName(result.record.repoId, 'earth')
    expect(await manager.suggestName(repo)).toEqual({ name: 'mars', branchPrefix: 'cota-test' })
    expect(result.record.path).toBe(plan.path)
    expect(result.record.id).toBe(plan.id)
    expect(plan.path).toBe(join(root, '.cota-dev', 'worktrees', '项目-空格', '功能-工作区'))
    const loaded = await new ConfigStore(join(root, 'config.json')).load()
    expect(loaded.config.layout?.workspaces).toEqual([result.workspace])
    expect(loaded.config.worktreeRecords).toEqual([result.record])
    await expect(
      manager.createWorktree({ ...input(repo, 'other'), planId: plan.id }),
    ).rejects.toThrow('计划已失效')
    expect(await service.listWorktrees(repo)).toHaveLength(2)
  }, 15000)
  it('revalidates preview parents before Git writes and never follows a replaced symlink', async () => {
    const plan = await manager.planWorktree(input(repo))
    const outside = join(root, 'outside')
    await mkdir(outside)
    await rm(dirname(plan.path), { recursive: true })
    await symlink(outside, dirname(plan.path))
    await expect(manager.createWorktree({ ...input(repo), planId: plan.id })).rejects.toMatchObject(
      { code: 'PATH_CONFLICT' },
    )
    expect(await service.listWorktrees(repo)).toHaveLength(1)
    expect(await git(repo, 'branch', '--list', 'feature/中文')).toBe('')
    expect(config.snapshot().worktreeRecords).toEqual([])
  })
  it('does not consume suffixes just by previewing and revalidates competing previews at creation', async () => {
    const [first, second] = await Promise.all([
      manager.planWorktree(input(repo, 'first')),
      manager.planWorktree(input(repo, 'second')),
    ])
    expect(second.path).toBe(first.path)
    const { record } = await manager.createWorktree({ ...input(repo, 'first'), planId: first.id })
    await expect(
      manager.createWorktree({ ...input(repo, 'second'), planId: second.id }),
    ).rejects.toMatchObject({ code: 'PATH_CONFLICT' })
    const retry = await manager.planWorktree(input(repo, 'second'))
    expect(retry.path).toBe(`${first.path}-2`)
    await manager.removeWorktree(record.id, removalOptions())
    const result = await manager.createWorktree({ ...input(repo, 'second'), planId: retry.id })
    expect(result.record.path).toBe(retry.path)
  }, 15000)
  it('rejects an occupied preview without changing paths, branches or existing files', async () => {
    const plan = await manager.planWorktree(input(repo))
    await mkdir(plan.path)
    await writeFile(join(plan.path, 'keep.txt'), 'keep')
    await expect(manager.createWorktree({ ...input(repo), planId: plan.id })).rejects.toMatchObject(
      { code: 'PATH_CONFLICT' },
    )
    expect(await readFile(join(plan.path, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await git(repo, 'branch', '--list', 'feature/中文')).toBe('')
    expect(config.snapshot().worktreeRecords).toEqual([])
  })
  it('skips empty directories, files, dangling symlinks and missing Git-registered paths', async () => {
    const parent = dirname((await manager.planWorktree({ ...input(repo), name: 'preview' })).path)
    const first = join(parent, 'feature')
    await mkdir(first)
    await writeFile(`${first}-2`, 'keep')
    await symlink(join(root, 'missing'), `${first}-3`)
    await git(repo, 'worktree', 'add', '-b', 'external', `${first}-4`)
    await rm(`${first}-4`, { recursive: true })
    const result = await manager.createWorktree({ ...input(repo), name: 'feature' })
    expect(result.record.path).toBe(`${first}-5`)
    expect(await readFile(`${first}-2`, 'utf8')).toBe('keep')
    expect((await lstat(`${first}-3`)).isSymbolicLink()).toBe(true)
  })
  it('keeps missing registry paths reserved even after Git prunes them', async () => {
    const { record } = await manager.createWorktree(input(repo))
    await rm(record.path, { recursive: true })
    await git(repo, 'worktree', 'prune')
    const result = await manager.createWorktree(input(repo, 'second'))
    expect(result.record.path).toBe(`${record.path}-2`)
    expect(config.snapshot().worktreeRecords).toHaveLength(2)
  })
  it('resolves stored bindings, rejects a forged directory and never falls back after path loss', async () => {
    const { record, workspace } = await manager.createWorktree(input(repo))
    const target = { projectPath: repo, workspaceId: workspace.id, cwd: repo }
    expect(await manager.withTerminalTarget(target, async (value) => value)).toMatchObject({
      cwd: record.path,
      workspaceKind: 'git-worktree',
      worktreeId: record.id,
    })
    await expect(
      manager.withTerminalTarget({ ...target, workspaceId: randomUUID() }, async () => {}),
    ).rejects.toThrow('工作区未保存')
    await git(record.path, 'switch', '--detach')
    expect(await manager.withTerminalTarget(target, async (value) => value.cwd)).toBe(record.path)
    await rm(record.path, { recursive: true })
    const spawn = vi.fn()
    await expect(manager.withTerminalTarget(target, spawn)).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })
  it('closes workspace metadata without deleting disk or provenance and safely reopens it', async () => {
    const { record, workspace } = await manager.createWorktree(input(repo))
    await config.closeWorkspace(workspace.id)
    expect(config.snapshot().layout?.workspaces).toEqual([])
    expect(config.snapshot().worktreeRecords).toEqual([record])
    expect(await readFile(join(record.path, 'example.txt'), 'utf8')).toBe('initial\n')
    const reopened = await manager.linkWorktree(repo, record.path)
    expect(reopened.record).toEqual(record)
    expect(reopened.workspace.id).not.toBe(workspace.id)
    await expect(
      config.saveLayout({
        workspaces: [workspace],
        tabs: [],
        selectedWorkspaces: {},
        activeTabs: {},
      }),
    ).rejects.toThrow('Main')
    expect(config.snapshot().layout?.workspaces).toEqual([reopened.workspace])
  })
  it('links external worktrees without granting deletion rights and never links the main directory', async () => {
    const external = join(root, 'mercury')
    await git(repo, 'worktree', 'add', '-b', 'external', external)
    const linked = await manager.linkWorktree(repo, external)
    expect(linked.record.origin).toBe('linked')
    expect((await manager.inspectRemoval(linked.record.id, [])).blockers).toContain('UNMANAGED')
    await expect(manager.linkWorktree(repo, repo)).rejects.toThrow('linked Worktree')
    const options = removalOptions()
    await writeFile(join(external, 'untracked'), 'keep')
    await expect(manager.removeWorktree(linked.record.id, options)).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
    expect(options.confirm).not.toHaveBeenCalled()
    expect(await readFile(join(external, 'untracked'), 'utf8')).toBe('keep')
    await rm(join(external, 'untracked'))
    expect(await manager.unlinkWorktree(linked.record.id, options)).toBe(true)
    expect(await readFile(join(external, 'example.txt'), 'utf8')).toBe('initial\n')
    expect(await service.listWorktrees(repo)).toHaveLength(2)
    expect(config.snapshot().worktreeRecords).toEqual([])
    await git(repo, 'worktree', 'remove', external)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(await manager.suggestName(repo)).toEqual({ name: 'venus', branchPrefix: 'cota-test' })
  })
  it('deletes only a clean created worktree and preserves its branch by default', async () => {
    const { record } = await manager.createWorktree({ ...input(repo), name: 'mercury' })
    expect((await manager.inspectRemoval(record.id, [])).allowed).toBe(true)
    const options = removalOptions()
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({
      removed: true,
      branchRetained: true,
    })
    await expect(lstat(record.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await service.listWorktrees(repo)).toHaveLength(1)
    expect(await git(repo, 'branch', '--list', 'feature/中文')).toContain('feature/中文')
    expect(config.snapshot().worktreeRecords).toEqual([])
    expect(config.snapshot().layout?.workspaces).toEqual([])
    const restored = new ConfigStore(join(root, 'config.json'))
    await restored.load()
    await restored.forget(repo)
    await restored.remember(repo)
    const restarted = new WorktreeManager(restored, join(root, '.cota-dev', 'worktrees'))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(await restarted.suggestName(repo)).toEqual({ name: 'venus', branchPrefix: 'cota-test' })
    const retry = await restarted.planWorktree({ ...input(repo, 'next'), name: 'mercury' })
    expect(retry.path).toBe(`${record.path}-2`)
    const merged = await restarted.createWorktree(input(repo, 'merged'))
    const deleteOptions = { ...removalOptions(), deleteBranch: true }
    expect(await restarted.removeWorktree(merged.record.id, deleteOptions)).toMatchObject({
      removed: true,
      branchRetained: false,
    })
    expect(deleteOptions.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ currentBranch: 'merged' }),
      false,
    )
    expect(await git(repo, 'branch', '--list', 'merged')).toBe('')
  }, 15000)
  it('requires force confirmation for edits and ignored files but never bypasses locks', async () => {
    const { record } = await manager.createWorktree(input(repo))
    const options = removalOptions()
    options.confirm.mockResolvedValue(false)
    await writeFile(join(record.path, 'example.txt'), 'changed')
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('DIRTY')
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ cancelled: true })
    expect(options.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ blockers: ['DIRTY'] }),
      true,
    )
    expect(await readFile(join(record.path, 'example.txt'), 'utf8')).toBe('changed')
    expect(options.close).not.toHaveBeenCalled()
    await writeFile(join(record.path, 'example.txt'), 'initial\n')
    await writeFile(join(record.path, 'untracked'), 'keep')
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('UNTRACKED_FILES')
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ cancelled: true })
    expect(options.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ blockers: ['UNTRACKED_FILES'] }),
      true,
    )
    expect(await readFile(join(record.path, 'untracked'), 'utf8')).toBe('keep')
    await rm(join(record.path, 'untracked'))
    await writeFile(join(repo, '.git', 'info', 'exclude'), 'ignored\n')
    await writeFile(join(record.path, 'ignored'), 'keep ignored')
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('IGNORED_CONTENT')
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ cancelled: true })
    expect(options.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ blockers: ['IGNORED_CONTENT'] }),
      true,
    )
    expect(await readFile(join(record.path, 'ignored'), 'utf8')).toBe('keep ignored')
    await rm(join(record.path, 'ignored'))
    await git(repo, 'worktree', 'lock', '--reason', 'keep', record.path)
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('LOCKED')
    options.confirm.mockClear().mockResolvedValue(true)
    await expect(manager.removeWorktree(record.id, options)).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
    expect(options.confirm).not.toHaveBeenCalled()
    expect(await readFile(join(record.path, 'example.txt'), 'utf8')).toBe('initial\n')
    expect(config.snapshot().worktreeRecords).toEqual([record])
    await git(repo, 'worktree', 'unlock', record.path)
    await writeFile(join(record.path, 'example.txt'), 'staged change')
    await git(record.path, 'add', 'example.txt')
    await writeFile(join(record.path, 'untracked'), 'discard')
    await writeFile(join(record.path, 'ignored'), 'discard ignored')
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({
      removed: true,
      branchRetained: true,
    })
    expect(options.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        blockers: expect.arrayContaining(['DIRTY', 'UNTRACKED_FILES', 'IGNORED_CONTENT']),
      }),
      true,
    )
    await expect(lstat(record.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(config.snapshot().worktreeRecords).toEqual([])
  }, 15000)
  it('blocks populated submodules even when Git status is clean', async () => {
    const module = join(root, 'module')
    await init(module)
    await git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', module, 'module')
    await git(repo, 'commit', '-am', 'module')
    const { record } = await manager.createWorktree(input(repo))
    await git(record.path, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init')
    expect(await git(record.path, 'status', '--porcelain')).toBe('')
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('POPULATED_SUBMODULE')
    await expect(manager.removeWorktree(record.id, removalOptions())).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
  }, 15000)
  it('blocks wrong environment ownership, main roots and symlink replacements', async () => {
    const { record } = await manager.createWorktree(input(repo))
    const release = new WorktreeManager(config, join(root, '.cota', 'worktrees'))
    expect((await release.inspectRemoval(record.id, [])).blockers).toContain('OWNERSHIP_MISMATCH')
    await config.registerWorktree({ ...record, id: randomUUID(), path: repo })
    expect(
      (await manager.inspectRemoval(config.snapshot().worktreeRecords[1].id, [])).blockers,
    ).toContain('MAIN_WORKTREE')
    await rm(record.path, { recursive: true })
    await symlink(repo, record.path)
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('OWNERSHIP_MISMATCH')
    await expect(manager.removeWorktree(record.id, removalOptions())).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
    expect(await readFile(join(repo, 'example.txt'), 'utf8')).toBe('initial\n')
  }, 15000)
  it('matches sessions by cwd across workspace ids, cancels untouched and blocks failed process cleanup', async () => {
    const { record } = await manager.createWorktree(input(repo))
    const session: TerminalSession = {
      id: randomUUID(),
      projectPath: repo,
      workspaceId: randomUUID(),
      cwd: join(record.path, '..cache'),
      workspaceKind: 'local',
      cols: 80,
      rows: 24,
      exited: false,
    }
    const options = removalOptions()
    options.sessions.mockResolvedValue([session])
    options.confirm.mockResolvedValueOnce(false)
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ cancelled: true })
    expect(options.close).not.toHaveBeenCalled()
    expect(options.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ liveTerminalIds: [session.id] }),
      false,
    )
    options.close.mockRejectedValueOnce(new Error('process still alive'))
    await expect(manager.removeWorktree(record.id, options)).rejects.toThrow('process still alive')
    expect(config.snapshot().worktreeRecords).toEqual([record])
    expect((await manager.scanWorktrees(repo)).entries[0].status).toBe('ready')
    options.close.mockImplementation(async () => {
      options.sessions.mockResolvedValue([])
    })
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ removed: true })
  }, 15000)
  it('rechecks dirty state after confirmation and holds terminal creation behind deletion', async () => {
    const { record, workspace } = await manager.createWorktree(input(repo))
    const options = removalOptions()
    options.confirm.mockImplementationOnce(async () => {
      await writeFile(join(record.path, 'after-confirm'), 'keep')
      return true
    })
    await expect(manager.removeWorktree(record.id, options)).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
    await rm(join(record.path, 'after-confirm'))
    let release!: (answer: boolean) => void
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    options.confirm.mockImplementationOnce(async () => {
      entered()
      return new Promise<boolean>((resolve) => {
        release = resolve
      })
    })
    const removing = manager.removeWorktree(record.id, options)
    await ready
    const start = vi.fn()
    const creating = manager
      .withTerminalTarget({ projectPath: repo, workspaceId: workspace.id }, start)
      .catch((error) => error)
    expect(start).not.toHaveBeenCalled()
    release(true)
    await removing
    expect(await creating).toBeInstanceOf(Error)
    expect(start).not.toHaveBeenCalled()
    expect(manager.removing).toBe(false)
  }, 15000)
  it('reports persistence partial success and requires force confirmation to delete a divergent branch', async () => {
    const first = await manager.createWorktree(input(repo))
    vi.spyOn(config, 'forgetWorktree').mockRejectedValueOnce(new Error('disk full'))
    await expect(manager.removeWorktree(first.record.id, removalOptions())).rejects.toMatchObject({
      code: 'CONFIG_PERSIST_FAILED',
      details: { gitState: 'removed' },
    })
    expect((await manager.scanWorktrees(repo)).entries[0].status).toBe('missing')
    await manager.unlinkWorktree(first.record.id, removalOptions())
    const { record } = await manager.createWorktree(input(repo, 'unmerged'))
    await writeFile(join(record.path, 'new.txt'), 'work')
    await git(record.path, 'add', 'new.txt')
    await git(record.path, 'commit', '-m', 'unmerged change')
    await git(repo, 'branch', 'saved-upstream', 'unmerged')
    await git(repo, 'branch', '--set-upstream-to=saved-upstream', 'unmerged')
    expect(await service.inspectBranchDeletion(repo, 'unmerged')).toMatchObject({ merged: true })
    await git(repo, 'branch', '-D', 'saved-upstream')
    expect(await service.inspectBranchDeletion(repo, 'unmerged')).toMatchObject({ merged: false })
    const options = { ...removalOptions(), deleteBranch: true }
    options.confirm.mockResolvedValueOnce(false)
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({ cancelled: true })
    expect(options.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentBranch: 'unmerged' }),
      true,
    )
    expect(await git(repo, 'branch', '--list', 'unmerged')).toContain('unmerged')
    expect(config.snapshot().worktreeRecords).toEqual([record])
    options.confirm.mockImplementationOnce(async () => {
      await git(record.path, 'commit', '--allow-empty', '-m', 'concurrent commit')
      return true
    })
    await expect(manager.removeWorktree(record.id, options)).rejects.toMatchObject({
      code: 'REMOVAL_BLOCKED',
    })
    expect(await lstat(record.path)).toBeDefined()
    expect(await manager.removeWorktree(record.id, options)).toMatchObject({
      removed: true,
      branchRetained: false,
    })
    expect(await git(repo, 'branch', '--list', 'unmerged')).toBe('')
    await expect(lstat(record.path)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)
  it('recovers after a Git remove error by checking actual disk and Git state', async () => {
    const isolated = new GitService()
    const subject = new WorktreeManager(config, join(root, '.cota-dev', 'worktrees'), isolated)
    const { record } = await subject.createWorktree(input(repo))
    const remove = isolated.removeWorktree.bind(isolated)
    vi.spyOn(isolated, 'removeWorktree').mockImplementationOnce(async (...args) => {
      await remove(...args)
      throw new Error('timeout after remove')
    })
    expect(await subject.removeWorktree(record.id, removalOptions())).toMatchObject({
      removed: true,
      warning: expect.any(String),
    })
    expect(config.snapshot().worktreeRecords).toEqual([])
    const next = await subject.createWorktree(input(repo, 'retained'))
    vi.spyOn(isolated, 'deleteBranch').mockRejectedValueOnce(new Error('branch locked'))
    expect(
      await subject.removeWorktree(next.record.id, { ...removalOptions(), deleteBranch: true }),
    ).toMatchObject({ removed: true, branchRetained: true, warning: expect.any(String) })
    expect(await git(repo, 'branch', '--list', 'retained')).toContain('retained')
    await expect(lstat(next.record.path)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)
  it('keeps registry and diagnostic states on read failures, external entries and Host identity conflicts', async () => {
    const { record, workspace } = await manager.createWorktree(input(repo))
    const external = join(root, 'external')
    await git(repo, 'worktree', 'add', '--detach', external)
    expect((await manager.scanWorktrees(repo)).external).toMatchObject([
      { path: external, branch: null },
    ])
    const session: TerminalSession = {
      id: randomUUID(),
      projectPath: repo,
      workspaceId: workspace.id,
      cwd: repo,
      workspaceKind: 'git-worktree',
      worktreeId: record.id,
      repoCommonDir: record.repoCommonDir,
      cols: 80,
      rows: 24,
      exited: false,
    }
    expect((await manager.scanWorktrees(repo, [session])).entries[0].status).toBe('conflict')
    expect(
      (
        await manager.scanWorktrees(repo, [
          { ...session, cwd: record.path, projectPath: '/another/project' },
        ])
      ).entries[0].status,
    ).toBe('conflict')
    const isolated = new GitService()
    vi.spyOn(isolated, 'listWorktrees').mockRejectedValue(new Error('temporary unavailable'))
    const scan = await new WorktreeManager(
      config,
      join(root, '.cota-dev', 'worktrees'),
      isolated,
    ).scanWorktrees(repo)
    expect(scan.entries[0]).toMatchObject({
      record,
      status: 'unavailable',
      error: 'temporary unavailable',
    })
    expect(config.snapshot().worktreeRecords).toEqual([record])
    await rm(record.path, { recursive: true })
    expect((await manager.scanWorktrees(repo)).entries[0].status).toBe('missing')
  }, 15000)
})

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

describe('repository discovery and authoritative listing', () => {
  it('canonicalizes subdirectories and linked worktree .git files to the same repository', async () => {
    const child = join(repo, 'nested')
    const linked = join(root, 'linked 中文')
    await mkdir(child)
    await git(repo, 'worktree', 'add', '-b', 'other', linked)
    const base = await service.requireRepository(child)
    expect(base).toEqual({
      status: 'ready',
      projectPath: child,
      rootPath: repo,
      repoCommonDir: join(repo, '.git'),
      isBare: false,
    })
    expect((await service.requireRepository(linked)).repoCommonDir).toBe(base.repoCommonDir)
    expect((await lstat(join(linked, '.git'))).isFile()).toBe(true)
    const alias = join(root, 'repo-alias')
    await symlink(repo, alias)
    expect((await service.requireRepository(alias)).repoCommonDir).toBe(base.repoCommonDir)
  })
  it('distinguishes non-Git, missing directory, Git unavailable, corrupt and bare repositories', async () => {
    expect(await service.inspectRepository(root)).toMatchObject({
      status: 'nonGit',
      code: 'NOT_GIT_REPO',
    })
    expect(await service.inspectRepository(join(root, 'missing'))).toMatchObject({
      status: 'unavailable',
      code: 'REPOSITORY_UNAVAILABLE',
    })
    const broken = join(root, 'broken')
    await mkdir(broken)
    await writeFile(join(broken, '.git'), 'gitdir: /missing/cota-gitdir\n')
    expect(await service.inspectRepository(broken)).toMatchObject({ status: 'unavailable' })
    const bare = join(root, 'bare.git')
    await git(root, 'init', '--bare', bare)
    expect(await service.inspectRepository(bare)).toMatchObject({
      status: 'unsupported',
      isBare: true,
      code: 'UNSUPPORTED_REPOSITORY',
    })
    vi.stubEnv('PATH', join(root, 'no-git'))
    expect(await service.inspectRepository(repo)).toMatchObject({
      status: 'gitUnavailable',
      code: 'GIT_UNAVAILABLE',
    })
    await expect(service.listWorktrees(repo)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' })
  })
  it('lists two external worktrees including real branch switches, detached, locked and prunable states', async () => {
    const one = join(root, 'external one')
    const two = join(root, 'external 二')
    await git(repo, 'worktree', 'add', '-b', 'feature/one', one)
    await git(repo, 'worktree', 'add', '-b', 'feature/two', two)
    await git(one, 'checkout', '--detach')
    await git(repo, 'worktree', 'lock', '--reason', 'please keep', one)
    await rm(two, { recursive: true })
    const entries = await manager.listWorktrees(repo)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ path: repo, isMain: true, branch: 'main' })
    expect(entries[1]).toMatchObject({
      path: one,
      branch: null,
      locked: true,
      lockReason: 'please keep',
    })
    expect(entries[2]).toMatchObject({ path: two, branch: 'feature/two', prunable: true })
    expect(entries.every((entry) => !entry.managedByCota)).toBe(true)
  })
  it('clears inherited Git context, config injection, index and namespace overrides', async () => {
    for (const key of [
      'GIT_DIR',
      'GIT_COMMON_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_NAMESPACE',
    ])
      vi.stubEnv(key, '/missing/wrong')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.bare')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true')
    expect(gitEnvironment()).not.toHaveProperty('GIT_CONFIG_COUNT')
    expect((await service.requireRepository(repo)).rootPath).toBe(repo)
    expect(await service.listWorktrees(repo)).toHaveLength(1)
  })
})

describe('controlled worktree creation and persistence', () => {
  it('creates from a local commit OID, persists provenance, and reads current branches from Git', async () => {
    const { record, worktree } = await manager.createWorktree(input(repo))
    expect(record).toMatchObject({
      projectPath: repo,
      repoCommonDir: join(repo, '.git'),
      origin: 'created',
      initialBranch: 'feature/中文',
      baseRef: 'main',
    })
    expect(record.path).toBe(join(root, '.cota-dev', 'worktrees', '项目-空格', '功能-工作区'))
    expect(worktree).toMatchObject({
      path: record.path,
      branch: 'feature/中文',
      managedByCota: true,
      worktreeId: record.id,
    })
    expect(await readFile(join(record.path, 'example.txt'), 'utf8')).toBe('initial\n')
    await git(record.path, 'switch', '-c', 'changed')
    expect(
      (await manager.listWorktrees(repo)).find((entry) => entry.path === record.path),
    ).toMatchObject({ branch: 'changed', managedByCota: true })
    expect(config.snapshot().worktreeRecords[0].initialBranch).toBe('feature/中文')
    const restored = await new ConfigStore(join(root, 'config.json')).load()
    expect(restored.warning).toBeUndefined()
    expect(restored.config.worktreeRecords).toEqual([record])
    expect(restored.config.layout?.workspaces).toEqual([
      expect.objectContaining({ kind: 'git-worktree', worktreeId: record.id }),
    ])
  })
  it('keeps registry records when projects are evicted from recents or explicitly forgotten', async () => {
    const { record } = await manager.createWorktree(input(repo))
    for (let index = 0; index < 21; index++) await config.remember(join(root, `recent-${index}`))
    expect(config.snapshot().recentProjects).not.toContain(repo)
    expect(config.snapshot().worktreeRecords).toEqual([record])
    await config.forget(repo)
    expect(config.snapshot().worktreeRecords).toEqual([record])
    await config.remember(repo)
    expect(
      (await manager.listWorktrees(repo)).find((entry) => entry.path === record.path)
        ?.managedByCota,
    ).toBe(true)
  })
  it.each(['--help', 'has spaces', '@{-1}'])(
    'rejects unsafe or invalid branch names without changing Git: %s',
    async (name) => {
      await expect(manager.createWorktree(input(repo, name))).rejects.toMatchObject({
        code: 'INVALID_BRANCH_NAME',
      })
      expect(await service.listWorktrees(repo)).toHaveLength(1)
      expect(config.snapshot().worktreeRecords).toEqual([])
    },
  )
  it('rejects duplicate branches, invalid base references and unborn HEAD without overwriting data', async () => {
    await expect(manager.createWorktree(input(repo, 'main'))).rejects.toMatchObject({
      code: 'BRANCH_EXISTS',
    })
    for (const baseRef of ['missing-commit', '--help', 'does-not-exist^{tree}'])
      await expect(manager.createWorktree({ ...input(repo), baseRef })).rejects.toMatchObject({
        code: 'BASE_REF_NOT_FOUND',
      })
    const unborn = join(root, 'unborn')
    await init(unborn, false)
    await config.remember(unborn)
    await expect(
      manager.createWorktree({ ...input(unborn), baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ code: 'BASE_REF_NOT_FOUND' })
    expect(await service.listWorktrees(repo)).toHaveLength(1)
  })
  it('rejects unknown projects and malformed requests before creating directories', async () => {
    for (const value of [
      null,
      { ...input(repo), name: '  ' },
      { ...input(repo), baseRef: 'main\0' },
      { ...input(repo), projectPath: root },
    ])
      await expect(manager.createWorktree(value)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(manager.suggestName(root)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(lstat(join(root, 'worktrees'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not overwrite an existing target directory or accept a symlinked repository parent', async () => {
    const target = join(root, 'existing')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'keep')
    await expect(
      service.addWorktree(repo, target, 'new', (await git(repo, 'rev-parse', 'HEAD')).trim()),
    ).rejects.toMatchObject({ code: 'PATH_CONFLICT' })
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep')
    const { record } = await manager.createWorktree(input(repo))
    const otherRoot = join(root, 'unsafe')
    await mkdir(otherRoot)
    await symlink(target, join(otherRoot, basename(dirname(record.path))))
    const unsafe = new WorktreeManager(config, otherRoot)
    await expect(unsafe.createWorktree(input(repo, 'another'))).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    })
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep')
  })
  it('reports recoverable partial success if config persistence fails and never removes the worktree', async () => {
    vi.spyOn(config, 'reserveWorktreeName').mockRejectedValueOnce(new Error('disk full'))
    await expect(manager.createWorktree(input(repo))).rejects.toThrow('disk full')
    expect(await service.listWorktrees(repo)).toHaveLength(1)
    expect(await git(repo, 'branch', '--list', 'feature/中文')).toBe('')
    vi.spyOn(config, 'registerWorktree').mockRejectedValueOnce(new Error('disk full'))
    const failure = await manager.createWorktree(input(repo)).catch((error: WorktreeError) => error)
    expect(failure).toMatchObject({
      code: 'CONFIG_PERSIST_FAILED',
      details: { gitState: 'created', operationId: expect.any(String), path: expect.any(String) },
    })
    const path = (failure as WorktreeError).details!.path!
    const history = (await new ConfigStore(join(root, 'config.json')).load()).config
      .worktreeNameHistory
    expect(Object.values(history!).flat()).toContain(basename(path).toLowerCase())
    expect(await readFile(join(path, 'example.txt'), 'utf8')).toBe('initial\n')
    expect(await service.listWorktrees(repo)).toHaveLength(2)
    expect(config.snapshot().worktreeRecords).toEqual([])
    expect(
      (await manager.listWorktrees(repo)).find((entry) => entry.path === path)?.managedByCota,
    ).toBe(false)
  })
  it('rechecks Git after a failed or timed-out write and does not infer rollback from the command error', async () => {
    const isolated = new GitService()
    const add = isolated.addWorktree.bind(isolated)
    vi.spyOn(isolated, 'addWorktree').mockImplementationOnce(async (...args) => {
      await add(...args)
      throw new WorktreeError('GIT_COMMAND_FAILED', 'simulated timeout after checkout')
    })
    const subject = new WorktreeManager(config, join(root, 'partial'), isolated)
    await expect(subject.createWorktree(input(repo))).rejects.toMatchObject({
      code: 'GIT_COMMAND_FAILED',
      details: { gitState: 'created', worktrees: expect.any(Array) },
    })
    expect(await service.listWorktrees(repo)).toHaveLength(2)
    expect(config.snapshot().worktreeRecords).toEqual([])
  })
  it('returns an unknown state when post-write Git inspection fails, preserving files and records', async () => {
    const isolated = new GitService()
    const add = isolated.addWorktree.bind(isolated)
    vi.spyOn(isolated, 'addWorktree').mockImplementationOnce(async (...args) => {
      await add(...args)
      vi.spyOn(isolated, 'listWorktrees').mockRejectedValue(
        new WorktreeError('GIT_COMMAND_FAILED', 'temporary read failure'),
      )
    })
    const subject = new WorktreeManager(config, join(root, 'unknown'), isolated)
    await expect(subject.createWorktree(input(repo))).rejects.toMatchObject({
      details: { gitState: 'unknown', path: expect.any(String) },
    })
    expect(await service.listWorktrees(repo)).toHaveLength(2)
    expect(config.snapshot().worktreeRecords).toEqual([])
  })
  it('serializes concurrent same-repository creation and releases the gate after failure', async () => {
    const results = await Promise.allSettled([
      manager.createWorktree(input(repo)),
      manager.createWorktree(input(repo)),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'BRANCH_EXISTS' },
    })
    expect(config.snapshot().worktreeRecords).toHaveLength(1)
    const [second, third] = await Promise.all([
      manager.createWorktree(input(repo, 'second')),
      manager.createWorktree(input(repo, 'third')),
    ])
    const firstPath = config.snapshot().worktreeRecords[0].path
    expect([second.record.path, third.record.path].sort()).toEqual(
      [`${firstPath}-2`, `${firstPath}-3`].sort(),
    )
    expect(await service.listWorktrees(repo)).toHaveLength(4)
  })
  it('serializes aliases of the same repository while allowing independent repositories to proceed', async () => {
    const other = join(root, 'second repo')
    await init(other)
    await config.remember(other)
    const linked = join(root, 'same-repo')
    await git(repo, 'worktree', 'add', '-b', 'same-repo', linked)
    await config.remember(linked)
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const held = manager.withRepositoryLock(
      join(repo, '.git'),
      () =>
        new Promise<void>((resolve) => {
          release = resolve
          started()
        }),
    )
    await entered
    let completed = false
    const waiting = manager.createWorktree(input(linked)).then(() => {
      completed = true
    })
    await manager.createWorktree(input(other, 'independent'))
    expect(completed).toBe(false)
    release()
    await Promise.all([held, waiting])
    expect(completed).toBe(true)
  })
  it('uses the main repository name for aliases and isolates same-named repositories with a short ID', async () => {
    const { record } = await manager.createWorktree(input(repo))
    const other = join(root, 'other', basename(repo))
    await init(other)
    await config.remember(other)
    const otherCreated = await manager.createWorktree(input(other))
    expect(dirname(otherCreated.record.path)).toBe(
      `${dirname(record.path)}-${otherCreated.record.repoId.slice(0, 8)}`,
    )
    await config.remember(record.path)
    const aliasCreated = await manager.createWorktree(input(record.path, 'alias'))
    expect(aliasCreated.record.path).toBe(`${record.path}-2`)
    expect(aliasCreated.record.repoId).toBe(record.repoId)
    const restored = new ConfigStore(join(root, 'config.json'))
    await restored.load()
    const restarted = new WorktreeManager(restored, join(root, '.cota-dev', 'worktrees'))
    const next = await restarted.createWorktree(input(other, 'next'))
    expect(next.record.path).toBe(`${otherCreated.record.path}-2`)
    expect((await restarted.inspectRemoval(next.record.id, [])).allowed).toBe(true)
  }, 15000)
  it('does not claim unowned directories or trust a missing or replaced repository ownership marker', async () => {
    const parent = join(root, '.cota-dev', 'worktrees', '项目-空格')
    await mkdir(parent, { recursive: true })
    await writeFile(join(parent, 'keep.txt'), 'keep')
    const { record } = await manager.createWorktree(input(repo))
    expect(dirname(record.path)).toBe(`${parent}-${record.repoId.slice(0, 8)}`)
    expect(await readFile(join(parent, 'keep.txt'), 'utf8')).toBe('keep')
    const marker = join(dirname(record.path), '.cota-repository')
    await rm(marker)
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('OWNERSHIP_MISMATCH')
    const outside = join(root, 'marker')
    await writeFile(outside, record.repoId)
    await symlink(outside, marker)
    expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('OWNERSHIP_MISMATCH')
    await expect(manager.createWorktree(input(repo, 'second'))).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    })
    expect(await readFile(join(record.path, 'example.txt'), 'utf8')).toBe('initial\n')
  })
  it('isolates .cota-dev/.cota roots and never treats the other environment as managed', async () => {
    const releaseConfig = new ConfigStore(join(root, 'release-config.json'))
    await releaseConfig.load()
    await releaseConfig.remember(repo)
    const release = new WorktreeManager(releaseConfig, join(root, '.cota', 'worktrees'))
    const devCreated = await manager.createWorktree(input(repo, 'dev-branch'))
    const released = await release.createWorktree(input(repo, 'release-branch'))
    expect(devCreated.record.path).toBe(
      join(root, '.cota-dev', 'worktrees', '项目-空格', '功能-工作区'),
    )
    expect(released.record.path).toBe(join(root, '.cota', 'worktrees', '项目-空格', '功能-工作区'))
    expect(devCreated.record.repoId).toBe(released.record.repoId)
    expect(
      (await manager.listWorktrees(repo)).find((entry) => entry.path === released.record.path)
        ?.managedByCota,
    ).toBe(false)
    expect(
      (await release.listWorktrees(repo)).find((entry) => entry.path === devCreated.record.path)
        ?.managedByCota,
    ).toBe(false)
  })
  it('does not grant deletion provenance based on directory names or main-worktree records', async () => {
    const external = join(root, '.cota-dev', 'worktrees', 'looks-managed')
    await git(repo, 'worktree', 'add', '-b', 'external', external)
    const common = join(repo, '.git')
    const record: WorktreeRecord = {
      id: randomUUID(),
      repoId: 'a'.repeat(24),
      projectPath: repo,
      repoCommonDir: common,
      path: external,
      origin: 'linked',
      registeredAt: new Date().toISOString(),
    }
    await config.registerWorktree(record)
    await config.registerWorktree({ ...record, id: randomUUID(), path: repo, origin: 'created' })
    expect((await manager.listWorktrees(repo)).every((entry) => !entry.managedByCota)).toBe(true)
  })
  describe.skipIf(process.platform === 'win32')('worktree setup', () => {
    const fixture = async () => {
      vi.spyOn(shells, 'resolveShell').mockResolvedValue('/bin/sh')
      vi.spyOn(shells, 'loginShellEnvironment').mockResolvedValue({
        PATH: '/usr/bin:/bin',
        HOME: root,
      })
      const created = await manager.createWorktree(input(repo))
      const directory = join(root, 'setup-logs')
      const setup = new WorktreeSetupService(config, manager, directory)
      return {
        ...created,
        setup,
        directory,
        target: { projectPath: repo, workspaceId: created.workspace.id },
      }
    }
    const settled = async (
      setup: WorktreeSetupService,
      target: { projectPath: string; workspaceId: string },
    ) => {
      await vi.waitFor(async () => expect((await setup.inspect(target)).running).toBe(false), {
        timeout: 8000,
        interval: 100,
      })
      return (await setup.inspect(target)).run!
    }
    it('confirms before copying, runs in the worktree, preserves edits on retry and persists the result', async () => {
      const { setup, record, target, directory } = await fixture()
      try {
        await writeFile(join(repo, '.env.local'), 'local-secret')
        await mkdir(join(repo, 'config'))
        await writeFile(join(repo, 'config/local.json'), '{"local":true}')
        const definition = {
          command: 'pwd; cat .env.local; printf ready > initialized.txt',
          copyFiles: ['.env.local', 'config/local.json'],
        }
        await config.saveWorktreeSetup(repo, definition)
        expect((await setup.inspect(target)).run).toBeUndefined()
        expect(await setup.start(target, definition, async () => false)).toBe(false)
        await expect(lstat(join(record.path, '.env.local'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        const confirm = vi.fn(async (_description: string) => true)
        expect(await setup.start(target, definition, confirm)).toBe(true)
        expect(confirm.mock.calls[0][0]).toContain(record.path)
        expect(confirm.mock.calls[0][0]).toContain(repo)
        const first = await settled(setup, target)
        expect(first.status).toBe('succeeded')
        expect(first.log).toContain(record.path)
        expect(await readFile(join(record.path, 'config/local.json'), 'utf8')).toBe(
          '{"local":true}',
        )
        expect(await readFile(join(record.path, 'initialized.txt'), 'utf8')).toBe('ready')
        expect((await lstat(join(record.path, '.env.local'))).mode & 0o777).toBe(0o600)
        await writeFile(join(record.path, '.env.local'), 'edited')
        await setup.start(target, definition, async () => true)
        expect((await settled(setup, target)).log).toContain('保留已有文件')
        expect(await readFile(join(record.path, '.env.local'), 'utf8')).toBe('edited')
        expect(await readFile(join(repo, '.env.local'), 'utf8')).toBe('local-secret')
        const reloaded = new WorktreeSetupService(config, manager, directory)
        expect((await reloaded.inspect(target)).run?.status).toBe('succeeded')
        expect(
          (await new ConfigStore(join(root, 'config.json')).load()).config.worktreeSetups?.[repo],
        ).toEqual(definition)
        const last = (await reloaded.inspect(target)).run!
        await writeFile(
          join(directory, `${record.id}.json`),
          JSON.stringify({ ...last, status: 'running' }),
        )
        const interrupted = await reloaded.inspect(target)
        expect(interrupted.running).toBe(false)
        expect(interrupted.run?.status).toBe('interrupted')
        expect(interrupted.run?.log).toContain('不会自动重试')
      } finally {
        await setup.close()
      }
    }, 15000)
    it('rejects unsafe paths and symlinks before commands and keeps failed worktrees', async () => {
      const { setup, record, target } = await fixture()
      try {
        for (const path of [
          '../secret',
          '/tmp/secret',
          '.git/config',
          'node_modules/a',
          'a\\b',
          'a/../b',
          'C:/secret',
        ])
          expect(worktreeSetupSchema.safeParse({ command: '', copyFiles: [path] }).success).toBe(
            false,
          )
        expect(setupFileLines(' .env.local\n\n.env.local\r\nconfig/local.json ')).toEqual([
          '.env.local',
          'config/local.json',
        ])
        const outside = join(root, 'outside-secret')
        await writeFile(outside, 'keep')
        await symlink(outside, join(repo, 'linked.env'))
        let definition = {
          command: 'printf forbidden > should-not-exist',
          copyFiles: ['linked.env'],
        }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, async () => true)
        expect((await settled(setup, target)).status).toBe('failed')
        await mkdir(join(repo, 'config'))
        await writeFile(join(repo, 'config/secret'), 'secret')
        const outsideDirectory = join(root, 'outside-directory')
        await mkdir(outsideDirectory)
        await symlink(outsideDirectory, join(record.path, 'config'))
        definition = { ...definition, copyFiles: ['config/secret'] }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, async () => true)
        expect((await settled(setup, target)).status).toBe('failed')
        await expect(lstat(join(record.path, 'should-not-exist'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        await expect(lstat(join(outsideDirectory, 'secret'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        expect(await readFile(outside, 'utf8')).toBe('keep')
        expect(
          (await service.listWorktrees(repo)).some((entry) => entry.path === record.path),
        ).toBe(true)
      } finally {
        await setup.close()
      }
    }, 15000)
    it('blocks duplicate runs and removal, then stops the owned process and allows inspection', async () => {
      const { setup, target, record } = await fixture()
      try {
        const definition = {
          command: 'printf started; sleep 30; printf forbidden > should-not-exist',
          copyFiles: [],
        }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, async () => true)
        await vi.waitFor(
          async () => expect((await setup.inspect(target)).run?.log).toContain('started'),
          { timeout: 5000 },
        )
        await expect(setup.start(target, definition, async () => true)).rejects.toThrow('重复执行')
        expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('INITIALIZING')
        await expect(manager.removeWorktree(record.id, removalOptions())).rejects.toMatchObject({
          code: 'REMOVAL_BLOCKED',
        })
        await expect(manager.unlinkWorktree(record.id, removalOptions())).rejects.toThrow(
          '停止工作区初始化',
        )
        await setup.stop(target)
        expect((await setup.inspect(target)).run?.status).toBe('interrupted')
        expect(setup.running).toBe(false)
        await expect(lstat(join(record.path, 'should-not-exist'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        await setup.close()
      }
    }, 15000)
    it('requires fresh configuration and rechecks shutdown authorization after confirmation', async () => {
      const { setup, target } = await fixture()
      const definition = { command: 'printf forbidden > should-not-exist', copyFiles: [] }
      await config.saveWorktreeSetup(repo, definition)
      await expect(
        setup.start(target, { ...definition, command: 'old command' }, async () => true),
      ).rejects.toThrow('配置已改变')
      await expect(
        setup.start(target, definition, async () => {
          await config.saveWorktreeSetup(repo, { ...definition, command: 'updated' })
          return true
        }),
      ).rejects.toThrow('确认期间配置已改变')
      await config.saveWorktreeSetup(repo, definition)
      await expect(
        setup.start(
          target,
          definition,
          async () => true,
          () => {
            throw new Error('正在退出')
          },
        ),
      ).rejects.toThrow('正在退出')
      expect((await setup.inspect(target)).run).toBeUndefined()
      expect(setup.running).toBe(false)
    })
  })
  it('does not start Git writes if a preserved old/invalid config prevents saving', async () => {
    const file = join(root, 'old.json')
    await writeFile(file, JSON.stringify({ ...DEFAULT_CONFIG, version: 1 }))
    const blocked = new ConfigStore(file)
    expect((await blocked.load()).warning).toContain('不自动迁移')
    expect(blocked.snapshot()).toEqual(DEFAULT_CONFIG)
    await expect(blocked.remember(repo)).rejects.toThrow('原文件已保留')
    expect(await service.listWorktrees(repo)).toHaveLength(1)
  })
})
