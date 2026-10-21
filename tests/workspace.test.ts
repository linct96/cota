import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopAPI,
  Result,
  CreateWorktreeResult,
  WorktreeScan,
} from '../src/shared/contracts'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import { currentWorkspace, nextWorkspaceName, useWorkspace } from '../src/renderer/src/store'
import { WebglAddon } from '@xterm/addon-webgl'
import { createTerminalRenderer } from '../src/renderer/src/lib/terminal-renderer'
import { useSourceControl } from '../src/renderer/src/lib/source-control-store'
import { useRightPanel } from '../src/renderer/src/lib/right-panel-store'
import {
  agentIndicatorState,
  agentTabState,
  workspaceAgentSummary,
} from '../src/renderer/src/lib/agent-status'

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(
    class {
      dispose = vi.fn()
      onContextLoss = vi.fn((_listener: () => void) => ({ dispose: vi.fn() }))
    },
  ),
}))

let api: DesktopAPI
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  useSourceControl.setState(useSourceControl.getInitialState(), true)
  useRightPanel.setState(useRightPanel.getInitialState(), true)
  api = {
    bootstrap: vi.fn().mockResolvedValue({
      ok: true,
      value: { config: structuredClone(DEFAULT_CONFIG), sessions: [] },
    }),
    saveLayout: vi.fn().mockResolvedValue({ ok: true }),
    openProject: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/中文 项目' }),
    selectProject: vi.fn().mockResolvedValue({ ok: true }),
    projectBranch: vi.fn().mockResolvedValue({ ok: true, value: null }),
    inspectRepository: vi.fn(),
    listWorktrees: vi.fn(),
    gitStatus: vi.fn(),
    gitDiff: vi.fn(),
    gitMutate: vi.fn(),
    gitReferences: vi.fn(),
    gitHistory: vi.fn(),
    gitCompare: vi.fn(),
    createGitWorktree: vi.fn(),
    planGitWorktree: vi.fn(),
    workspacePath: vi.fn(),
    worktreeBranches: vi.fn(),
    suggestWorktreeName: vi.fn(),
    scanWorktrees: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        repository: { status: 'nonGit', projectPath: '/tmp/project', error: '非 Git 目录' },
        entries: [],
        external: [],
      },
    }),
    linkGitWorktree: vi.fn(),
    inspectWorktreeRemoval: vi.fn(),
    removeGitWorktree: vi.fn(),
    unlinkGitWorktree: vi.fn(),
    openWorkspaceWith: vi.fn().mockResolvedValue({ ok: true }),
    removeWorkspace: vi.fn().mockResolvedValue({ ok: true, value: true }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, value: true }),
    getDefaultShell: vi.fn().mockResolvedValue({ ok: true, value: '/bin/zsh' }),
    savePreferences: vi.fn(async (value) => ({ ok: true as const, value })),
    closeTerminal: vi.fn().mockResolvedValue({ ok: true, value: true }),
    closeWindow: vi.fn(),
    respondToConfirmation: vi.fn().mockResolvedValue({ ok: true }),
    onConfirmation: vi.fn(() => vi.fn()),
    onShortcut: vi.fn(() => vi.fn()),
    onTerminal: vi.fn(() => vi.fn()),
    detectAgents: vi.fn(),
    detectAgentHooks: vi.fn(),
    installAgentHook: vi.fn(),
    uninstallAgentHook: vi.fn(),
    readAgent: vi.fn().mockResolvedValue({ ok: true }),
    setVisibleTerminal: vi.fn().mockResolvedValue({ ok: true }),
    onAgentFocus: vi.fn(() => vi.fn()),
    onAgent: vi.fn(() => vi.fn()),
    createTerminal: vi.fn(),
    attachTerminal: vi.fn(),
    detachTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    acknowledge: vi.fn(),
  }
  vi.stubGlobal('window', { desktop: api })
})
afterEach(() => vi.unstubAllGlobals())

