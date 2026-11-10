import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import { MAX_TERMINALS } from '../../../src/shared/contracts'
import { currentWorkspace, useWorkspace } from '../../../src/renderer/src/state/workspace'

describe('Project opening and grouping', () => {
  it('adds projects to project grouping and keeps the opened terminal when grouping cannot be saved', async () => {
    const id = crypto.randomUUID()
    const grouping = {
      groups: [{ id, name: '工具', projects: ['/tmp/中文 项目'], collapsed: false }],
    }
    useWorkspace.setState({
      projectGrouping: {
        ...grouping,
        groups: [{ ...grouping.groups[0], projects: [], collapsed: true }],
      },
    })
    vi.mocked(api.changeProjectGrouping).mockResolvedValueOnce({ ok: true, value: grouping })
    await useWorkspace.getState().openProject(id)
    expect(api.changeProjectGrouping).toHaveBeenCalledWith({
      type: 'move',
      projectPath: '/tmp/中文 项目',
      groupId: id,
    })
    expect(useWorkspace.getState().projectGrouping).toEqual(grouping)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: '/tmp/second' })
    vi.mocked(api.changeProjectGrouping).mockResolvedValueOnce({ ok: false, error: '分组已删除' })
    await useWorkspace.getState().openProject(id)
    expect(useWorkspace.getState().projects).toEqual(['/tmp/中文 项目', '/tmp/second'])
    expect(useWorkspace.getState().tabs).toHaveLength(2)
    expect(useWorkspace.getState().projectOpenError).toBe('项目已添加，但无法加入分组：分组已删除')
    expect(useWorkspace.getState().projectGrouping).toEqual(grouping)
    expect(api.closeTerminal).not.toHaveBeenCalled()
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
      expect({ ...useWorkspace.getState(), projectOpenError: before.projectOpenError }).toEqual(
        before,
      )
      expect(useWorkspace.getState().projectOpenError).toBe(result.ok ? undefined : result.error)
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
    for (let i = store().tabs.length; i < MAX_TERMINALS; i++)
      store().newTerminal(i % 2 ? 'pi' : undefined)
    store().newTerminal('codex')
    expect(store().tabs).toHaveLength(MAX_TERMINALS)
    vi.mocked(api.openProject).mockResolvedValue({ ok: true, value: '/tmp/second' })
    await store().openProject()
    const workspace = currentWorkspace(store())!
    expect(workspace).toMatchObject({ projectPath: '/tmp/second', kind: 'local' })
    expect(store().tabs).toHaveLength(MAX_TERMINALS)
    expect(store().tabs.some((tab) => tab.workspaceId === workspace.id)).toBe(false)
    const tab = store().tabs[0]
    store().updateTab(tab.id, { status: 'running' })
    await store().closeTab(tab.id)
    await store().openProject()
    expect(store().workspaces).toHaveLength(2)
    expect(store().tabs).toHaveLength(MAX_TERMINALS)
    expect(
      store().tabs.filter((candidateTab) => candidateTab.workspaceId === workspace.id),
    ).toMatchObject([{ title: 'Terminal 1', status: 'starting' }])
  })
})
