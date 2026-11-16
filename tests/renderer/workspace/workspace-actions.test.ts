import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import {
  currentWorkspace,
  nextWorkspaceName,
  useWorkspace,
} from '../../../src/renderer/src/state/workspace'

import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'
import { useRightPanel } from '../../../src/renderer/src/state/right-panel-store'

async function prepareTwoWorkspaces() {
  const store = () => useWorkspace.getState()
  await store().bootstrap()
  await store().openProject()
  const path = store().selectedProject!
  const initial = store().tabs[0]
  await store().newWorkspace(path)
  const workspace = store().workspaces.find((item) => item.id !== initial.workspaceId)!
  const first = store().tabs.find((tab) => tab.workspaceId === workspace.id)!
  return { store, path, initial, workspace, first }
}

async function prepareWorkspaceWithAgentTabs() {
  const { store, path, initial, workspace } = await prepareTwoWorkspaces()
  const target = { ...workspace, id: crypto.randomUUID(), name: '仅 Agent' }
  useWorkspace.setState({ workspaces: [...store().workspaces, target] })
  store().newTerminal('pi', target.id)
  store().newTerminal('pi')
  store().newTerminal('codex')
  store().newTerminal('claude')
  store().newTerminal()
  return { store, path, initial, target }
}

function stagedStatus(rootPath: string) {
  return {
    rootPath,
    branch: 'main',
    head: null,
    ahead: 0,
    behind: 0,
    indexVersion: 'fixture',
    entries: [{ path: 'file.txt', area: 'staged' as const, status: 'A', submodule: false }],
  }
}

function reviewSelection() {
  return {
    area: 'review' as const,
    path: 'file.txt',
    base: null,
    head: 'a'.repeat(40),
    label: 'snapshot',
    status: 'A',
    submodule: false,
  }
}

