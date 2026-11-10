import { event, mocks, path, target } from './ipc.fixture'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { WorktreeError } from '../../../src/main/git/worktrees/git'

describe('Git IPC trust boundaries', () => {
  it.each([
    'git:inspect-repository',
    'git:list-worktrees',
    'git:create-worktree',
    'git:plan-worktree',
    'git:branch-snapshot',
    'git:suggest-worktree-name',
    'git:scan-worktrees',
    'git:link-worktree',
    'git:inspect-removal',
    'git:remove-worktree',
    'git:unlink-worktree',
    'workspace:path',
  ])('rejects untrusted frames before invoking %s', async (channel) => {
    const result = await mocks.handlers.get(channel)!({ ...event, senderFrame: {} }, path)
    expect(result).toMatchObject({ ok: false, error: '拒绝未授权的窗口请求。' })
    expect(mocks.inspectRepository).not.toHaveBeenCalled()
    expect(mocks.listWorktrees).not.toHaveBeenCalled()
    expect(mocks.createWorktree).not.toHaveBeenCalled()
  })

  it('releases the repository gate during hosted reads and rejects a changed publication context', async () => {
    let locked = false
    mocks.config.recentProjects = [path]
    mocks.withTerminalTarget.mockImplementation(async (_target, action) => {
      locked = true
      try {
        return await action({
          projectPath: path,
          workspaceId: target.workspaceId,
          cwd: path,
          workspaceKind: 'local',
        })
      } finally {
        locked = false
      }
    })
    const original = {
      cwd: path,
      identity: 'repository-before',
      names: [],
      urls: [],
      status: {},
      generation: 0,
    }
    let changed = false
    mocks.hostingCapture.mockImplementation(() => {
      try {
        expect(locked).toBe(true)
        return Promise.resolve(changed ? { ...original, identity: 'repository-after' } : original)
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    mocks.hostingResolve.mockImplementation(() => {
      try {
        expect(locked).toBe(false)
        return Promise.resolve({})
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    let started!: () => void
    let finish!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    mocks.hostingInspect.mockImplementation(async () => {
      expect(locked).toBe(false)
      started()
      await gate
      return { activeReviews: [] }
    })
    const pending = mocks.handlers.get('code-hosting:inspect')!(event, target)
    await entered
    await mocks.handlers.get('git:status')!(event, target)
    changed = true
    finish()
    expect(await pending).toMatchObject({ ok: false, code: 'REPOSITORY_UNAVAILABLE' })
    expect(mocks.hostingCapture).toHaveBeenCalledTimes(2)
    expect(mocks.gitStatus).toHaveBeenCalled()
  })

  it('resolves Git operations from Main bindings rather than Renderer identities', async () => {
    mocks.config.recentProjects = [path]
    const value = {
      id: randomUUID(),
      projectPath: path,
      workspaceId: randomUUID(),
      cols: 80,
      rows: 24,
      cwd: '/forged',
      workspaceKind: 'git-worktree',
      worktreeId: randomUUID(),
      repoCommonDir: '/forged/.git',
    }
    for (const channel of [
      'git:status',
      'git:diff',
      'git:mutate',
      'git:branch-snapshot',
      'git:history',
      'git:compare',
    ]) {
      expect(
        await mocks.handlers.get(channel)!({ ...event, senderFrame: {} }, value),
      ).toMatchObject({ ok: false })
    }
    expect(mocks.gitStatus).not.toHaveBeenCalled()
    expect(mocks.gitDiff).not.toHaveBeenCalled()
    expect(mocks.gitMutate).not.toHaveBeenCalled()
    expect(mocks.gitReferences).not.toHaveBeenCalled()
    expect(mocks.gitHistory).not.toHaveBeenCalled()
    expect(mocks.gitCompare).not.toHaveBeenCalled()
    await mocks.handlers.get('git:status')!(event, value)
    expect(mocks.gitStatus).toHaveBeenCalledExactlyOnceWith(path, true)
    const file = { path: 'file.txt', area: 'unstaged' }
    await mocks.handlers.get('git:diff')!(event, value, file)
    expect(mocks.gitDiff).toHaveBeenCalledExactlyOnceWith(path, file)
    const mutation = { ...value, action: 'stage', files: [file] }
    await mocks.handlers.get('git:mutate')!(event, mutation)
    expect(mocks.gitMutate).toHaveBeenCalledExactlyOnceWith(path, mutation, expect.any(Function))
    await mocks.handlers.get('git:branch-snapshot')!(event, value, randomUUID())
    expect(mocks.gitReferences).toHaveBeenCalledExactlyOnceWith(path)
    const historyRequest = { head: 'a'.repeat(40), offset: 50 }
    await mocks.handlers.get('git:history')!(event, value, historyRequest)
    expect(mocks.gitHistory).toHaveBeenCalledExactlyOnceWith(path, historyRequest)
    const compareRequest = { kind: 'branch', ref: 'refs/heads/main' }
    await mocks.handlers.get('git:compare')!(event, value, compareRequest)
    expect(mocks.gitCompare).toHaveBeenCalledExactlyOnceWith(path, compareRequest)
  })

  it('preserves structured partial-success diagnostics without exposing command stderr or cause', async () => {
    const details = {
      operationId: 'test-operation',
      path: '/tmp/managed',
      gitState: 'created' as const,
    }
    mocks.createWorktree.mockRejectedValueOnce(
      Object.assign(new WorktreeError('CONFIG_PERSIST_FAILED', '登记保存失败', details), {
        cause: new Error('private command output'),
      }),
    )
    mocks.contents.mainFrame.url = 'http://localhost:5173/#/settings'
    const input = { projectPath: path, name: 'Feature', branchName: 'feature', baseRef: 'main' }
    expect(await mocks.handlers.get('git:create-worktree')!(event, input)).toEqual({
      ok: false,
      error: '登记保存失败',
      code: 'CONFIG_PERSIST_FAILED',
      details,
    })
    expect(mocks.createWorktree).toHaveBeenCalledExactlyOnceWith(input)
  })
})
