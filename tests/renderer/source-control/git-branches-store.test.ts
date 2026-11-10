import { describe, expect, it, vi } from 'vitest'
import {
  refreshGitBranches,
  retainGitBranches,
  useGitBranchesStore,
} from '../../../src/renderer/src/state/git-branches-store'

describe('Git branch subscriptions', () => {
  it('retains branch display on refresh failure and discards responses after unsubscribe', async () => {
    const target = { projectPath: '/tmp/project', workspaceId: 'branch-store' }
    const snapshot = {
      repositoryId: 'repo',
      revision: 0,
      fetchedAt: 1,
      branches: [],
      remoteHeads: [],
    }
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { snapshot, remotes: ['origin'], stale: false } })
    const release = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const unwatch = vi.fn()
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      desktop: {
        gitBranches: request,
        releaseGitBranches: release,
        onGitBranchesChanged: vi.fn(() => unwatch),
      },
    })
    let stop: (() => void) | undefined
    try {
      stop = retainGitBranches(target)
      await vi.waitFor(() =>
        expect(useGitBranchesStore.getState().repositories.repo).toEqual(snapshot),
      )
      request.mockResolvedValueOnce({ ok: false, error: 'read failed' })
      await refreshGitBranches(target)
      expect(Object.values(useGitBranchesStore.getState().workspaces)[0]).toMatchObject({
        error: 'read failed',
        stale: true,
      })
      expect(useGitBranchesStore.getState().repositories.repo).toEqual(snapshot)
      let finish!: (value: unknown) => void
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = refreshGitBranches(target)
      stop()
      stop = undefined
      finish({
        ok: true,
        value: { snapshot: { ...snapshot, revision: 1 }, remotes: [], stale: false },
      })
      await pending
      expect(useGitBranchesStore.getState()).toEqual({ repositories: {}, workspaces: {} })
      expect(release).toHaveBeenCalledTimes(1)
      expect(unwatch).toHaveBeenCalledTimes(1)
    } finally {
      stop?.()
      vi.unstubAllGlobals()
    }
  })
})
