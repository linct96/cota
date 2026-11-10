import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { currentWorkspace, useWorkspace } from '../../../src/renderer/src/state/workspace'
import { savedLayout } from '../../../src/renderer/src/state/workspace/subscriptions'

import { restoreAgentWorkspace } from './agent-workspace.fixture'

describe('Workspace bootstrap and restoration', () => {
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

  it('persists workspace tab sorting without changing terminal identity and restores it before new sessions', async () => {
    const path = '/tmp/project'
    const workspace = { id: 'workspace', projectPath: path, name: '工作区', kind: 'local' as const }
    const other = { ...workspace, id: 'other-workspace' }
    const a = {
      id: 'a',
      workspaceId: workspace.id,
      projectPath: path,
      title: 'A',
      status: 'running' as const,
    }
    const b = { ...a, id: 'b', title: 'Pi', kind: 'agent' as const, provider: 'pi' as const }
    const c = { ...a, id: 'c', title: 'C' }
    const sibling = { ...a, id: 'sibling', workspaceId: other.id }
    const original = [a, sibling, b, c]
    const store = () => useWorkspace.getState()
    useWorkspace.setState({
      ready: true,
      layoutLoaded: true,
      projects: [path],
      workspaces: [workspace, other],
      selectedProject: path,
      selectedWorkspaces: { [path]: workspace.id },
      tabs: original,
      activeTabs: { [workspace.id]: a.id, [other.id]: sibling.id },
    })
    vi.mocked(api.saveLayout).mockClear()
    const focus = store().focusVersion
    store().reorderTab(workspace.id, a.id, 2)
    expect(store().tabs).toEqual([b, sibling, c, a])
    expect(store().tabs.every((tab) => original.some((item) => item === tab))).toBe(true)
    expect(store().focusVersion).toBe(focus)
    expect(store().activeTabs).toEqual({ [workspace.id]: a.id, [other.id]: sibling.id })
    expect(api.saveLayout).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(api.saveLayout).mock.calls[0][0]
    store().reorderTab(workspace.id, a.id, 2)
    store().reorderTab(workspace.id, sibling.id, 0)
    store().reorderTab(other.id, sibling.id, 0)
    store().reorderTab(workspace.id, 'closed-tab', 0)
    for (const index of [-1, 3, 0.5, NaN]) store().reorderTab(workspace.id, a.id, index)
    useWorkspace.setState({ removingWorkspace: workspace.id })
    store().reorderTab(workspace.id, a.id, 0)
    useWorkspace.setState({ removingWorkspace: undefined })
    store().updateTab(a.id, { closingStatus: 'running' })
    store().reorderTab(workspace.id, a.id, 0)
    expect(api.saveLayout).toHaveBeenCalledTimes(1)
    expect(store().tabs.map((tab) => tab.id)).toEqual(['b', 'sibling', 'c', 'a'])

    useWorkspace.setState({ layoutFrozen: true })
    const finalLayout = savedLayout(store())
    expect(finalLayout.tabs.map((tab) => tab.id)).toEqual(['b', 'sibling', 'c', 'a'])
    store().updateTab(a.id, { title: '退出期间的更新' })
    expect(api.saveLayout).toHaveBeenCalledTimes(1)
    expect(finalLayout.tabs.find((tab) => tab.id === a.id)?.title).toBe('A')
    useWorkspace.setState({ layoutFrozen: false })
    expect(api.saveLayout).toHaveBeenCalledTimes(2)
    expect(api.saveLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: a.id, title: '退出期间的更新' }),
        ]),
      }),
    )
    useWorkspace.setState({ layoutFrozen: false })
    expect(api.saveLayout).toHaveBeenCalledTimes(2)

    const fresh = { ...a, id: 'fresh' }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [path],
          layout: { ...saved, tabs: [{ ...saved.tabs[0], id: 'lost' }, ...saved.tabs] },
        },
        sessions: [...original, fresh].map((tab) => ({
          id: tab.id,
          workspaceId: tab.workspaceId,
          projectPath: path,
          cwd: path,
          workspaceKind: 'local' as const,
          kind: tab === b ? ('agent' as const) : ('shell' as const),
          provider: tab === b ? ('pi' as const) : undefined,
          cols: 80,
          rows: 24,
          exited: false,
        })),
      },
    })
    await store().bootstrap()
    expect(store().tabs.map((tab) => tab.id)).toEqual(['b', 'sibling', 'c', 'a', 'fresh'])
    expect(store().tabs[0]).toMatchObject({ title: 'Pi', kind: 'agent', provider: 'pi' })
    expect(store().activeTabs[workspace.id]).toBe(a.id)
    expect(api.createTerminal).not.toHaveBeenCalled()
    expect(api.attachTerminal).not.toHaveBeenCalled()
    expect(api.closeTerminal).not.toHaveBeenCalled()
  })

  it('does not overwrite the saved layout when bootstrap fails', async () => {
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ok: false, error: 'Host 不可用' })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState()).toMatchObject({
      ready: true,
      layoutLoaded: false,
      bootstrapError: 'Host 不可用',
    })
    expect(console.error).toHaveBeenCalledWith(new Error('Host 不可用'))
    expect(api.saveLayout).not.toHaveBeenCalled()
  })

  it('restores project grouping and saves collapse changes without disturbing terminal or workspace state', async () => {
    const id = crypto.randomUUID()
    const grouping = {
      groups: [{ id, name: '公司项目', projects: ['/tmp/中文 项目'], collapsed: false }],
    }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: ['/tmp/中文 项目'],
          projectGrouping: grouping,
        },
        sessions: [],
      },
    })
    await useWorkspace.getState().bootstrap()
    expect(useWorkspace.getState().projectGrouping).toEqual(grouping)
    await useWorkspace.getState().openProject()
    const before = useWorkspace.getState()
    const collapsed = { ...grouping, groups: [{ ...grouping.groups[0], collapsed: true }] }
    let finish!: (result: Result<typeof grouping>) => void
    vi.mocked(api.changeProjectGrouping).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const saving = before.changeProjectGrouping({ type: 'collapse', id, collapsed: true })
    expect(useWorkspace.getState().updatingProjectGrouping).toBe(true)
    await expect(
      useWorkspace.getState().changeProjectGrouping({ type: 'remove', id }),
    ).rejects.toThrow('正在保存')
    finish({ ok: true, value: collapsed })
    await saving
    expect(useWorkspace.getState().projectGrouping).toEqual(collapsed)
    expect(useWorkspace.getState()).toMatchObject({
      selectedProject: before.selectedProject,
      selectedWorkspaces: before.selectedWorkspaces,
      activeTabs: before.activeTabs,
    })
    expect(useWorkspace.getState().workspaces).toBe(before.workspaces)
    expect(useWorkspace.getState().tabs).toBe(before.tabs)
    vi.mocked(api.changeProjectGrouping).mockResolvedValueOnce({ ok: false, error: '写入失败' })
    await expect(
      useWorkspace.getState().changeProjectGrouping({ type: 'remove', id }),
    ).rejects.toThrow('写入失败')
    expect(useWorkspace.getState().projectGrouping).toEqual(collapsed)
    expect(useWorkspace.getState().updatingProjectGrouping).toBe(false)
    expect(api.closeTerminal).not.toHaveBeenCalled()
  })
})

it('restores live Host sessions and selection without recreating lost terminals', async () => {
  const { path, workspace, live, agent, other, orphan, buffered } = await restoreAgentWorkspace()
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
})