describe('Workspace creation and removal', () => {
  it('creates an independent workspace with its own terminal', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const path = store().selectedProject!
    const initial = store().tabs[0]
    expect(await store().newWorkspace(path)).toBe(true)
    const workspace = store().workspaces.find((item) => item.id !== initial.workspaceId)!
    expect(workspace).toMatchObject({ projectPath: path, name: '工作区 2' })
    expect(nextWorkspaceName(path, store().workspaces)).toBe('工作区 3')
    expect(nextWorkspaceName('/tmp/other', store().workspaces)).toBe('工作区')
    expect(nextWorkspaceName(path, [{ ...workspace, name: '工作区 1' }])).toBe('工作区 2')
    expect(workspace.id).not.toBe(initial.workspaceId)
    expect(store().selectedWorkspaces[path]).toBe(workspace.id)
    expect(store().tabs).toHaveLength(2)
    const first = store().tabs.find((tab) => tab.workspaceId === workspace.id)!
    expect(first).toMatchObject({
      projectPath: path,
      workspaceId: workspace.id,
      title: 'Terminal 1',
      cwd: path,
      status: 'starting',
    })
    expect(store().activeTabs[workspace.id]).toBe(first.id)
  })

  it('closes a preview before closing a workspace terminal', async () => {
    const { store, initial, workspace, first } = await prepareTwoWorkspaces()
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
    const second = store().tabs.find(
      (tab) => tab.workspaceId === workspace.id && tab.id !== first.id,
    )!
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
    useSourceControl.getState().update(workspace.id, { preview: true })
    store().shortcut('close-terminal')
    expect(useSourceControl.getState().sessions[workspace.id]).toMatchObject({
      preview: false,
      selection: undefined,
      draft: 'keep draft',
    })
    expect(store().tabs).toEqual([initial, first, second])
    expect(api.closeTerminal).not.toHaveBeenCalled()
    expect(store().activeTabs[workspace.id]).toBe(second.id)
    store().selectTab(first.id)
    store().updateTab(first.id, { status: 'running' })
    store().shortcut('close-terminal')
    await vi.waitFor(() => expect(store().tabs).toEqual([initial, second]))
    expect(api.closeTerminal).toHaveBeenCalledExactlyOnceWith(first.id)
    expect(store().activeTabs).toEqual({
      [initial.workspaceId]: initial.id,
      [workspace.id]: second.id,
    })
  })

  it('remembers the selected workspace when switching projects after a terminal closes', async () => {
    const { store, path, initial, workspace, first } = await prepareTwoWorkspaces()
    store().newTerminal()
    const second = store().tabs.find(
      (tab) => tab.workspaceId === workspace.id && tab.id !== first.id,
    )!
    store().selectTab(first.id)
    store().updateTab(first.id, { status: 'running' })
    store().shortcut('close-terminal')
    await vi.waitFor(() => expect(store().tabs).toEqual([initial, second]))
    await store().selectProject(path, initial.workspaceId)
    expect(store().selectedWorkspaces[path]).toBe(initial.workspaceId)
    await store().selectProject('/tmp/other')
    await store().selectProject(path)
    expect(store().selectedWorkspaces[path]).toBe(initial.workspaceId)
    expect(store().tabs).toEqual([initial, second])
    expect(api.closeWindow).not.toHaveBeenCalled()
  })

  it('creates, persists and focuses Agent tabs in their target workspace', async () => {
    const { store, path, initial, workspace } = await prepareTwoWorkspaces()
    const target = { ...workspace, id: crypto.randomUUID(), name: '仅 Agent' }
    useWorkspace.setState({ workspaces: [...store().workspaces, target] })
    store().newTerminal('pi', target.id)
    expect(store().tabs).toHaveLength(3)
    const targetTabs = () => store().tabs.filter((tab) => tab.workspaceId === target.id)
    const firstAgent = targetTabs()[0]
    expect(firstAgent).toMatchObject({
      kind: 'agent',
      provider: 'pi',
      title: 'Pi · 1',
      workspaceId: target.id,
      status: 'starting',
    })
    expect(currentWorkspace(store())?.id).toBe(target.id)
    const launchId = firstAgent.launchId
    expect(launchId).toBeTruthy()
    store().newTerminal('pi')
    store().newTerminal('codex')
    store().newTerminal('claude')
    store().newTerminal()
    expect(targetTabs().map((tab) => tab.title)).toEqual([
      'Pi · 1',
      'Pi · 2',
      'Codex · 1',
      'Claude Code · 1',
      'Terminal 1',
    ])
    expect(targetTabs().find((tab) => tab.title === 'Pi · 2')?.launchId).not.toBe(launchId)
    const saved = vi.mocked(api.saveLayout).mock.calls.at(-1)![0]
    expect(saved.tabs.map((tab) => tab.id)).toEqual(store().tabs.map((tab) => tab.id))
    expect(saved.tabs.find((tab) => tab.id === firstAgent.id)).toEqual({
      id: firstAgent.id,
      projectPath: path,
      workspaceId: target.id,
      title: 'Pi · 1',
      kind: 'agent',
      provider: 'pi',
    })
    await store().selectProject(path, initial.workspaceId)
    const agentTab = targetTabs().find((tab) => tab.provider === 'codex')!
    const focus = store().focusVersion
    if (await store().selectProject(agentTab.projectPath, agentTab.workspaceId)) {
      store().selectTab(agentTab.id)
    }
    expect(currentWorkspace(store())?.id).toBe(target.id)
    expect(store().activeTabs[target.id]).toBe(agentTab.id)
    expect(store().focusVersion).toBeGreaterThan(focus)
  })

  it('reconciles a preview selection with changed Git status', async () => {
    const { path, target } = await prepareWorkspaceWithAgentTabs()
    useSourceControl.getState().update(target.id, {
      preview: true,
      draft: 'keep draft',
      selection: { path: 'file.txt', area: 'unstaged' },
    })
    const status = stagedStatus(path)
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
  })

  it('scopes changes-tab shortcuts without closing workspace terminals', async () => {
    const { store, path, initial, target } = await prepareWorkspaceWithAgentTabs()
    const status = stagedStatus(path)
    useSourceControl.getState().update(target.id, { draft: 'keep draft', selection: undefined })
    const terminalTabs = store().tabs
    const closeCalls = vi.mocked(api.closeTerminal).mock.calls.length
    useSourceControl.getState().update(target.id, { status })
    useSourceControl.getState().openChanges(target.id)
    useSourceControl.getState().openChanges(target.id)
    useSourceControl.getState().update(target.id, { status: { ...status, entries: [] } })
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      preview: false,
      changesOpen: true,
      changesActive: true,
      selection: undefined,
      draft: 'keep draft',
    })
    store().shortcut('tab-1')
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      preview: false,
      changesOpen: true,
      changesActive: false,
    })
    expect(store().tabs.filter((tab) => tab.workspaceId === target.id)).toHaveLength(5)
    store().shortcut('tab-6')
    expect(useSourceControl.getState().sessions[target.id]!.changesActive).toBe(true)
    store().shortcut('close-terminal')
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      changesOpen: false,
      changesActive: false,
      draft: 'keep draft',
    })
    expect(store().tabs).toBe(terminalTabs)
    expect(api.closeTerminal).toHaveBeenCalledTimes(closeCalls)
    expect(useSourceControl.getState().sessions[initial.workspaceId]?.changesOpen).not.toBe(true)
  })

  it('keeps review previews when worktree status changes', async () => {
    const { store, path, target } = await prepareWorkspaceWithAgentTabs()
    const status = stagedStatus(path)
    useSourceControl.getState().update(target.id, { draft: 'keep draft' })
    useSourceControl.getState().openChanges(target.id)
    const review = reviewSelection()
    useSourceControl
      .getState()
      .update(target.id, { selection: review, preview: true, mode: 'history' })
    useSourceControl.getState().update(target.id, { status: { ...status, entries: [] } })
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      selection: review,
      preview: true,
      changesOpen: true,
      changesActive: false,
    })
    store().selectTab(store().activeTabs[target.id])
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      selection: review,
      preview: false,
      draft: 'keep draft',
      mode: 'history',
    })
  })

  it('preserves right-panel and source-control state across workspace switches', async () => {
    const { store, path, initial, target } = await prepareWorkspaceWithAgentTabs()
    useSourceControl.getState().update(target.id, {
      draft: 'keep draft',
      selection: reviewSelection(),
      preview: false,
      mode: 'history',
    })
    expect(useRightPanel.getState()).toEqual({ open: false, width: 300 })
    const gitSession = useSourceControl.getState().sessions[target.id]
    const tabs = store().tabs
    useRightPanel.setState({ open: true, width: 420 })
    await store().selectProject(path, initial.workspaceId)
    expect(useRightPanel.getState()).toEqual({ open: true, width: 420 })
    store().shortcut('toggle-right-panel')
    expect(useRightPanel.getState()).toEqual({ open: false, width: 420 })
    expect(useSourceControl.getState().sessions[target.id]).toBe(gitSession)
    expect(store().tabs).toBe(tabs)
    store().shortcut('toggle-right-panel')
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