function managedWorktree(): CreateWorktreeResult {
  const id = crypto.randomUUID()
  const record = {
    id,
    projectPath: '/tmp/project',
    path: `/tmp/worktrees/${id}`,
    repoCommonDir: '/tmp/project/.git',
    repoId: 'a'.repeat(24),
    origin: 'created' as const,
    registeredAt: new Date().toISOString(),
    initialBranch: 'feature',
  }
  return {
    record,
    workspace: {
      id: crypto.randomUUID(),
      projectPath: record.projectPath,
      name: 'My work',
      kind: 'git-worktree',
      worktreeId: id,
    },
    worktree: {
      path: record.path,
      branch: 'feature',
      head: 'a'.repeat(40),
      isMain: false,
      isBare: false,
      locked: false,
      prunable: false,
      managedByCota: true,
      worktreeId: id,
    },
  }
}
function scanFor(value: CreateWorktreeResult): WorktreeScan {
  return {
    repository: {
      status: 'ready',
      projectPath: value.record.projectPath,
      rootPath: value.record.projectPath,
      repoCommonDir: value.record.repoCommonDir,
      isBare: false,
    },
    entries: [{ record: value.record, worktree: value.worktree, status: 'ready' }],
    external: [],
  }
}
describe('Worktree state transactions and recovery', () => {
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
    await creating
    const state = useWorkspace.getState()
    expect(state.workspaces).toEqual([value.workspace])
    expect(state.worktreeRecords).toEqual([value.record])
    expect(currentWorkspace(state)).toEqual(value.workspace)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({ workspaceId: value.workspace.id, status: 'starting' })
    state.updateTab(state.tabs[0].id, { status: 'error', error: 'Shell startup failed' })
    expect(useWorkspace.getState().worktreeRecords).toEqual([value.record])
    expect(api.removeGitWorktree).not.toHaveBeenCalled()
    state.newTerminal()
    expect(useWorkspace.getState().tabs).toHaveLength(2)
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
      useWorkspace.getState().worktreeScans[value.record.projectPath].entries[0].worktree?.branch,
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

describe('workspace state', () => {
  it('updates preferences with the saved result only after success', async () => {
    const terminal = { loadAddon: vi.fn(), refresh: vi.fn(), rows: 24 }
    const fit = { fit: vi.fn() }
    const renderer = createTerminalRenderer(terminal, fit)
    renderer.update(useWorkspace.getState().preferences.terminalGpuAcceleration, false)
    expect(terminal.loadAddon).not.toHaveBeenCalled()
    const value = {
      ...DEFAULT_CONFIG.preferences,
      shellPath: '/bin/bash',
      scrollback: 1000,
      terminalGpuAcceleration: 'on' as const,
    }
    const saved = { ...value, scrollback: 2000 }
    let finish!: (result: Result<typeof value>) => void
    vi.mocked(api.savePreferences).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const saving = useWorkspace.getState().savePreferences(value)
    expect(api.savePreferences).toHaveBeenCalledExactlyOnceWith(value)
    expect(useWorkspace.getState().preferences).toEqual(DEFAULT_CONFIG.preferences)
    finish({ ok: true, value: saved })
    await saving
    expect(useWorkspace.getState().preferences).toEqual(saved)
    renderer.update(useWorkspace.getState().preferences.terminalGpuAcceleration, true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    const first = vi.mocked(WebglAddon).mock.instances.at(-1)!
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    renderer.update('on', false)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(vi.mocked(first.onContextLoss).mock.results[0].value.dispose).toHaveBeenCalledOnce()

    renderer.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    const automatic = vi.mocked(WebglAddon).mock.instances.at(-1)!
    vi.mocked(automatic.onContextLoss).mock.calls[0][0]()
    expect(automatic.dispose).toHaveBeenCalledOnce()
    expect(terminal.refresh).toHaveBeenLastCalledWith(0, 23)
    renderer.update('auto', false)
    renderer.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    const other = createTerminalRenderer(terminal, fit)
    other.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    other.dispose()

    terminal.loadAddon.mockImplementationOnce(() => {
      throw new Error('WebGL2 not supported')
    })
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    expect(vi.mocked(WebglAddon).mock.instances.at(-1)!.dispose).toHaveBeenCalledOnce()
    renderer.update('on', false)
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    renderer.update('off', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(4)
    const last = vi.mocked(WebglAddon).mock.instances.at(-1)!
    renderer.dispose()
    renderer.update('on', true)
    expect(last.dispose).toHaveBeenCalledOnce()
    expect(terminal.loadAddon).toHaveBeenCalledTimes(4)
  })

  it('preserves preferences after a failed save, allowing retry', async () => {
    const value = {
      ...DEFAULT_CONFIG.preferences,
      shellPath: '/bin/bash',
      scrollback: 1000,
      terminalGpuAcceleration: 'off' as const,
    }
    const before = useWorkspace.getState().preferences
    vi.mocked(api.savePreferences).mockResolvedValueOnce({ ok: false, error: '保存失败' })
    await expect(useWorkspace.getState().savePreferences(value)).rejects.toThrow('保存失败')
    expect(useWorkspace.getState().preferences).toEqual(before)
    await useWorkspace.getState().savePreferences(value)
    expect(useWorkspace.getState().preferences).toEqual(value)
  })

  it('loads recent workspaces without selection and creates a terminal only after selection', async () => {
    const store = () => useWorkspace.getState()
    const paths = ['/tmp/中文 项目', '/tmp/other']
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: { ...structuredClone(DEFAULT_CONFIG), recentProjects: paths },
        sessions: [],
      },
    })
    await store().bootstrap()
    expect(store()).toMatchObject({ ready: true, projects: paths, tabs: [] })
    expect(currentWorkspace(store())).toBeUndefined()
    const workspace = store().workspaces[1]
    expect(await store().selectProject(workspace.projectPath, workspace.id)).toBe(true)
    expect(currentWorkspace(store())?.id).toBe(workspace.id)
    expect(store().tabs).toHaveLength(1)
    expect(store().tabs[0]).toMatchObject({ workspaceId: workspace.id, status: 'starting' })
  })

  it('activates the last workspace and active tab only when its Host sessions still exist', async () => {
    const path = '/tmp/project'
    const workspace = {
      id: crypto.randomUUID(),
      projectPath: path,
      name: 'Agent 实验',
      kind: 'local' as const,
    }
    const live = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      projectPath: path,
      title: 'Codex',
      kind: 'agent' as const,
      provider: 'codex' as const,
      cwd: path,
      workspaceKind: 'local' as const,
    }
    const agent = {
      terminalId: live.id,
      projectPath: path,
      workspaceId: workspace.id,
      cwd: path,
      revision: 2,
      unread: false,
      launchId: crypto.randomUUID(),
      provider: 'codex' as const,
      runtimeState: 'running' as const,
      activityState: 'unknown' as const,
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventSource: 'process' as const,
      observability: 'unavailable' as const,
    }
    const other = {
      ...live,
      id: crypto.randomUUID(),
      title: 'Shell',
      kind: 'shell' as const,
      provider: undefined,
    }
    const lost = { ...live, id: crypto.randomUUID() }
    const orphan = {
      ...other,
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      cols: 80,
      rows: 24,
      exited: true,
      exitCode: 7,
    }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [path],
          layout: {
            workspaces: [workspace],
            tabs: [other, live, lost],
            selectedProject: path,
            selectedWorkspaces: { [path]: workspace.id },
            activeTabs: { [workspace.id]: live.id },
          },
        },
        sessions: [other, live]
          .map((tab) => ({
            ...tab,
            cols: 80,
            rows: 24,
            exited: false,
            ...(tab.id === live.id ? { agent } : {}),
          }))
          .concat(orphan),
      },
    })
    const buffered = { ...agent, revision: 3, activityState: 'working' as const }
    useWorkspace.getState().receiveAgent({ type: 'state', session: buffered })
    await useWorkspace.getState().bootstrap()
    expect(currentWorkspace(useWorkspace.getState())).toEqual(workspace)
    expect(useWorkspace.getState().activeTabs[workspace.id]).toBe(live.id)
    expect(useWorkspace.getState().tabs).toEqual([
      expect.objectContaining({ id: other.id, title: 'Shell', status: 'running' }),
      expect.objectContaining({
        id: live.id,
        title: 'Codex',
        kind: 'agent',
        provider: 'codex',
        status: 'running',
        launchId: agent.launchId,
        agent: buffered,
      }),
      expect.objectContaining({ id: orphan.id, status: 'exited', exitCode: 7 }),
    ])
    expect(useWorkspace.getState().workspaces.some((item) => item.id === orphan.workspaceId)).toBe(
      true,
    )
    expect(api.createTerminal).not.toHaveBeenCalled()
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedProject: path,
        tabs: [
          expect.objectContaining({ id: other.id }),
          expect.objectContaining({ id: live.id }),
          expect.objectContaining({ id: orphan.id }),
        ],
      }),
    )
    const store = () => useWorkspace.getState()
    const completion = {
      ...buffered,
      revision: 4,
      activityState: 'completed' as const,
      unread: true,
    }
    const focus = store().focusVersion
    store().receiveAgent({ type: 'state', session: completion })
    expect(api.readAgent).not.toHaveBeenCalled()
    expect(store().focusVersion).toBe(focus)
    expect(store().activeTabs[workspace.id]).toBe(live.id)
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'completed',
      count: 1,
      description: '1 个本轮结束',
    })
    expect(workspaceAgentSummary([store().tabs[0]])).toBeUndefined()
    for (const status of ['starting', 'running', 'error', 'exited'] as const) {
      expect(workspaceAgentSummary([{ ...store().tabs[1], agent: undefined, status }])?.state).toBe(
        status === 'error' ? 'error' : 'other',
      )
    }
    for (const runtimeState of ['starting', 'stopping', 'exited'] as const) {
      expect(
        agentIndicatorState({ ...store().tabs[1], agent: { ...completion, runtimeState } }),
      ).toBe('other')
    }
    for (const activityState of ['idle', 'unknown'] as const) {
      expect(
        agentIndicatorState({ ...store().tabs[1], agent: { ...completion, activityState } }),
      ).toBe('other')
    }
    expect(agentTabState({ ...store().tabs[1], closingStatus: 'running' })).toBe('other')
    expect(agentTabState(store().tabs[1])).toBe('completed')
    const failed = {
      ...store().tabs[1],
      agent: { ...completion, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    expect(workspaceAgentSummary([failed])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败',
    })
    const working = { ...failed, agent: buffered }
    expect(workspaceAgentSummary([working, failed, working])).toEqual({
      state: 'failed',
      count: 1,
      description: '1 个执行失败 · 2 个执行中',
    })
    expect(
      workspaceAgentSummary([{ ...failed, agent: { ...failed.agent, unread: false } }]),
    ).toEqual({ state: 'other', count: 1, description: '1 个其他状态' })
    const succeeded = { ...store().tabs[1], agent: { ...completion, outcome: 'success' as const } }
    expect(agentTabState(succeeded)).toBe('succeeded')
    expect(workspaceAgentSummary([succeeded])).toEqual({
      state: 'succeeded',
      count: 1,
      description: '1 个已完成',
    })
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(5000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(1000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(undefined)
      vi.advanceTimersByTime(5000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(1000)
      store().selectTab(other.id)
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().selectTab(live.id)
      vi.advanceTimersByTime(1999)
      expect(api.readAgent).not.toHaveBeenCalled()
      store().updateTab(other.id, { title: 'Shell renamed' })
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenCalledExactlyOnceWith(live.id, agent.launchId, 4)
      expect(store().tabs[1].agent?.unread).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    const read = { ...completion, revision: 5, unread: false }
    store().receiveAgent({ type: 'state', session: read })
    expect(store().tabs[1].agent?.activityState).toBe('completed')
    expect(agentTabState(store().tabs[1])).toBe('completed')
    expect(agentIndicatorState(store().tabs[1])).toBe('other')
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'other',
      count: 1,
      description: '1 个其他状态',
    })
    expect(
      workspaceAgentSummary([{ ...succeeded, agent: { ...succeeded.agent, unread: false } }])
        ?.state,
    ).toBe('other')
    expect(workspaceAgentSummary([working])?.state).toBe('working')
    store().receiveAgent({ type: 'state', session: completion })
    store().receiveAgent({
      type: 'state',
      session: { ...completion, revision: 6, launchId: crypto.randomUUID() },
    })
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 6, cwd: '/wrong' } })
    expect(store().tabs[1].agent).toEqual(read)
    const attention = { ...read, revision: 6, activityState: 'needs-input' as const, unread: true }
    store().setVisibleTerminal(undefined)
    store().receiveAgent({ type: 'state', session: attention })
    expect(workspaceAgentSummary(store().tabs)).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
    expect(workspaceAgentSummary([failed, working, store().tabs[1]])).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理 · 1 个执行失败 · 1 个执行中',
    })
    expect(workspaceAgentSummary([{ ...store().tabs[1], kind: 'shell' }])).toEqual({
      state: 'needs-input',
      count: 1,
      description: '1 个待处理',
    })
    vi.useFakeTimers()
    try {
      store().setVisibleTerminal(live.id)
      const reads = vi.mocked(api.readAgent).mock.calls.length
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
      vi.advanceTimersByTime(1000)
      store().receiveAgent({ type: 'state', session: { ...buffered, revision: 8 } })
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      expect(agentIndicatorState(store().tabs[1])).toBe('working')
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 9 } })
      vi.advanceTimersByTime(1000)
      store().receiveAgent({ type: 'state', session: { ...completion, revision: 10 } })
      vi.advanceTimersByTime(999)
      expect(api.readAgent).toHaveBeenCalledTimes(reads)
      vi.advanceTimersByTime(1)
      expect(api.readAgent).toHaveBeenLastCalledWith(live.id, agent.launchId, 10)
      store().receiveAgent({
        type: 'state',
        session: { ...completion, revision: 11, unread: false },
      })
      store().setVisibleTerminal(undefined)
      store().setVisibleTerminal(live.id)
      vi.advanceTimersByTime(2000)
      expect(api.readAgent).toHaveBeenCalledTimes(reads + 1)
      expect(agentIndicatorState(store().tabs[1])).toBe('other')
    } finally {
      vi.useRealTimers()
    }
    store().receiveAgent({
      type: 'state',
      session: {
        ...attention,
        revision: 12,
        runtimeState: 'stopping',
        activityState: 'unknown',
        unread: false,
      },
    })
    store().updateTab(live.id, { error: '关闭失败：permission denied' })
    store().receiveAgent({
      type: 'state',
      session: {
        ...attention,
        revision: 13,
        runtimeState: 'running',
        activityState: 'unknown',
        observability: 'unavailable',
        unread: false,
      },
    })
    expect(store().tabs[1]).toMatchObject({
      status: 'running',
      error: '关闭失败：permission denied',
    })
    expect(agentTabState(store().tabs[1])).toBe('other')
    const manual = {
      ...agent,
      terminalId: other.id,
      launchId: crypto.randomUUID(),
      revision: 1,
      activityState: 'working' as const,
    }
    store().receiveAgent({ type: 'state', session: manual })
    expect(store().tabs[0]).toMatchObject({ kind: 'shell', status: 'running', agent: manual })
    expect(store().tabs[0].launchId).toBeUndefined()
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(store().tabs[0].agent).toBeUndefined()
    expect(store().tabs[0].status).toBe('running')
    store().receiveAgent({ type: 'state', session: manual })
    expect(store().tabs[0].agent).toBeUndefined()
    const restarted = { ...manual, launchId: crypto.randomUUID(), revision: 3 }
    store().receiveAgent({ type: 'state', session: restarted })
    store().receiveAgent({
      type: 'removed',
      terminalId: other.id,
      launchId: manual.launchId,
      revision: 2,
    })
    expect(store().tabs[0].agent).toEqual(restarted)
    store().updateTab(other.id, { agent: manual })
    expect(store().tabs[0].agent).toEqual(restarted)
    store().receiveAgent({ type: 'disconnected' })
    expect(store().tabs[1].agent).toMatchObject({
      activityState: 'unknown',
      observability: 'unavailable',
      unread: false,
    })
    store().receiveAgent({ type: 'state', session: { ...completion, revision: 7 } })
    expect(store().tabs[1].agent?.activityState).toBe('unknown')
    const saved = vi.mocked(api.saveLayout).mock.calls.at(-1)![0]
    expect(saved.tabs[1]).not.toHaveProperty('agent')
    expect(saved.tabs[1]).not.toHaveProperty('launchId')
  })

  it('does not restart a lost terminal or activate its empty workspace, even with a live sibling', async () => {
    const path = '/tmp/project'
    const workspace = {
      id: crypto.randomUUID(),
      projectPath: path,
      name: '上次工作区',
      kind: 'local' as const,
    }
    const other = { ...workspace, id: crypto.randomUUID(), name: '其他工作区' }
    const lost = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      projectPath: path,
      title: '旧终端',
      kind: 'agent' as const,
      provider: 'pi' as const,
    }
    const session = {
      id: crypto.randomUUID(),
      workspaceId: other.id,
      projectPath: path,
      cwd: path,
      workspaceKind: 'local' as const,
      cols: 80,
      rows: 24,
      exited: false,
    }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [path],
          layout: {
            workspaces: [workspace, other],
            tabs: [lost],
            selectedProject: path,
            selectedWorkspaces: { [path]: workspace.id },
            activeTabs: {},
          },
        },
        sessions: [session],
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
    expect(useWorkspace.getState().tabs).toMatchObject([{ id: session.id }])
    expect(api.createTerminal).not.toHaveBeenCalled()
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [expect.objectContaining({ id: session.id })],
        selectedProject: undefined,
      }),
    )
    await useWorkspace.getState().selectProject(path, workspace.id)
    expect(currentWorkspace(useWorkspace.getState())).toEqual(workspace)
    expect(useWorkspace.getState().tabs).toMatchObject([
      { id: session.id },
      { workspaceId: workspace.id, status: 'starting' },
    ])
  })

  it('does not overwrite the saved layout when bootstrap fails', async () => {
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ok: false, error: 'Host 不可用' })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState()).toMatchObject({ ready: true, layoutLoaded: false })
    expect(console.error).toHaveBeenCalledWith(new Error('Host 不可用'))
    expect(api.saveLayout).not.toHaveBeenCalled()
  })

  it('opens a project with one workspace and terminal, deduplicates concurrent opens and preserves state on cancellation or failure', async () => {
    await useWorkspace.getState().bootstrap()
    await Promise.all([
      useWorkspace.getState().openProject(),
      useWorkspace.getState().openProject(),
    ])
    expect(useWorkspace.getState().projects).toEqual(['/tmp/中文 项目'])
    expect(useWorkspace.getState().workspaces).toHaveLength(1)
    expect(useWorkspace.getState().workspaces[0]).toMatchObject({
      projectPath: '/tmp/中文 项目',
      name: '工作区',
    })
    const state = useWorkspace.getState()
    const workspace = state.workspaces[0]
    expect(currentWorkspace(state)).toEqual(workspace)
    expect(state.tabs).toMatchObject([
      {
        projectPath: workspace.projectPath,
        workspaceId: workspace.id,
        title: 'Terminal 1',
        status: 'starting',
      },
    ])
    expect(state.activeTabs[workspace.id]).toBe(state.tabs[0].id)
    await state.openProject()
    expect(useWorkspace.getState().tabs).toEqual(state.tabs)
    const before = useWorkspace.getState()
    for (const result of [
      { ok: true, value: null },
      { ok: false, error: '目录不可访问' },
    ] as const) {
      vi.mocked(api.openProject).mockResolvedValueOnce(result)
      await before.openProject()
      expect(useWorkspace.getState()).toEqual(before)
    }
  })
  it('appends new projects in insertion order without moving existing projects when selected or reopened', async () => {
    const store = () => useWorkspace.getState()
    const paths = Array.from({ length: 22 }, (_, index) => `/tmp/project-${index}`)
    for (const path of paths) {
      vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: path })
      await store().openProject()
    }
    expect(store().projects).toEqual(paths)
    await store().selectProject(paths[0])
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: paths[0] })
    await store().openProject()
    expect(store().projects).toEqual(paths)
    expect(store().workspaces.map((workspace) => workspace.projectPath)).toEqual(paths)
  })
  it.each([{ removingWorkspace: 'removing' }, { creatingWorktree: true }])(
    'does not add a project if another operation starts while the directory picker is open: %j',
    async (busy) => {
      let finish!: (result: Result<string | null>) => void
      vi.mocked(api.openProject).mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      const opening = useWorkspace.getState().openProject()
      useWorkspace.setState(busy)
      const before = useWorkspace.getState()
      finish({ ok: true, value: '/tmp/project' })
      await opening
      expect(useWorkspace.getState()).toEqual(before)
    },
  )
  it('adds a project workspace without exceeding the terminal limit and starts its terminal after capacity is freed', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    for (let i = store().tabs.length; i < 10; i++) store().newTerminal(i % 2 ? 'pi' : undefined)
    store().newTerminal('codex')
    expect(store().tabs).toHaveLength(10)
    vi.mocked(api.openProject).mockResolvedValue({ ok: true, value: '/tmp/second' })
    await store().openProject()
    const workspace = currentWorkspace(store())!
    expect(workspace).toMatchObject({ projectPath: '/tmp/second', kind: 'local' })
    expect(store().tabs).toHaveLength(10)
    expect(store().tabs.some((tab) => tab.workspaceId === workspace.id)).toBe(false)
    const tab = store().tabs[0]
    store().updateTab(tab.id, { status: 'running' })
    await store().closeTab(tab.id)
    await store().openProject()
    expect(store().workspaces).toHaveLength(2)
    expect(store().tabs).toHaveLength(10)
    expect(store().tabs.filter((tab) => tab.workspaceId === workspace.id)).toMatchObject([
      { title: 'Terminal 1', status: 'starting' },
    ])
  })
  it('creates independent workspaces and scopes terminal selection, closing and shortcuts', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const path = store().selectedProject!
    const initial = store().tabs[0]
    expect(await store().newWorkspace(path)).toBe(true)
    const workspace = store().workspaces[1]
    expect(workspace).toMatchObject({ projectPath: path, name: '工作区 2' })
    expect(nextWorkspaceName(path, store().workspaces)).toBe('工作区 3')
    expect(nextWorkspaceName('/tmp/other', store().workspaces)).toBe('工作区')
    expect(nextWorkspaceName(path, [{ ...workspace, name: '工作区 1' }])).toBe('工作区 2')
    expect(workspace.id).not.toBe(initial.workspaceId)
    expect(store().selectedWorkspaces[path]).toBe(workspace.id)
    expect(store().tabs).toHaveLength(2)
    const first = store().tabs[1]
    expect(first).toMatchObject({
      projectPath: path,
      workspaceId: workspace.id,
      title: 'Terminal 1',
      status: 'starting',
    })
    expect(store().activeTabs[workspace.id]).toBe(first.id)
    useSourceControl.getState().update(workspace.id, {
      preview: true,
      draft: 'keep draft',
      selection: { path: 'file.txt', area: 'staged' },
    })
    store().shortcut('new-terminal')
    expect(useSourceControl.getState().sessions[workspace.id]).toMatchObject({
      preview: false,
      draft: 'keep draft',
    })
    const second = store().tabs[2]
    expect(second).toMatchObject({ workspaceId: workspace.id, title: 'Terminal 2' })
    useSourceControl.getState().update(workspace.id, { preview: true })
    store().shortcut('tab-1')
    expect(useSourceControl.getState().sessions[workspace.id]).toMatchObject({
      preview: false,
      selection: { path: 'file.txt', area: 'staged' },
    })
    expect(store().activeTabs).toEqual({
      [initial.workspaceId]: initial.id,
      [workspace.id]: first.id,
    })
    store().updateTab(first.id, { status: 'running' })
    store().shortcut('close-terminal')
    await vi.waitFor(() => expect(store().tabs).toEqual([initial, second]))
    expect(api.closeTerminal).toHaveBeenCalledExactlyOnceWith(first.id)
    expect(store().activeTabs).toEqual({
      [initial.workspaceId]: initial.id,
      [workspace.id]: second.id,
    })
    await store().selectProject(path, initial.workspaceId)
    expect(store().selectedWorkspaces[path]).toBe(initial.workspaceId)
    await store().selectProject('/tmp/other')
    await store().selectProject(path)
    expect(store().selectedWorkspaces[path]).toBe(initial.workspaceId)
    expect(store().tabs).toEqual([initial, second])
    expect(api.closeWindow).not.toHaveBeenCalled()
    const target = { ...workspace, id: crypto.randomUUID(), name: '仅 Agent' }
    useWorkspace.setState({ workspaces: [...store().workspaces, target] })
    store().newTerminal('pi', target.id)
    expect(store().tabs).toHaveLength(3)
    expect(store().tabs[2]).toMatchObject({
      kind: 'agent',
      provider: 'pi',
      title: 'Pi · 1',
      workspaceId: target.id,
      status: 'starting',
    })
    expect(currentWorkspace(store())?.id).toBe(target.id)
    const launchId = store().tabs[2].launchId
    expect(launchId).toBeTruthy()
    store().newTerminal('pi')
    store().newTerminal('codex')
    store().newTerminal('claude')
    store().newTerminal()
    expect(
      store()
        .tabs.slice(2)
        .map((tab) => tab.title),
    ).toEqual(['Pi · 1', 'Pi · 2', 'Codex · 1', 'Claude Code · 1', 'Terminal 1'])
    expect(store().tabs[3].launchId).not.toBe(launchId)
    const saved = vi.mocked(api.saveLayout).mock.calls.at(-1)![0]
    expect(saved.tabs[2]).toEqual({
      id: store().tabs[2].id,
      projectPath: path,
      workspaceId: target.id,
      title: 'Pi · 1',
      kind: 'agent',
      provider: 'pi',
    })
    await store().selectProject(path, initial.workspaceId)
    const agentTab = store().tabs[4]
    const focus = store().focusVersion
    if (await store().selectProject(agentTab.projectPath, agentTab.workspaceId)) {
      store().selectTab(agentTab.id)
    }
    expect(currentWorkspace(store())?.id).toBe(target.id)
    expect(store().activeTabs[target.id]).toBe(agentTab.id)
    expect(store().focusVersion).toBeGreaterThan(focus)
    useSourceControl.getState().update(target.id, {
      preview: true,
      draft: 'keep draft',
      selection: { path: 'file.txt', area: 'unstaged' },
    })
    const status = {
      rootPath: path,
      branch: 'main',
      head: null,
      ahead: 0,
      behind: 0,
      indexVersion: 'fixture',
      entries: [{ path: 'file.txt', area: 'staged' as const, status: 'A', submodule: false }],
    }
    useSourceControl.getState().update(target.id, { status })
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      preview: true,
      selection: { path: 'file.txt', area: 'staged' },
    })
    useSourceControl.getState().update(target.id, { status: { ...status, entries: [] } })
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      preview: false,
      selection: undefined,
      draft: 'keep draft',
    })
    const review = {
      area: 'review' as const,
      path: 'file.txt',
      base: null,
      head: 'a'.repeat(40),
      label: 'snapshot',
      status: 'A',
      submodule: false,
    }
    useSourceControl
      .getState()
      .update(target.id, { selection: review, preview: true, mode: 'history' })
    useSourceControl.getState().update(target.id, { status: { ...status, entries: [] } })
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      selection: review,
      preview: true,
    })
    store().selectTab(store().activeTabs[target.id])
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      selection: review,
      preview: false,
      draft: 'keep draft',
      mode: 'history',
    })
    expect(useRightPanel.getState()).toEqual({ open: false, width: 300 })
    const gitSession = useSourceControl.getState().sessions[target.id]
    const tabs = store().tabs
    useRightPanel.setState({ open: true, width: 420 })
    await store().selectProject(path, initial.workspaceId)
    expect(useRightPanel.getState()).toEqual({ open: true, width: 420 })
    useRightPanel.setState({ open: false })
    expect(useSourceControl.getState().sessions[target.id]).toBe(gitSession)
    expect(store().tabs).toBe(tabs)
    useRightPanel.setState({ open: true })
    expect(useRightPanel.getState()).toEqual({ open: true, width: 420 })
  })

  it('creates exactly one terminal when selecting an empty workspace and reuses existing terminals', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const first = store().workspaces[0]
    useWorkspace.setState({ tabs: [], activeTabs: {} })
    await store().newWorkspace(path)
    const second = store().workspaces[1]
    expect(store().tabs).toMatchObject([{ workspaceId: second.id, status: 'starting' }])
    await Promise.all([
      store().selectProject(path, first.id),
      store().selectProject(path, first.id),
    ])
    expect(store().tabs).toHaveLength(2)
    const tab = store().tabs[1]
    expect(tab).toMatchObject({ workspaceId: first.id, status: 'starting' })
    expect(store().activeTabs[first.id]).toBe(tab.id)
    await store().selectProject(path, second.id)
    expect(store().tabs).toHaveLength(2)
    await store().selectProject(path, first.id)
    expect(store().tabs).toHaveLength(2)
    expect(store().activeTabs[first.id]).toBe(tab.id)
  })

  it('creates and renames custom workspaces without changing another workspace or its terminals', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const path = store().selectedProject!
    expect(await store().newWorkspace(path, '   ')).toBe(false)
    await store().newWorkspace(path, '  功能 开发  ')
    const target = store().workspaces[1]
    expect(target.name).toBe('功能 开发')
    const before = store()
    expect(store().renameWorkspace(target.id, '   ')).toBe(false)
    expect(store().renameWorkspace(target.id, '  新名称  ')).toBe(true)
    expect(store().workspaces).toEqual([before.workspaces[0], { ...target, name: '新名称' }])
    expect(store()).toMatchObject({
      selectedProject: before.selectedProject,
      selectedWorkspaces: before.selectedWorkspaces,
      tabs: before.tabs,
      activeTabs: before.activeTabs,
    })
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaces: store().workspaces }),
    )
  })

  it('does not resurrect a deleted project when an earlier workspace creation finishes', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    let finish!: (result: Result<void>) => void
    vi.mocked(api.selectProject).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const creating = store().newWorkspace(path)
    await store().removeProject(path)
    finish({ ok: true, value: undefined })
    expect(await creating).toBe(false)
    expect(store().projects).toEqual([])
    expect(store().workspaces).toEqual([])
  })

  it('keeps workspaces unchanged when creation fails, belongs to another project or removal is pending', async () => {
    await useWorkspace.getState().openProject()
    const path = useWorkspace.getState().selectedProject!
    const original = useWorkspace.getState().workspaces
    const tabs = useWorkspace.getState().tabs
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '目录不可访问' })
    expect(await useWorkspace.getState().newWorkspace(path)).toBe(false)
    expect(useWorkspace.getState().workspaces).toEqual(original)
    expect(useWorkspace.getState().tabs).toEqual(tabs)
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '目录不可访问' })
    expect(await useWorkspace.getState().selectProject('/missing')).toBe(false)
    expect(useWorkspace.getState().selectedProject).toBe(path)
    expect(useWorkspace.getState().workspaces).toEqual(original)
    await useWorkspace.getState().newWorkspace(path)
    const workspace = useWorkspace.getState().workspaces[1]
    expect(await useWorkspace.getState().selectProject('/tmp/other', workspace.id)).toBe(false)
    expect(useWorkspace.getState().selectedProject).toBe(path)
    const before = useWorkspace.getState().workspaces
    useWorkspace.setState({ removingWorkspace: path })
    expect(await useWorkspace.getState().newWorkspace(path)).toBe(false)
    expect(useWorkspace.getState().workspaces).toEqual(before)
  })

  it('respects close cancellation and chooses a surviving tab after confirmation', async () => {
    await useWorkspace.getState().openProject()
    useWorkspace.getState().newTerminal()
    const [a, b] = useWorkspace.getState().tabs
    useWorkspace.getState().updateTab(b.id, { status: 'running' })
    vi.mocked(api.closeTerminal).mockResolvedValueOnce({ ok: true, value: false })
    await useWorkspace.getState().closeTab(b.id)
    expect(useWorkspace.getState().tabs).toHaveLength(2)
    expect(useWorkspace.getState().tabs[1]).toMatchObject({
      status: 'running',
      closingStatus: undefined,
    })
    vi.mocked(api.closeTerminal).mockResolvedValueOnce({
      ok: false,
      error: 'process cleanup failed',
    })
    await useWorkspace.getState().closeTab(b.id)
    expect(useWorkspace.getState().tabs[1]).toMatchObject({
      status: 'running',
      error: '关闭失败：process cleanup failed',
      closingStatus: undefined,
    })
    await useWorkspace.getState().closeTab(b.id)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useWorkspace.getState().activeTabs[b.workspaceId]).toBe(a.id)
  })
  it('keeps the pre-close presentation and ignores duplicate closes until Main confirms', async () => {
    await useWorkspace.getState().openProject()
    const tab = useWorkspace.getState().tabs[0]
    useWorkspace.getState().updateTab(tab.id, { status: 'running' })
    let finish!: (result: Result<boolean>) => void
    vi.mocked(api.closeTerminal).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const closing = useWorkspace.getState().closeTab(tab.id)
    expect(useWorkspace.getState().tabs[0].closingStatus).toBe('running')
    useWorkspace.getState().updateTab(tab.id, { status: 'exited', exitCode: 0 })
    expect(useWorkspace.getState().tabs[0]).toMatchObject({
      status: 'exited',
      exitCode: 0,
      closingStatus: 'running',
    })
    await useWorkspace.getState().closeTab(tab.id)
    expect(api.closeTerminal).toHaveBeenCalledOnce()
    finish({ ok: true, value: true })
    await closing
    expect(useWorkspace.getState().tabs).toEqual([])
    expect(useWorkspace.getState().activeTabs).toEqual({})
    expect(useWorkspace.getState().selectedProject).toBeUndefined()
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
    expect(useWorkspace.getState().projects).toEqual([tab.projectPath])
    expect(useWorkspace.getState().workspaces[0].id).toBe(tab.workspaceId)
    await useWorkspace.getState().selectProject(tab.projectPath, tab.workspaceId)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useWorkspace.getState().tabs[0].id).not.toBe(tab.id)
    expect(currentWorkspace(useWorkspace.getState())?.id).toBe(tab.workspaceId)
  })
  it('does not deselect another workspace when a background terminal finishes closing', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const tab = store().tabs[0]
    store().updateTab(tab.id, { status: 'running' })
    let finish!: (result: Result<boolean>) => void
    vi.mocked(api.closeTerminal).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const closing = store().closeTab(tab.id)
    await store().newWorkspace(path)
    const workspace = store().workspaces[1]
    await store().selectProject(path, workspace.id)
    const tabs = store().tabs.filter((item) => item.workspaceId === workspace.id)
    finish({ ok: true, value: true })
    await closing
    expect(currentWorkspace(store())?.id).toBe(workspace.id)
    expect(store().tabs).toEqual(tabs)
  })
  it.each(['cancelled', 'rejected'] as const)(
    'restores the actual exit state when close is %s',
    async (outcome) => {
      await useWorkspace.getState().openProject()
      const tab = useWorkspace.getState().tabs[0]
      useWorkspace.getState().updateTab(tab.id, { status: 'running' })
      vi.mocked(api.closeTerminal).mockImplementationOnce(async () => {
        useWorkspace.getState().updateTab(tab.id, { status: 'exited', exitCode: 1 })
        if (outcome === 'rejected') throw new Error('清理失败')
        return { ok: true, value: false }
      })
      await useWorkspace.getState().closeTab(tab.id)
      expect(useWorkspace.getState().tabs[0]).toMatchObject({
        status: 'exited',
        exitCode: 1,
        closingStatus: undefined,
      })
      expect(useWorkspace.getState().activeTabs[tab.workspaceId]).toBe(tab.id)
      expect(currentWorkspace(useWorkspace.getState())?.id).toBe(tab.workspaceId)
      if (outcome === 'cancelled') expect(console.error).not.toHaveBeenCalled()
      else expect(console.error).toHaveBeenCalled()
    },
  )
  it('keeps the workspace and terminals unchanged when deletion is declined or fails', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    store().newTerminal()
    const before = store()
    const id = before.workspaces[0].id
    vi.mocked(api.removeWorkspace).mockResolvedValueOnce({ ok: true, value: false })
    expect(await store().removeWorkspace(id)).toBe(false)
    expect(store()).toMatchObject({
      projects: before.projects,
      workspaces: before.workspaces,
      selectedWorkspaces: before.selectedWorkspaces,
      tabs: before.tabs,
      activeTabs: before.activeTabs,
      selectedProject: before.selectedProject,
      removingWorkspace: undefined,
    })
    vi.mocked(api.removeWorkspace).mockResolvedValueOnce({ ok: false, error: '终端清理失败' })
    expect(await store().removeWorkspace(id)).toBe(false)
    expect(store().workspaces).toEqual(before.workspaces)
    expect(store().tabs).toEqual(before.tabs)
    expect(console.error).toHaveBeenLastCalledWith(new Error('终端清理失败'))
    expect(store().removingWorkspace).toBeUndefined()
    expect(api.closeTerminal).not.toHaveBeenCalled()
    expect(await store().removeWorkspace(id)).toBe(true)
  })
  it('removes only the target workspace after Main succeeds and selects a surviving sibling', async () => {
    const store = () => useWorkspace.getState()
    await store().selectProject('/tmp/other')
    store().newTerminal()
    const other = store().tabs[0]
    await store().openProject()
    const path = store().selectedProject!
    const initial = store().tabs[1]
    await store().newWorkspace(path)
    const workspace = store().workspaces.at(-1)!
    let finish!: (result: { ok: true; value: boolean }) => void
    vi.mocked(api.removeWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const removing = store().removeWorkspace(workspace.id)
    expect(await store().removeWorkspace(workspace.id)).toBe(false)
    store().shortcut('new-terminal')
    await store().selectProject('/tmp/blocked')
    expect(api.removeWorkspace).toHaveBeenCalledExactlyOnceWith({
      projectPath: path,
      workspaceId: workspace.id,
      removeProject: false,
    })
    expect(store().tabs).toHaveLength(3)
    finish({ ok: true, value: true })
    expect(await removing).toBe(true)
    expect(store().tabs).toEqual([other, initial])
    expect(store().activeTabs).toEqual({
      [other.workspaceId]: other.id,
      [initial.workspaceId]: initial.id,
    })
    expect(store().selectedProject).toBe(path)
    expect(store().selectedWorkspaces[path]).toBe(initial.workspaceId)
    expect(store().projects).toEqual(['/tmp/other', path])
    expect(store().workspaces.map((item) => item.id)).toEqual([
      other.workspaceId,
      initial.workspaceId,
    ])
  })
  it('treats the default workspace like any sibling and does not recreate it', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const initial = store().workspaces[0]
    await store().newWorkspace(path)
    const workspace = store().workspaces[1]
    const siblingTab = store().tabs[1]
    await store().removeWorkspace(initial.id)
    expect(store().selectedWorkspaces[path]).toBe(workspace.id)
    expect(store().tabs).toEqual([siblingTab])
    expect(store().workspaces).toEqual([workspace])
    expect(await store().selectProject(path, initial.id)).toBe(false)
    await store().openProject()
    expect(store().workspaces).toEqual([workspace])
    expect(store().selectedWorkspaces[path]).toBe(workspace.id)
  })
  it('removes the folder with its last workspace and creates a new workspace when reopened', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const id = store().workspaces[0].id
    store().newTerminal()
    await store().removeWorkspace(id)
    expect(api.removeWorkspace).toHaveBeenCalledExactlyOnceWith({
      projectPath: path,
      workspaceId: id,
      removeProject: true,
    })
    expect(store().projects).toEqual([])
    expect(store().selectedProject).toBeUndefined()
    expect(store().workspaces).toEqual([])
    expect(store().tabs).toEqual([])
    expect(store().activeTabs).toEqual({})
    expect(store().selectedWorkspaces).toEqual({})
    await store().openProject()
    expect(store().workspaces).toHaveLength(1)
    expect(store().workspaces[0]).toMatchObject({ projectPath: path, name: '工作区' })
    expect(store().workspaces[0].id).not.toBe(id)
  })
  it('removes a background workspace without changing the current project', async () => {
    await useWorkspace.getState().openProject()
    const id = useWorkspace.getState().workspaces[0].id
    await useWorkspace.getState().selectProject('/tmp/current')
    await useWorkspace.getState().removeWorkspace(id)
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/current')
    expect(useWorkspace.getState().projects).toEqual(['/tmp/current'])
  })
  it('deletes all project workspaces and tabs without affecting another project', async () => {
    const store = () => useWorkspace.getState()
    await store().selectProject('/tmp/other')
    store().newTerminal()
    const other = store().tabs[0]
    await store().openProject()
    const path = store().selectedProject!
    store().newTerminal()
    await store().newWorkspace(path)
    store().newTerminal()
    const before = store()
    let finish!: (result: Result<boolean>) => void
    vi.mocked(api.removeProject).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const removing = store().removeProject(path)
    expect(await store().removeProject(path)).toBe(false)
    expect(await store().removeWorkspace(before.workspaces[1].id)).toBe(false)
    store().shortcut('new-terminal')
    expect(store().tabs).toEqual(before.tabs)
    finish({ ok: true, value: true })
    expect(await removing).toBe(true)
    expect(api.removeProject).toHaveBeenCalledExactlyOnceWith(path)
    expect(store().projects).toEqual(['/tmp/other'])
    expect(store().workspaces).toEqual([before.workspaces[0]])
    expect(store().tabs).toEqual([other])
    expect(store().activeTabs).toEqual({ [other.workspaceId]: other.id })
    expect(store().selectedProject).toBe('/tmp/other')
    expect(store().selectedWorkspaces[path]).toBeUndefined()
    expect(store().removingWorkspace).toBeUndefined()
  })
  it.each([false, 'failure'])(
    'preserves project records when project deletion returns %s',
    async (outcome) => {
      const store = () => useWorkspace.getState()
      await store().openProject()
      store().newTerminal()
      const before = store()
      vi.mocked(api.removeProject).mockResolvedValueOnce(
        outcome === false ? { ok: true, value: false } : { ok: false, error: '清理失败' },
      )
      expect(await store().removeProject(before.selectedProject!)).toBe(false)
      expect(store().projects).toEqual(before.projects)
      expect(store().workspaces).toEqual(before.workspaces)
      expect(store().tabs).toEqual(before.tabs)
      expect(store().removingWorkspace).toBeUndefined()
      if (outcome === false) expect(console.error).not.toHaveBeenCalled()
      else expect(console.error).toHaveBeenLastCalledWith(new Error('清理失败'))
    },
  )
})
