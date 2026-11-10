import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { CreateWorktreeResult, Result, WorktreeScan } from '../../../src/shared/contracts'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { currentWorkspace, useWorkspace } from '../../../src/renderer/src/state/workspace'
import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'

import { managedWorktree, scanFor } from './worktree.fixture'

describe('Worktree transactions and recovery', () => {
  it('adopts only Main success once, prevents duplicate submission and retains Worktree after Shell failure', async () => {
    await useWorkspace.getState().bootstrap()
    const value = managedWorktree()
    const input = {
      projectPath: value.record.projectPath,
      name: 'My work',
      branchName: 'feature',
      baseRef: 'HEAD',
      planId: value.record.id,
    }
    let finish!: (result: Result<CreateWorktreeResult>) => void
    vi.mocked(api.createGitWorktree).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    vi.mocked(api.scanWorktrees).mockResolvedValue({ ok: true, value: scanFor(value) })
    const creating = useWorkspace.getState().createGitWorktree(input)
    await expect(useWorkspace.getState().createGitWorktree(input)).rejects.toThrow(
      '另一个 Worktree',
    )
    expect(useWorkspace.getState().workspaces).toEqual([])
    await vi.waitFor(() => expect(api.createGitWorktree).toHaveBeenCalledOnce())
    finish({ ok: true, value })
    expect(await creating).toEqual(value)
    const state = useWorkspace.getState()
    expect(state.workspaces).toEqual([value.workspace])
    expect(state.worktreeRecords).toEqual([value.record])
    expect(currentWorkspace(state)).toEqual(value.workspace)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      workspaceId: value.workspace.id,
      cwd: value.record.path,
      status: 'starting',
    })
    state.updateTab(state.tabs[0].id, { status: 'error', error: 'Shell startup failed' })
    expect(useWorkspace.getState().worktreeRecords).toEqual([value.record])
    expect(api.removeGitWorktree).not.toHaveBeenCalled()
    state.newTerminal()
    expect(useWorkspace.getState().tabs).toHaveLength(2)
    expect(useWorkspace.getState().tabs[1].cwd).toBe(value.record.path)
    const tab = useWorkspace.getState().tabs[1]
    state.updateTab(tab.id, { status: 'running' })
    await state.closeTab(tab.id)
    const history = useSourceControl.getState().sessions[value.workspace.id]!.closedTabs
    const scan = scanFor(value)
    scan.entries[0].status = 'missing'
    useWorkspace.setState({ worktreeScans: { [value.record.projectPath]: scan } })
    state.shortcut('reopen-tab')
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useSourceControl.getState().sessions[value.workspace.id]!.closedTabs).toBe(history)
    scan.entries[0].status = 'ready'
    state.shortcut('reopen-tab')
    expect(useWorkspace.getState().tabs[1]).toMatchObject({
      workspaceId: value.workspace.id,
      cwd: value.record.path,
      status: 'starting',
    })
    expect(useWorkspace.getState().tabs[1].id).not.toBe(tab.id)
  })

  it('keeps selection, tabs and workspace unchanged on partial create failure', async () => {
    await useWorkspace.getState().bootstrap()
    const before = useWorkspace.getState()
    vi.mocked(api.createGitWorktree).mockResolvedValueOnce({
      ok: false,
      error: '登记写入失败',
      code: 'CONFIG_PERSIST_FAILED',
      details: { path: '/tmp/preserved', gitState: 'created', operationId: 'operation' },
    })
    await expect(
      before.createGitWorktree({
        projectPath: '/tmp/project',
        name: 'n',
        branchName: 'feature',
        baseRef: 'HEAD',
        planId: 'p',
      }),
    ).rejects.toThrow('/tmp/preserved')
    expect(useWorkspace.getState()).toMatchObject({
      selectedProject: before.selectedProject,
      workspaces: before.workspaces,
      tabs: before.tabs,
      worktreeRecords: before.worktreeRecords,
      creatingWorktree: false,
    })
    expect(api.removeGitWorktree).not.toHaveBeenCalled()
  })

  it('retains identity-mismatched and unregistered Host sessions as diagnostics, never inventing local bindings', async () => {
    const value = managedWorktree()
    const session = {
      id: crypto.randomUUID(),
      projectPath: value.record.projectPath,
      workspaceId: value.workspace.id,
      cwd: value.record.path,
      workspaceKind: 'git-worktree' as const,
      worktreeId: value.record.id,
      repoCommonDir: value.record.repoCommonDir,
      cols: 80,
      rows: 24,
      exited: false,
    }
    const orphan = {
      ...session,
      id: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    }
    const mismatch = { ...session, id: crypto.randomUUID(), cwd: '/tmp/wrong' }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [session.projectPath],
          worktreeRecords: [value.record],
          layout: {
            workspaces: [value.workspace],
            tabs: [],
            selectedWorkspaces: {},
            activeTabs: {},
          },
        },
        sessions: [session, orphan, mismatch],
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState().tabs).toMatchObject([{ id: session.id, status: 'running' }])
    expect(useWorkspace.getState().orphanSessions).toEqual([orphan, mismatch])
    expect(useWorkspace.getState().workspaces).toEqual([value.workspace])
    expect(api.createTerminal).not.toHaveBeenCalled()
  })

  it('preserves last branch and external list on unavailable queries and ignores stale responses', async () => {
    const value = managedWorktree()
    const good = scanFor(value)
    good.external = [{ ...value.worktree, path: '/tmp/external', managedByCota: false }]
    useWorkspace.setState({
      worktreeRecords: [value.record],
      worktreeScans: { [value.record.projectPath]: good },
    })
    vi.mocked(api.scanWorktrees).mockResolvedValueOnce({
      ok: true,
      value: {
        ...good,
        error: 'Git timeout',
        external: [],
        entries: [{ record: value.record, status: 'unavailable', error: 'Git timeout' }],
      },
    })
    await useWorkspace.getState().refreshWorktrees(value.record.projectPath)
    expect(useWorkspace.getState().worktreeScans[value.record.projectPath]).toMatchObject({
      external: good.external,
      entries: [{ status: 'unavailable', worktree: value.worktree }],
    })
    let old!: (result: Result<WorktreeScan>) => void
    vi.mocked(api.scanWorktrees).mockReturnValueOnce(
      new Promise((resolve) => {
        old = resolve
      }),
    )
    const waiting = useWorkspace.getState().refreshWorktrees(value.record.projectPath)
    const latest = scanFor({ ...value, worktree: { ...value.worktree, branch: null } })
    vi.mocked(api.scanWorktrees).mockResolvedValueOnce({ ok: true, value: latest })
    await useWorkspace.getState().refreshWorktrees(value.record.projectPath)
    old({ ok: true, value: good })
    await waiting
    expect(
      useWorkspace.getState().worktreeScans[value.record.projectPath]!.entries[0].worktree?.branch,
    ).toBeNull()
  })

  it('keeps metadata on cancellation or deletion failure; only confirmed success removes it', async () => {
    const value = managedWorktree()
    const local = {
      id: crypto.randomUUID(),
      projectPath: value.record.projectPath,
      name: '工作区',
      kind: 'local' as const,
    }
    useWorkspace.setState({
      workspaces: [local, value.workspace],
      worktreeRecords: [value.record],
      projects: [value.record.projectPath],
      selectedProject: value.record.projectPath,
      selectedWorkspaces: { [value.record.projectPath]: value.workspace.id },
    })
    vi.mocked(api.scanWorktrees).mockResolvedValue({ ok: true, value: scanFor(value) })
    vi.mocked(api.removeGitWorktree).mockResolvedValueOnce({
      ok: true,
      value: { removed: false, cancelled: true, operationId: 'cancelled' },
    })
    expect(await useWorkspace.getState().removeWorkspace(value.workspace.id)).toBe(false)
    expect(useWorkspace.getState().workspaces).toEqual([local, value.workspace])
    expect(currentWorkspace(useWorkspace.getState())).toEqual(value.workspace)
    vi.mocked(api.removeGitWorktree).mockResolvedValueOnce({ ok: false, error: 'still dirty' })
    expect(await useWorkspace.getState().removeWorkspace(value.workspace.id)).toBe(false)
    expect(useWorkspace.getState().worktreeRecords).toEqual([value.record])
    expect(useWorkspace.getState().worktreeError).toBe('still dirty')
    expect(currentWorkspace(useWorkspace.getState())).toEqual(value.workspace)
    vi.mocked(api.removeGitWorktree).mockResolvedValueOnce({
      ok: true,
      value: { removed: true, operationId: 'removed' },
    })
    expect(await useWorkspace.getState().removeWorkspace(value.workspace.id)).toBe(true)
    expect(api.removeGitWorktree).toHaveBeenLastCalledWith(value.record.id, true)
    expect(api.removeWorkspace).not.toHaveBeenCalled()
    expect(useWorkspace.getState()).toMatchObject({
      workspaces: [local],
      worktreeRecords: [],
      selectedProject: undefined,
      selectedWorkspaces: {},
      worktreeError: undefined,
      removingWorkspace: undefined,
    })
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
  })
})
