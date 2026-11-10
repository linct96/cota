import { event, extra, mocks, path, remove, target } from './ipc.fixture'
import { describe, expect, it } from 'vitest'

describe('Workspace and project removal IPC', () => {
  it('keeps live Host projects discoverable even after recent-project eviction', async () => {
    const session = {
      id: target.workspaceId,
      workspaceId: target.workspaceId,
      projectPath: path,
      cols: 80,
      rows: 24,
      exited: false,
    }
    const latest = { ...session, exited: true, exitCode: 7 }
    mocks.list
      .mockResolvedValueOnce([session, { ...session, id: extra.workspaceId }])
      .mockResolvedValueOnce([latest, { ...session, id: extra.workspaceId }])
    const result = await mocks.handlers.get('app:bootstrap')!(event)
    expect(result).toEqual({
      ok: true,
      value: {
        config: { ...mocks.config, recentProjects: [path] },
        sessions: [latest, { ...session, id: extra.workspaceId }],
        warning: undefined,
        worktreeScans: { [path]: await mocks.scanWorktrees() },
      },
    })
    expect(mocks.remember).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.setScrollback).toHaveBeenCalledExactlyOnceWith(5000)
  })

  it('closes all project workspaces before forgetting the project', async () => {
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: true,
    })
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.forget.mock.invocationCallOrder[0],
    )
    expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(path)
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('blocks project and workspace deletion and terminal creation until project cleanup finishes', async () => {
    let finish!: () => void
    mocks.closeProject.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const pending = mocks.handlers.get('project:remove')!(event, path)
    expect(await remove()).toEqual({ ok: true, value: false })
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: false,
    })
    expect(await mocks.handlers.get('terminal:create')!(event, extra)).toMatchObject({ ok: false })
    expect(mocks.forget).not.toHaveBeenCalled()
    finish()
    expect(await pending).toEqual({ ok: true, value: true })
  })

  it('retains project records when project cleanup fails and allows retry', async () => {
    mocks.closeProject.mockRejectedValueOnce(new Error('permission denied'))
    expect(await mocks.handlers.get('project:remove')!(event, path)).toMatchObject({
      ok: false,
      error: expect.stringContaining('项目仍保留'),
    })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('project:remove')!(event, path)).toEqual({
      ok: true,
      value: true,
    })
  })

  it.each(['../relative', null])(
    'validates project deletion paths before cleanup: %j',
    async (value) => {
      expect(await mocks.handlers.get('project:remove')!(event, value)).toMatchObject({ ok: false })
      expect(mocks.closeProject).not.toHaveBeenCalled()
      expect(mocks.forget).not.toHaveBeenCalled()
    },
  )

  it('closes only the requested workspace without forgetting its project', async () => {
    expect(await remove()).toEqual({ ok: true, value: true })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.closeWorkspace).toHaveBeenCalledExactlyOnceWith({
      projectPath: target.projectPath,
      workspaceId: target.workspaceId,
    })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(mocks.closeProject).not.toHaveBeenCalled()
  })

  it('forgets the project only after closing its last workspace', async () => {
    expect(await remove({ ...target, removeProject: true })).toEqual({ ok: true, value: true })
    expect(mocks.closeWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.forget.mock.invocationCallOrder[0],
    )
    expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('retains the last workspace when project persistence fails and allows retry', async () => {
    mocks.forget.mockRejectedValueOnce(new Error('disk full'))
    expect(await remove({ ...target, removeProject: true })).toEqual({
      ok: false,
      error: expect.stringContaining('工作区仍保留'),
    })
    expect(await remove({ ...target, removeProject: true })).toEqual({ ok: true, value: true })
  })

  it('retains the workspace when process cleanup fails and allows retry', async () => {
    mocks.closeWorkspace.mockRejectedValueOnce(new Error('permission denied'))
    expect(await remove()).toEqual({ ok: false, error: expect.stringContaining('工作区仍保留') })
    expect(mocks.forget).not.toHaveBeenCalled()
    expect(await remove()).toEqual({ ok: true, value: true })
  })

  it('blocks duplicate deletion and creates in that workspace, but permits sibling workspaces', async () => {
    let finish!: () => void
    mocks.closeWorkspace.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const pending = remove()
    expect(await remove()).toEqual({ ok: true, value: false })
    const create = mocks.handlers.get('terminal:create')!
    expect(await create(event, target)).toEqual({
      ok: false,
      error: expect.stringContaining('正在删除'),
    })
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.gitStatus.mockResolvedValueOnce({ files: [] })
    expect(await mocks.handlers.get('git:status')!(event, extra)).toEqual({
      ok: true,
      value: { files: [] },
    })
    expect(await mocks.handlers.get('git:mutate')!(event, extra)).toMatchObject({
      ok: false,
      error: expect.stringContaining('正在关闭'),
    })
    expect(await create(event, extra)).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenCalledOnce()
    finish()
    expect(await pending).toEqual({ ok: true, value: true })
  })

  it.each([
    null,
    { projectPath: '../relative', workspaceId: path },
    { projectPath: path },
    { projectPath: path, workspaceId: '../other' },
  ])('rejects malformed targets before ending terminals: %j', async (value) => {
    expect(await remove(value)).toMatchObject({ ok: false })
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.forget).not.toHaveBeenCalled()
  })

  it('rejects invalid project-removal flags before ending terminals', async () => {
    expect(await remove({ ...target, removeProject: 'true' })).toMatchObject({ ok: false })
    expect(await remove({ projectPath: path, workspaceId: target.workspaceId })).toMatchObject({
      ok: false,
    })
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
    expect(mocks.forget).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders before ending terminals', async () => {
    expect(await mocks.handlers.get('workspace:remove')!({ ...event, sender: {} }, target)).toEqual(
      {
        ok: false,
        error: '拒绝未授权的窗口请求。',
      },
    )
    expect(mocks.closeWorkspace).not.toHaveBeenCalled()
  })
})
