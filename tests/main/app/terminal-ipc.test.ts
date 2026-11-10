import { event, mocks, path } from './ipc.fixture'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

describe('Terminal IPC trust boundaries', () => {
  it('resolves only the configured Main shell for trusted frames', async () => {
    const defaultShell = mocks.handlers.get('shell:default')!
    expect(await defaultShell({ ...event, senderFrame: {} })).toMatchObject({ ok: false })
    expect(mocks.resolveShell).not.toHaveBeenCalled()
    expect(await defaultShell(event, { shellPath: '/forged' })).toEqual({
      ok: true,
      value: '/bin/bash',
    })
    expect(mocks.resolveShell).toHaveBeenCalledExactlyOnceWith({ shellPath: null })
    mocks.resolveShell.mockRejectedValueOnce(new Error('Shell 不存在或不可执行：/bin/zsh'))
    expect(await defaultShell(event)).toEqual({
      ok: false,
      error: 'Shell 不存在或不可执行：/bin/zsh',
    })
  })
  it('discards forged terminal paths, executables and Agent definitions', async () => {
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
    expect(await mocks.handlers.get('terminal:create')!(event, value)).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenCalledWith(
      {
        id: value.id,
        projectPath: path,
        workspaceId: value.workspaceId,
        cols: 80,
        rows: 24,
        cwd: path,
        workspaceKind: 'local',
        kind: 'shell',
      },
      mocks.config.preferences,
    )
    const launch = { kind: 'agent', provider: 'codex', launchId: randomUUID() }
    expect(
      await mocks.handlers.get('terminal:create')!(event, {
        ...value,
        ...launch,
        executable: '/bin/sh',
        args: ['-c', 'touch nope'],
        env: { COTA_HOST_TOKEN: 'forged' },
        agentCliCache: { entries: [{ provider: 'codex', executable: '/bin/sh' }] },
      }),
    ).toMatchObject({ ok: true })
    expect(mocks.create).toHaveBeenLastCalledWith(
      {
        id: value.id,
        cols: 80,
        rows: 24,
        projectPath: path,
        workspaceId: value.workspaceId,
        cwd: path,
        workspaceKind: 'local',
        ...launch,
        agentCliCache: mocks.config.agentCliCache,
      },
      mocks.config.preferences,
    )
    mocks.create.mockClear()
    for (const provider of ['__proto__', 'sh', 'codex; touch nope'])
      expect(
        await mocks.handlers.get('terminal:create')!(event, { ...value, ...launch, provider }),
      ).toMatchObject({ ok: false })
    expect(
      await mocks.handlers.get('agent:cli-read')!({ ...event, senderFrame: {} }),
    ).toMatchObject({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
