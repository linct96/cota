import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI, Result } from '../src/shared/contracts'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import { currentWorkspace, useWorkspace } from '../src/renderer/src/store'

let api: DesktopAPI
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  api = {
    bootstrap: vi.fn().mockResolvedValue({
      ok: true,
      value: { config: structuredClone(DEFAULT_CONFIG), sessions: [] },
    }),
    saveLayout: vi.fn().mockResolvedValue({ ok: true }),
    openProject: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/中文 项目' }),
    selectProject: vi.fn().mockResolvedValue({ ok: true }),
    projectBranch: vi.fn().mockResolvedValue({ ok: true, value: null }),
    removeWorkspace: vi.fn().mockResolvedValue({ ok: true, value: true }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, value: true }),
    savePreferences: vi.fn(async (value) => ({ ok: true as const, value })),
    closeTerminal: vi.fn().mockResolvedValue({ ok: true, value: true }),
    closeWindow: vi.fn(),
    respondToConfirmation: vi.fn().mockResolvedValue({ ok: true }),
    onConfirmation: vi.fn(() => vi.fn()),
    onShortcut: vi.fn(() => vi.fn()),
    onTerminal: vi.fn(() => vi.fn()),
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

describe('workspace state', () => {
  it('updates preferences with the saved result and closes settings only after success', async () => {
    const value = { shellPath: '/bin/bash', scrollback: 1000 }
    const saved = { ...value, scrollback: 2000 }
    useWorkspace.setState({ settingsOpen: true })
    let finish!: (result: Result<typeof value>) => void
    vi.mocked(api.savePreferences).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const saving = useWorkspace.getState().savePreferences(value)
    expect(api.savePreferences).toHaveBeenCalledExactlyOnceWith(value)
    expect(useWorkspace.getState().settingsOpen).toBe(true)
    expect(useWorkspace.getState().preferences).toEqual(DEFAULT_CONFIG.preferences)
    finish({ ok: true, value: saved })
    await saving
    expect(useWorkspace.getState().preferences).toEqual(saved)
    expect(useWorkspace.getState().settingsOpen).toBe(false)
  })

  it('preserves preferences and open settings after a failed save, allowing retry', async () => {
    const value = { shellPath: '/bin/bash', scrollback: 1000 }
    useWorkspace.setState({ settingsOpen: true })
    const before = useWorkspace.getState().preferences
    vi.mocked(api.savePreferences).mockResolvedValueOnce({ ok: false, error: '保存失败' })
    await expect(useWorkspace.getState().savePreferences(value)).rejects.toThrow('保存失败')
    expect(useWorkspace.getState().preferences).toBe(before)
    expect(useWorkspace.getState().settingsOpen).toBe(true)
    await useWorkspace.getState().savePreferences(value)
    expect(useWorkspace.getState().preferences).toEqual(value)
    expect(useWorkspace.getState().settingsOpen).toBe(false)
  })

  it('loads recent workspaces without selection and creates a terminal only after selection', async () => {
    const store = () => useWorkspace.getState()
    const paths = ['/tmp/中文 项目', '/tmp/other']
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: { ...structuredClone(DEFAULT_CONFIG), recentProjects: paths },
        sessions: [],
        warning: '配置原文件已保留',
      },
    })
    await store().bootstrap()
    expect(store().ready).toBe(true)
    expect(console.warn).toHaveBeenCalledWith('配置原文件已保留')
    expect(store().projects).toEqual(paths)
    expect(store().workspaces.map(({ projectPath, name }) => ({ projectPath, name }))).toEqual(
      paths.map((projectPath) => ({ projectPath, name: '工作区 1' })),
    )
    expect(store().selectedProject).toBeUndefined()
    expect(store().selectedWorkspaces).toEqual({})
    expect(currentWorkspace(store())).toBeUndefined()
    expect(store().tabs).toEqual([])
    expect(api.selectProject).not.toHaveBeenCalled()
    expect(api.createTerminal).not.toHaveBeenCalled()
    const workspace = store().workspaces[1]
    expect(await store().selectProject(workspace.projectPath, workspace.id)).toBe(true)
    expect(currentWorkspace(store())?.id).toBe(workspace.id)
    expect(store().tabs).toHaveLength(1)
    expect(store().tabs[0]).toMatchObject({ workspaceId: workspace.id, status: 'starting' })
  })

  it('activates the last workspace and active tab only when its Host sessions still exist', async () => {
    const path = '/tmp/project'
    const workspace = { id: crypto.randomUUID(), projectPath: path, name: 'Agent 实验' }
    const live = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      projectPath: path,
      title: 'Codex',
    }
    const other = { ...live, id: crypto.randomUUID(), title: 'Shell' }
    const lost = { ...live, id: crypto.randomUUID() }
    const orphan = {
      ...live,
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
          .map((tab) => ({ ...tab, cols: 80, rows: 24, exited: false }))
          .concat(orphan),
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState().selectedProject).toBe(path)
    expect(currentWorkspace(useWorkspace.getState())).toEqual(workspace)
    expect(useWorkspace.getState().selectedWorkspaces).toEqual({ [path]: workspace.id })
    expect(useWorkspace.getState().activeTabs[workspace.id]).toBe(live.id)
    expect(api.selectProject).not.toHaveBeenCalled()
    expect(useWorkspace.getState().tabs).toEqual([
      expect.objectContaining({ id: other.id, title: 'Shell', status: 'running' }),
      expect.objectContaining({ id: live.id, title: 'Codex', status: 'running' }),
      expect.objectContaining({ id: orphan.id, status: 'exited', exitCode: 7 }),
    ])
    expect(useWorkspace.getState().workspaces.some((item) => item.id === orphan.workspaceId)).toBe(
      true,
    )
    expect(api.createTerminal).not.toHaveBeenCalled()
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedProject: path,
        tabs: [other, live, expect.objectContaining({ id: orphan.id })],
      }),
    )
    expect(await useWorkspace.getState().selectProject(path, workspace.id)).toBe(true)
    expect(currentWorkspace(useWorkspace.getState())).toEqual(workspace)
    expect(useWorkspace.getState().tabs).toHaveLength(3)
    expect(useWorkspace.getState().activeTabs[workspace.id]).toBe(live.id)
    expect(api.createTerminal).not.toHaveBeenCalled()
    useWorkspace.getState().renameWorkspace(workspace.id, '新版名称')
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaces: expect.arrayContaining([{ ...workspace, name: '新版名称' }]),
      }),
    )
  })

  it('loads the last empty workspace without activating it and creates a terminal only when clicked', async () => {
    const path = '/tmp/project'
    const workspace = { id: crypto.randomUUID(), projectPath: path, name: '上次工作区' }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [path],
          layout: {
            workspaces: [workspace],
            tabs: [
              {
                id: crypto.randomUUID(),
                workspaceId: workspace.id,
                projectPath: path,
                title: '旧终端',
              },
            ],
            selectedProject: path,
            selectedWorkspaces: { [path]: workspace.id },
            activeTabs: {},
          },
        },
        sessions: [],
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState().workspaces).toEqual([workspace])
    expect(useWorkspace.getState().selectedProject).toBeUndefined()
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
    expect(api.selectProject).not.toHaveBeenCalled()
    expect(useWorkspace.getState().tabs).toEqual([])
    expect(api.createTerminal).not.toHaveBeenCalled()
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaces: [workspace], tabs: [], selectedProject: undefined }),
    )
    expect(await useWorkspace.getState().selectProject(path, workspace.id)).toBe(true)
    expect(currentWorkspace(useWorkspace.getState())).toEqual(workspace)
    expect(useWorkspace.getState().tabs).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, status: 'starting' }),
    ])
  })

  it('does not activate an empty last workspace just because another workspace has a terminal', async () => {
    const path = '/tmp/project'
    const empty = { id: crypto.randomUUID(), projectPath: path, name: '空工作区' }
    const other = { id: crypto.randomUUID(), projectPath: path, name: '其他工作区' }
    const session = {
      id: crypto.randomUUID(),
      workspaceId: other.id,
      projectPath: path,
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
            workspaces: [other, empty],
            tabs: [],
            selectedProject: path,
            selectedWorkspaces: { [path]: empty.id },
            activeTabs: {},
          },
        },
        sessions: [session],
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState().selectedProject).toBeUndefined()
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
    expect(useWorkspace.getState().tabs).toEqual([expect.objectContaining({ id: session.id })])
    expect(api.selectProject).not.toHaveBeenCalled()
    expect(api.createTerminal).not.toHaveBeenCalled()
  })

  it('does not overwrite the saved layout when bootstrap fails', async () => {
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ok: false, error: 'Host 不可用' })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState()).toMatchObject({ ready: true, layoutLoaded: false })
    expect(console.error).toHaveBeenCalledWith(new Error('Host 不可用'))
    expect(api.saveLayout).not.toHaveBeenCalled()
  })

  it('opens and deduplicates projects; cancellation changes nothing', async () => {
    await useWorkspace.getState().bootstrap()
    await useWorkspace.getState().openProject()
    await useWorkspace.getState().openProject()
    expect(useWorkspace.getState().projects).toEqual(['/tmp/中文 项目'])
    expect(useWorkspace.getState().workspaces).toHaveLength(1)
    expect(useWorkspace.getState().workspaces[0]).toMatchObject({
      projectPath: '/tmp/中文 项目',
      name: '工作区 1',
    })
    expect(useWorkspace.getState().workspaces[0].id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    )
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: null })
    await useWorkspace.getState().openProject()
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/中文 项目')
  })
  it('creates independent workspaces and scopes terminal selection, closing and shortcuts', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    store().newTerminal()
    const initial = store().tabs[0]
    expect(await store().newWorkspace(path)).toBe(true)
    const workspace = store().workspaces[1]
    expect(workspace).toMatchObject({ projectPath: path, name: '工作区 2' })
    expect(workspace.id).not.toBe(initial.workspaceId)
    expect(store().selectedWorkspaces[path]).toBe(workspace.id)
    expect(store().tabs).toEqual([initial])
    store().shortcut('new-terminal')
    store().shortcut('new-terminal')
    const [, first, second] = store().tabs
    expect(first).toMatchObject({ workspaceId: workspace.id, title: 'Terminal 1' })
    expect(second).toMatchObject({ workspaceId: workspace.id, title: 'Terminal 2' })
    store().shortcut('tab-1')
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
  })

  it('creates exactly one terminal when selecting an empty workspace and reuses existing terminals', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const first = store().workspaces[0]
    await store().newWorkspace(path)
    const second = store().workspaces[1]
    await Promise.all([
      store().selectProject(path, first.id),
      store().selectProject(path, first.id),
    ])
    expect(store().tabs).toHaveLength(1)
    const tab = store().tabs[0]
    expect(tab).toMatchObject({ workspaceId: first.id, status: 'starting' })
    expect(store().activeTabs[first.id]).toBe(tab.id)
    await store().selectProject(path, second.id)
    expect(store().tabs).toHaveLength(2)
    await store().selectProject(path, first.id)
    expect(store().tabs).toHaveLength(2)
    expect(store().activeTabs[first.id]).toBe(tab.id)
  })

  it('does not create terminals when selection fails or the global limit is reached', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    for (let i = 0; i < 10; i++) store().newTerminal()
    await store().newWorkspace(path)
    const workspace = store().workspaces[1]
    const tabs = store().tabs
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '目录不可访问' })
    expect(await store().selectProject(path, workspace.id)).toBe(false)
    expect(store().tabs).toBe(tabs)
    expect(console.error).toHaveBeenLastCalledWith(new Error('目录不可访问'))
    expect(await store().selectProject(path, workspace.id)).toBe(true)
    expect(store().tabs).toBe(tabs)
    expect(console.error).toHaveBeenLastCalledWith('最多保留 10 个终端，请先关闭一个标签。')
    const before = store()
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '项目目录不可访问' })
    expect(await store().selectProject('/missing')).toBe(false)
    expect(store().selectedProject).toBe(before.selectedProject)
    expect(store().workspaces).toBe(before.workspaces)
    expect(store().tabs).toBe(tabs)
    expect(console.error).toHaveBeenLastCalledWith(new Error('项目目录不可访问'))
  })

  it('trims custom workspace names, rejects blanks and keeps default numbering valid', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const original = store().workspaces
    expect(await store().newWorkspace(path, '   ')).toBe(false)
    expect(store().workspaces).toBe(original)
    expect(api.selectProject).not.toHaveBeenCalled()
    expect(await store().newWorkspace(path, '  功能 开发  ')).toBe(true)
    expect(store().workspaces[1].name).toBe('功能 开发')
    expect(await store().newWorkspace(path)).toBe(true)
    expect(store().workspaces[2].name).toBe('工作区 2')
    expect(await store().newWorkspace(path, '工作区 9')).toBe(true)
    expect(await store().newWorkspace(path)).toBe(true)
    expect(store().workspaces[4].name).toBe('工作区 10')
  })

  it('renames only the target workspace without switching selection or changing terminals', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    const target = store().workspaces[0]
    store().newTerminal()
    await store().newWorkspace(path)
    const before = store()
    expect(store().renameWorkspace(target.id, '  功能 开发  ')).toBe(true)
    expect(store().workspaces[0]).toEqual({ ...target, name: '功能 开发' })
    expect(store().workspaces[1]).toBe(before.workspaces[1])
    expect(store().selectedProject).toBe(before.selectedProject)
    expect(store().selectedWorkspaces).toBe(before.selectedWorkspaces)
    expect(store().tabs).toBe(before.tabs)
    expect(store().activeTabs).toBe(before.activeTabs)
    expect(store().focusVersion).toBe(before.focusVersion)
    expect(api.closeTerminal).not.toHaveBeenCalled()
  })

  it('rejects blank, deleted and removal-pending workspace renames without changing records', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const target = store().workspaces[0]
    const original = store().workspaces
    expect(store().renameWorkspace(target.id, '   ')).toBe(false)
    expect(store().workspaces).toBe(original)
    useWorkspace.setState({ removingWorkspace: target.id })
    expect(store().renameWorkspace(target.id, '新名称')).toBe(false)
    expect(store().workspaces).toBe(original)
    useWorkspace.setState({ removingWorkspace: undefined })
    await store().removeWorkspace(target.id)
    expect(store().renameWorkspace(target.id, '新名称')).toBe(false)
    expect(store().workspaces).toEqual([])
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
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '目录不可访问' })
    expect(await useWorkspace.getState().newWorkspace(path)).toBe(false)
    expect(useWorkspace.getState().workspaces).toEqual(original)
    expect(console.error).toHaveBeenLastCalledWith(new Error('目录不可访问'))
    await useWorkspace.getState().newWorkspace(path)
    const workspace = useWorkspace.getState().workspaces[1]
    expect(await useWorkspace.getState().selectProject('/tmp/other', workspace.id)).toBe(false)
    expect(useWorkspace.getState().selectedProject).toBe(path)
    const before = useWorkspace.getState().workspaces
    useWorkspace.setState({ removingWorkspace: path })
    expect(await useWorkspace.getState().newWorkspace(path)).toBe(false)
    expect(useWorkspace.getState().workspaces).toEqual(before)
  })

  it('enforces the global terminal limit across workspaces and cleans only the removed workspace', async () => {
    await useWorkspace.getState().openProject()
    const path = useWorkspace.getState().selectedProject!
    useWorkspace.getState().newTerminal()
    await useWorkspace.getState().newWorkspace(path)
    for (let i = 0; i < 10; i++) useWorkspace.getState().newTerminal()
    expect(useWorkspace.getState().tabs).toHaveLength(10)
    expect(console.error).toHaveBeenLastCalledWith('最多保留 10 个终端，请先关闭一个标签。')
    await useWorkspace.getState().newWorkspace(path)
    expect(useWorkspace.getState().workspaces.map((workspace) => workspace.name)).toEqual([
      '工作区 1',
      '工作区 2',
      '工作区 3',
    ])
    const [initial, first, second] = useWorkspace.getState().workspaces
    const initialTab = useWorkspace.getState().tabs[0]
    await useWorkspace.getState().removeWorkspace(first.id)
    expect(useWorkspace.getState().workspaces).toEqual([initial, second])
    expect(useWorkspace.getState().selectedWorkspaces).toEqual({ [path]: second.id })
    expect(useWorkspace.getState().activeTabs).toEqual({ [initial.id]: initialTab.id })
    expect(useWorkspace.getState().tabs).toEqual([initialTab])
    await useWorkspace.getState().removeWorkspace(second.id)
    await useWorkspace.getState().newWorkspace(path)
    expect(useWorkspace.getState().workspaces.map((workspace) => workspace.name)).toEqual([
      '工作区 1',
      '工作区 2',
    ])
  })

  it('respects close cancellation and chooses a surviving tab after confirmation', async () => {
    await useWorkspace.getState().openProject()
    useWorkspace.getState().newTerminal()
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
    await useWorkspace.getState().closeTab(b.id)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useWorkspace.getState().activeTabs[b.workspaceId]).toBe(a.id)
  })
  it('keeps the pre-close presentation and ignores duplicate closes until Main confirms', async () => {
    await useWorkspace.getState().openProject()
    useWorkspace.getState().newTerminal()
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
    store().newTerminal()
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
  it.each(['cancelled', 'failed', 'rejected'] as const)(
    'restores the actual exit state when close is %s',
    async (outcome) => {
      await useWorkspace.getState().openProject()
      useWorkspace.getState().newTerminal()
      const tab = useWorkspace.getState().tabs[0]
      useWorkspace.getState().updateTab(tab.id, { status: 'running' })
      vi.mocked(api.closeTerminal).mockImplementationOnce(async () => {
        useWorkspace.getState().updateTab(tab.id, { status: 'exited', exitCode: 1 })
        if (outcome === 'rejected') throw new Error('清理失败')
        return outcome === 'cancelled'
          ? { ok: true, value: false }
          : { ok: false, error: '清理失败' }
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
      else expect(console.error).toHaveBeenLastCalledWith(new Error('清理失败'))
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
    store().newTerminal()
    const initial = store().tabs[1]
    await store().newWorkspace(path)
    const workspace = store().workspaces.at(-1)!
    store().newTerminal()
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
    expect(store().projects).toEqual([path, '/tmp/other'])
    expect(store().workspaces.map((item) => item.id)).toEqual([
      other.workspaceId,
      initial.workspaceId,
    ])
  })
  it('treats the default workspace like any sibling and does not recreate it', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const path = store().selectedProject!
    store().newTerminal()
    const initial = store().workspaces[0]
    await store().newWorkspace(path)
    const workspace = store().workspaces[1]
    store().newTerminal()
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
  it('removes the folder with its last workspace and creates a fresh UUID when reopened', async () => {
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
    store().shortcut('new-terminal')
    expect(store().tabs).toEqual([])
    expect(await store().removeWorkspace(id)).toBe(false)
    await store().openProject()
    expect(store().workspaces).toHaveLength(1)
    expect(store().workspaces[0]).toMatchObject({ projectPath: path, name: '工作区 1' })
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
