import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { terminalPaneIds } from '../../../src/shared/terminal-layout'
import {
  currentWorkspace,
  terminalTabs,
  useWorkspace,
} from '../../../src/renderer/src/state/workspace'
import type { TerminalTab } from '../../../src/renderer/src/state/workspace'

import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'
import { gitFileKey } from '../../../src/shared/source-control'

describe('Terminal tabs and split panes', () => {
  it('shares one tab across split panes, persists layout and closes or reopens groups safely', async () => {
    const store = () => useWorkspace.getState()
    const splitShortcuts = ['split-terminal', 'split-terminal-down'] as const
    await store().bootstrap()
    for (const shortcut of splitShortcuts) store().shortcut(shortcut)
    expect(store().tabs).toHaveLength(0)
    await store().openProject()
    const a = store().tabs[0]
    for (const shortcut of splitShortcuts) store().shortcut(shortcut)
    expect(store().tabs).toHaveLength(1)
    store().updateTab(a.id, { status: 'running' })
    useSourceControl.getState().openChanges(a.workspaceId)
    for (const shortcut of splitShortcuts) store().shortcut(shortcut)
    expect(store().tabs).toHaveLength(1)
    useSourceControl.getState().update(a.workspaceId, { changesOpen: false, changesActive: false })
    store().selectTab(a.id)
    store().shortcut('split-terminal')
    const b = store().tabs[1]
    expect(b).toMatchObject({ workspaceId: a.workspaceId, cwd: a.cwd, status: 'starting' })
    expect(store().activeTabs[a.workspaceId]).toBe(b.id)
    const order = () => useSourceControl.getState().sessions[a.workspaceId]!.tabOrder
    expect(terminalTabs(store()).map((tab) => tab.id)).toEqual([a.id])
    expect(order()).toEqual([`terminal:${a.id}`])
    expect(store().terminalLayouts[0]).toMatchObject({
      id: a.id,
      activePaneId: b.id,
      root: { type: 'split', direction: 'horizontal', ratio: 0.5 },
    })
    expect(terminalPaneIds(store().terminalLayouts[0].root)).toEqual([a.id, b.id])
    const root = store().terminalLayouts[0].root.id
    store().resizeTerminalSplit(root, 0.63)
    store().resizeTerminalSplit(root, NaN)
    store().resizeTerminalSplit(root, 0)
    store().updateTab(b.id, { status: 'running' })
    store().selectTab(a.id)
    store().shortcut('split-terminal-down')
    const c = store().tabs[2]
    store().updateTab(c.id, { status: 'running' })
    const layout = structuredClone(store().terminalLayouts)
    expect(layout[0]).toMatchObject({
      activePaneId: c.id,
      root: {
        ratio: 0.63,
        children: [
          {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [{ id: a.id }, { id: c.id }],
          },
          { id: b.id },
        ],
      },
    })
    expect(store().activeTabs[a.workspaceId]).toBe(c.id)
    expect(terminalPaneIds(layout[0].root)).toEqual([a.id, c.id, b.id])
    expect(order()).toEqual([`terminal:${a.id}`])
    expect(vi.mocked(api.saveLayout).mock.calls.at(-1)![0].terminalLayouts).toEqual(layout)

    useWorkspace.setState({ removingWorkspace: a.workspaceId })
    store().splitTerminal(a.id)
    useWorkspace.setState({ removingWorkspace: undefined, creatingWorktree: true })
    store().splitTerminal(a.id)
    useWorkspace.setState({ creatingWorktree: false })
    expect(store().tabs).toHaveLength(3)
    store().selectTab(a.id)
    vi.mocked(api.closeTerminal).mockImplementationOnce(() => {
      try {
        store().shortcut('close-terminal')
        expect(api.closeTerminal).toHaveBeenCalledExactlyOnceWith(a.id)
        vi.mocked(api.onTerminal).mock.calls.at(-1)![0]({
          type: 'closing',
          id: a.id,
          closing: true,
        })
        expect(store().activeTabs[a.workspaceId]).toBe(c.id)
        throw new Error('cleanup failed')
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    store().shortcut('close-terminal')
    await vi.waitFor(() =>
      expect(store().tabs.find((tab) => tab.id === a.id)).toMatchObject({
        error: '关闭失败：cleanup failed',
        closingStatus: undefined,
      }),
    )
    expect(store().terminalLayouts[0].root).toEqual(layout[0].root)
    expect(store().activeTabs[a.workspaceId]).toBe(a.id)
    store().shortcut('close-terminal')
    await vi.waitFor(() =>
      expect(terminalPaneIds(store().terminalLayouts[0].root)).toEqual([c.id, b.id]),
    )
    expect(vi.mocked(api.closeTerminal).mock.calls.map(([id]) => id)).toEqual([a.id, a.id])
    expect(order()).toEqual([`terminal:${a.id}`])
    expect(terminalTabs(store()).map((tab) => tab.id)).toEqual([a.id])
    expect(useSourceControl.getState().sessions[a.workspaceId]!.closedTabs).toEqual([])
    expect(store().activeTabs[a.workspaceId]).toBe(c.id)
    const persisted = structuredClone(vi.mocked(api.saveLayout).mock.calls.at(-1)![0])
    vi.mocked(api.bootstrap).mockResolvedValueOnce({
      ok: true,
      value: {
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          recentProjects: [a.projectPath],
          layout: persisted,
        },
        sessions: store().tabs.map((tab) => ({
          id: tab.id,
          projectPath: tab.projectPath,
          workspaceId: tab.workspaceId,
          cwd: tab.cwd!,
          workspaceKind: 'local' as const,
          kind: 'shell' as const,
          cols: 80,
          rows: 24,
          exited: false,
        })),
      },
    })
    await store().bootstrap()
    expect(store().terminalLayouts).toEqual(persisted.terminalLayouts)
    const d = store().newTerminal()!
    store().updateTab(d, { status: 'running' })
    store().selectWorkspaceTab(a.workspaceId, `terminal:${a.id}`)
    expect(store().activeTabs[a.workspaceId]).toBe(c.id)
    expect(order()).toEqual([`terminal:${a.id}`, `terminal:${d}`])
    store().selectTab(b.id)
    expect(order()).toEqual([`terminal:${a.id}`, `terminal:${d}`])
    store().reorderTab(a.workspaceId, a.id, 1)
    expect(order()).toEqual([`terminal:${d}`, `terminal:${a.id}`])
    vi.mocked(api.closeTerminal).mockImplementationOnce(async () => {
      expect(store().closingTerminalTabs).toEqual([a.id])
      store().splitTerminal(c.id)
      expect(store().tabs).toHaveLength(3)
      await store().closeTab(a.id)
      return { ok: true, value: false }
    })
    await store().closeTab(a.id)
    expect(store().tabs).toHaveLength(3)
    expect(store().closingTerminalTabs).toEqual([])
    expect(useSourceControl.getState().sessions[a.workspaceId]!.closedTabs).toEqual([])
    await store().closeTab(a.id)
    expect(store().terminalLayouts).toEqual([])
    expect(store().activeTabs[a.workspaceId]).toBe(d)
    expect(store().tabs.map((tab) => tab.id)).toEqual([d])
    expect(useSourceControl.getState().sessions[a.workspaceId]!.closedTabs).toMatchObject([
      { kind: 'terminal-group' },
    ])
    store().reopenTab()
    expect(store().tabs).toHaveLength(3)
    const reopened = store().terminalLayouts[0]
    const reopenedIds = terminalPaneIds(reopened.root)
    expect(reopenedIds).toHaveLength(2)
    expect(reopenedIds.some((id) => [c.id, b.id].includes(id))).toBe(false)
    expect(store().activeTabs[a.workspaceId]).toBe(reopened.activePaneId)
    expect(terminalTabs(store())).toHaveLength(2)
    expect(order()).toEqual([`terminal:${d}`, `terminal:${reopened.id}`])
    for (const id of reopenedIds) store().updateTab(id, { status: 'running' })
    store().selectTab(reopenedIds[0])
    store().shortcut('close-terminal')
    await vi.waitFor(() =>
      expect(store().tabs.some((tab) => tab.id === reopenedIds[0])).toBe(false),
    )
    expect(terminalTabs(store()).map((tab) => tab.id)).toEqual([d, reopened.id])
    expect(store().terminalLayouts[0].root).toEqual({ type: 'terminal', id: reopenedIds[1] })
    store().selectWorkspaceTab(a.workspaceId, `terminal:${reopened.id}`)
    expect(store().activeTabs[a.workspaceId]).toBe(reopenedIds[1])
    store().shortcut('close-terminal')
    await vi.waitFor(() => expect(store().terminalLayouts).toEqual([]))
    expect(store().tabs.map((tab) => tab.id)).toEqual([d])
    expect(api.closeWindow).not.toHaveBeenCalled()
  })

  it('prioritizes unread indicators only when activating a split terminal tab', async () => {
    const store = () => useWorkspace.getState()
    await store().openProject()
    const a = store().tabs[0]
    store().updateTab(a.id, { status: 'running' })
    store().splitTerminal(a.id)
    const b = store().tabs[1]
    store().splitTerminal(a.id, 'vertical')
    const c = store().tabs[2]
    const layout = store().terminalLayouts[0]
    const outside = store().newTerminal()!
    const key = `terminal:${layout.id}`
    const agent: NonNullable<TerminalTab['agent']> = {
      terminalId: a.id,
      projectPath: a.projectPath,
      workspaceId: a.workspaceId,
      cwd: a.cwd!,
      revision: 1,
      unread: true,
      launchId: crypto.randomUUID(),
      provider: 'codex',
      runtimeState: 'running',
      activityState: 'working',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      eventSource: 'process',
      observability: 'unavailable',
    }
    const working = { agent }
    const needsInput = { agent: { ...agent, activityState: 'needs-input' as const } }
    const completed = { shellActivity: 'idle' as const, shellUnread: true }
    const succeeded = {
      agent: { ...agent, activityState: 'completed' as const, outcome: 'success' as const },
    }
    const failed = {
      agent: { ...agent, activityState: 'failed' as const, outcome: 'failure' as const },
    }
    const error = { ...working, status: 'error' as const }
    const running = { shellActivity: 'running' as const }
    expect(terminalPaneIds(layout.root)).toEqual([a.id, c.id, b.id])
    const cases: [string, Partial<TerminalTab>[], string, string][] = [
      ['error before failure', [failed, error, succeeded], a.id, b.id],
      ['failure before success', [succeeded, failed, completed], a.id, b.id],
      ['success before completion', [completed, succeeded, needsInput], a.id, b.id],
      ['completion before input', [needsInput, completed, working], a.id, b.id],
      ['input before working', [working, needsInput, running], a.id, b.id],
      ['same state keeps focus', [completed, completed, completed], b.id, b.id],
      ['same state uses layout order', [working, completed, completed], a.id, c.id],
      [
        'read success is skipped',
        [{ agent: { ...succeeded.agent, unread: false } }, needsInput, working],
        a.id,
        b.id,
      ],
      [
        'read failure is skipped',
        [{ agent: { ...failed.agent, unread: false } }, needsInput, working],
        a.id,
        b.id,
      ],
      ['read error is skipped', [{ ...error, errorRead: true }, needsInput, working], a.id, b.id],
      [
        'read shell completion is skipped',
        [{ ...completed, shellUnread: false }, needsInput, working],
        a.id,
        b.id,
      ],
      [
        'closing pane is skipped',
        [{ ...error, closingStatus: 'running' }, needsInput, working],
        a.id,
        b.id,
      ],
      ['working does not override focus', [working, running, {}], c.id, c.id],
      [
        'interrupted does not override focus',
        [{ agent: { ...agent, activityState: 'interrupted' } }, running, {}],
        c.id,
        c.id,
      ],
      ['missing focus uses first pane', [{}, {}, {}], 'removed', a.id],
      ['missing focus still prioritizes status', [{}, needsInput, {}], 'removed', b.id],
    ]
    for (const [name, patches, focused, expected] of cases) {
      useWorkspace.setState({
        tabs: [a, b, c]
          .map((tab, index): TerminalTab => ({
            ...tab,
            status: 'running',
            ...patches[index],
            ...(patches[index].agent
              ? { agent: { ...patches[index].agent, terminalId: tab.id } }
              : {}),
          }))
          .concat({ ...a, id: outside, status: 'running' }),
        terminalLayouts: [{ ...layout, activePaneId: focused }],
      })
      store().selectTab(outside)
      store().selectWorkspaceTab(a.workspaceId, key)
      expect(store().activeTabs[a.workspaceId], name).toBe(expected)
      expect(store().terminalLayouts[0].activePaneId, name).toBe(expected)
    }

    store().selectTab(a.id)
    store().selectWorkspaceTab(a.workspaceId, key)
    expect(store().activeTabs[a.workspaceId]).toBe(a.id)
    useSourceControl.getState().openChanges(a.workspaceId)
    store().selectWorkspaceTab(a.workspaceId, key)
    expect(store().activeTabs[a.workspaceId]).toBe(b.id)
    store().selectTab(a.id)
    expect(store().activeTabs[a.workspaceId]).toBe(a.id)
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
    expect(useSourceControl.getState().sessions[b.workspaceId]!.closedTabs).toEqual([])
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
    expect(useSourceControl.getState().sessions[b.workspaceId]!.closedTabs).toEqual([])
    await useWorkspace.getState().closeTab(b.id)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useWorkspace.getState().activeTabs[b.workspaceId]).toBe(a.id)

    const store = () => useWorkspace.getState()
    const scm = useSourceControl.getState()
    const id = a.workspaceId
    const session = () => useSourceControl.getState().sessions[id]
    store().newTerminal()
    const middle = store().tabs.at(-1)!
    store().newTerminal()
    const right = store().tabs.at(-1)!
    for (const tab of [a, middle, right]) store().updateTab(tab.id, { status: 'running' })
    store().selectTab(a.id)
    await store().closeTab(a.id)
    expect(store().activeTabs[id]).toBe(middle.id)

    const diff = { path: 'neighbor.ts', area: 'unstaged' as const }
    store().openDiff(id, diff)
    scm.pinDiff(id)
    scm.openChanges(id)
    scm.update(id, { file: 'preview.ts', preview: true })
    store().reorderTab(id, right.id, 3)
    expect(session()!.tabOrder).toEqual([
      `terminal:${middle.id}`,
      `diff:${gitFileKey(diff)}`,
      'changes',
      `terminal:${right.id}`,
      'preview',
    ])
    store().selectWorkspaceTab(id, 'changes')
    await store().closeTab(middle.id)
    expect(session()!.changesActive).toBe(true)
    store().selectWorkspaceTab(id, `diff:${gitFileKey(diff)}`)
    store().closeWorkspaceTab(id, `diff:${gitFileKey(diff)}`)
    expect(session()).toMatchObject({ changesActive: true, activePinnedDiff: undefined })
    store().shortcut('close-terminal')
    expect(store().activeTabs[id]).toBe(right.id)
    expect(session()).toMatchObject({ changesActive: false, preview: false })
    store().selectWorkspaceTab(id, 'preview')
    store().closeWorkspaceTab(id, 'preview')
    expect(store().activeTabs[id]).toBe(right.id)
    expect(session()!.preview).toBe(false)

    scm.openChanges(id)
    scm.update(id, { file: 'last-preview.ts', preview: true })
    store().selectTab(right.id)
    await store().closeTab(right.id)
    expect(store().tabs).toEqual([])
    expect(currentWorkspace(store())?.id).toBe(id)
    expect(session()!.changesActive).toBe(true)
    store().closeWorkspaceTab(id, 'changes')
    expect(session()!.preview).toBe(true)
    store().closeWorkspaceTab(id, 'preview')
    expect(session()!.tabOrder).toEqual([])
    expect(store().selectedProject).toBeUndefined()
  })

  it('keeps the pre-close presentation until confirmation, then removes the tab before cleanup finishes', async () => {
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
    const onTerminal = vi.mocked(api.onTerminal).mock.calls.at(-1)![0]
    onTerminal({ type: 'closing', id: tab.id, closing: true })
    expect(useWorkspace.getState().tabs).toEqual([])
    expect(useWorkspace.getState().activeTabs).toEqual({})
    expect(useWorkspace.getState().selectedProject).toBeUndefined()
    expect(currentWorkspace(useWorkspace.getState())).toBeUndefined()
    expect(useWorkspace.getState().projects).toEqual([tab.projectPath])
    expect(useWorkspace.getState().workspaces[0].id).toBe(tab.workspaceId)
    await useWorkspace.getState().closeTab(tab.id)
    expect(api.closeTerminal).toHaveBeenCalledOnce()
    await useWorkspace.getState().selectProject(tab.projectPath, tab.workspaceId)
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useWorkspace.getState().tabs[0].id).not.toBe(tab.id)
    expect(currentWorkspace(useWorkspace.getState())?.id).toBe(tab.workspaceId)
    finish({ ok: true, value: true })
    await closing
    expect(useWorkspace.getState().tabs).toHaveLength(1)
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
      useSourceControl.getState().openChanges(tab.workspaceId)
      useWorkspace.getState().selectTab(tab.id)
      vi.mocked(api.closeTerminal).mockImplementationOnce(() => {
        try {
          if (outcome === 'rejected') {
            const onTerminal = vi.mocked(api.onTerminal).mock.calls.at(-1)![0]
            onTerminal({ type: 'closing', id: tab.id, closing: true })
            expect(useWorkspace.getState().tabs).toEqual([])
            onTerminal({ type: 'exit', id: tab.id, attachmentId: 'closing-view', exitCode: 1 })
            throw new Error('清理失败')
          }
          useWorkspace.getState().updateTab(tab.id, { status: 'exited', exitCode: 1 })
          return Promise.resolve({ ok: true, value: false })
        } catch (cause) {
          return Promise.reject(cause)
        }
      })
      await useWorkspace.getState().closeTab(tab.id)
      expect(useWorkspace.getState().tabs[0]).toMatchObject({
        status: 'exited',
        exitCode: 1,
        closingStatus: undefined,
      })
      expect(useWorkspace.getState().activeTabs[tab.workspaceId]).toBe(tab.id)
      expect(currentWorkspace(useWorkspace.getState())?.id).toBe(tab.workspaceId)
      expect(useSourceControl.getState().sessions[tab.workspaceId]!.tabOrder).toEqual([
        `terminal:${tab.id}`,
        'changes',
      ])
      expect(useSourceControl.getState().sessions[tab.workspaceId]!.closedTabs).toEqual([])
      expect(useSourceControl.getState().sessions[tab.workspaceId]!.changesActive).toBe(false)
      if (outcome === 'cancelled') expect(console.error).not.toHaveBeenCalled()
      else expect(console.error).toHaveBeenCalled()
    },
  )
})
