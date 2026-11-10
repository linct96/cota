import { api } from '../workspace/workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'
import type { GitStatus } from '../../../src/shared/source-control'
import type { HostingContext } from '../../../src/shared/code-hosting'

describe('Workspace hosting context', () => {
  it('stores workspace hosting context and ignores stale or removed workspace reads', async () => {
    const scm = useSourceControl.getState()
    const target = { projectPath: '/tmp/repo', workspaceId: 'hosting-workspace' }
    const session = () => useSourceControl.getState().sessions[target.workspaceId]
    const status: GitStatus = {
      rootPath: target.projectPath,
      branch: 'main',
      head: null,
      ahead: 0,
      behind: 0,
      indexVersion: 'fixture',
      entries: [],
    }
    const repository = { provider: 'gitlab' as const, host: 'gitlab.com', path: 'group/repo' }
    const context: HostingContext = {
      remotes: [{ name: 'origin', repository }],
      source: repository,
      target: repository,
      branch: 'main',
      sourceBranch: 'main',
      head: null,
      key: 'fixture',
    }
    const reads: ((value: Result<HostingContext>) => void)[] = []
    vi.mocked(api.codeHosting.context).mockImplementation(
      () => new Promise((resolve) => reads.push(resolve)),
    )
    scm.update(target.workspaceId, { status, draft: 'keep draft' })
    const first = scm.refreshHostingContext(target)
    expect(session()!.hosting).toEqual({ loading: true })
    expect(api.codeHosting.context).toHaveBeenCalledWith(target)
    reads[0]({ ok: true, value: context })
    await first
    expect(session()!.hosting).toEqual({ loading: false, context })
    expect(useSourceControl.getState().sessions['other-workspace']).toBeUndefined()

    scm.update(target.workspaceId, { status: { ...status, ahead: 1 } })
    expect(session()!.hosting?.context).toBe(context)
    const old = scm.refreshHostingContext(target)
    expect(session()!.hosting).toEqual({ loading: true, context })
    const latest = scm.refreshHostingContext(target)
    const unknown = { ...context, source: null, target: null, reason: '无法识别' }
    reads[2]({ ok: true, value: unknown })
    await latest
    reads[1]({ ok: false, error: 'stale failure' })
    await old
    expect(session()!.hosting).toEqual({ loading: false, context: unknown })

    const changed = scm.refreshHostingContext(target)
    scm.update(target.workspaceId, { status: { ...status, branch: 'feature' } })
    reads[3]({ ok: true, value: context })
    await changed
    expect(session()!.hosting).toBeUndefined()
    expect(session()!.draft).toBe('keep draft')

    const failed = scm.refreshHostingContext(target)
    reads[4]({ ok: false, error: '读取失败' })
    await failed
    expect(session()!.hosting).toEqual({ loading: false, error: '读取失败' })
    const retry = scm.refreshHostingContext(target)
    reads[5]({ ok: true, value: context })
    await retry
    expect(session()!.hosting).toEqual({ loading: false, context })

    const unchanged = scm.refreshHostingContext(target)
    reads[6]({ ok: true, value: structuredClone(context) })
    await unchanged
    expect(session()!.hosting?.context).toBe(context)

    const removed = scm.refreshHostingContext(target)
    useSourceControl.setState({ sessions: {} })
    reads[7]({ ok: true, value: context })
    await removed
    expect(session()).toBeUndefined()
  })
})
