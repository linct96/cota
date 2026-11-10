import { event, mocks, path } from './ipc.fixture'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

describe('Agent IPC revision and visibility validation', () => {
  it('rejects untrusted frames, malformed revisions and invalid terminal identities', async () => {
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
    const launch = { kind: 'agent', provider: 'codex', launchId: randomUUID() }
    expect(await mocks.handlers.get('agent:read')!(event, value.id, launch.launchId, 7)).toEqual({
      ok: true,
    })
    expect(mocks.readAgent).toHaveBeenCalledExactlyOnceWith(value.id, launch.launchId, 7)
    for (const revision of [-1, 0.5, '7', Number.MAX_SAFE_INTEGER + 1])
      expect(
        await mocks.handlers.get('agent:read')!(event, value.id, launch.launchId, revision),
      ).toMatchObject({ ok: false })
    expect(
      await mocks.handlers.get('agent:read')!(
        { ...event, senderFrame: {} },
        value.id,
        launch.launchId,
        7,
      ),
    ).toMatchObject({ ok: false })
    expect(mocks.readAgent).toHaveBeenCalledOnce()
    expect(
      await mocks.handlers.get('agent:visible')!({ ...event, senderFrame: {} }, value.id),
    ).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('agent:visible')!(event, 'invalid')).toMatchObject({
      ok: false,
    })
  })
})
