import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopAPI } from '../../../src/shared/contracts'
import { MAX_TERMINALS } from '../../../src/shared/contracts'
import { currentWorkspace, useWorkspace } from '../../../src/renderer/src/state/workspace'
import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'
import { gitFileKey } from '../../../src/shared/source-control'
import { explorerRows, useFileExplorer } from '../../../src/renderer/src/state/file-explorer-store'
import type { FileEntry } from '../../../src/shared/file-explorer'

describe('File and Git diff previews', () => {
  it('reuses Git diff previews and keeps pinned diffs independent of previews and terminals', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const id = currentWorkspace(store())!.id
    const scm = useSourceControl.getState()
    const session = () => useSourceControl.getState().sessions[id]
    const first = { path: 'first.ts', area: 'unstaged' as const }
    const second = { path: 'second.ts', area: 'unstaged' as const }
    const staged = { ...second, area: 'staged' as const }
    const terminals = store().tabs
    scm.update(id, { draft: 'keep draft' })
    store().openDiff(id, first)
    store().openDiff(id, second)
    expect(session()).toMatchObject({ selection: second, preview: true, pinnedDiffs: [] })
    scm.pinDiff(id)
    scm.pinDiff(id)
    expect(session()).toMatchObject({
      selection: undefined,
      preview: false,
      activePinnedDiff: second,
      pinnedDiffs: [second],
    })
    store().openDiff(id, first)
    expect(session()).toMatchObject({
      selection: first,
      preview: true,
      activePinnedDiff: undefined,
    })
    store().openDiff(id, second)
    expect(session()).toMatchObject({ selection: first, preview: false, activePinnedDiff: second })
    store().openDiff(id, staged)
    scm.pinDiff(id)
    expect(session()!.pinnedDiffs).toEqual([second, staged])
    store().openDiff(id, first)
    scm.openChanges(id)
    expect(session()!.tabOrder).toEqual([
      `terminal:${terminals[0].id}`,
      `diff:${gitFileKey(second)}`,
      `diff:${gitFileKey(staged)}`,
      'preview',
      'changes',
    ])
    store().shortcut('tab-2')
    expect(session()).toMatchObject({
      activePinnedDiff: second,
      changesActive: false,
      preview: false,
    })
    store().shortcut('tab-4')
    expect(session()).toMatchObject({
      selection: first,
      preview: true,
      activePinnedDiff: undefined,
    })
    store().shortcut('tab-3')
    store().shortcut('close-terminal')
    expect(session()).toMatchObject({
      pinnedDiffs: [second],
      activePinnedDiff: undefined,
      selection: first,
    })
    store().shortcut('tab-2')
    scm.closeChanges(id)
    scm.update(id, { selection: undefined, preview: false })
    expect(session()!.activePinnedDiff).toEqual(second)
    scm.update(id, { file: 'plain.ts', preview: true })
    expect(session()).toMatchObject({
      activePinnedDiff: undefined,
      file: 'plain.ts',
      preview: true,
    })
    scm.pinDiff(id)
    expect(session()!.pinnedDiffs).toEqual([second])
    store().openDiff(id, second)
    scm.showTerminal(id)
    expect(session()).toMatchObject({ activePinnedDiff: undefined, pinnedDiffs: [second] })
    store().openDiff(id, second)
    scm.update(id, {
      status: {
        rootPath: '/tmp/repo',
        branch: 'main',
        head: null,
        ahead: 0,
        behind: 0,
        indexVersion: 'fixture',
        entries: [],
      },
    })
    expect(session()).toMatchObject({
      activePinnedDiff: second,
      pinnedDiffs: [second],
      draft: 'keep draft',
    })
    store().openDiff('other-workspace', first)
    scm.pinDiff('other-workspace')
    scm.closePinnedDiff('other-workspace', gitFileKey(first))
    expect(session()!.pinnedDiffs).toEqual([second])
    store().shortcut('close-terminal')
    expect(session()).toMatchObject({
      pinnedDiffs: [],
      activePinnedDiff: undefined,
      file: 'plain.ts',
    })
    expect(store().tabs).toBe(terminals)
    expect(api.closeTerminal).not.toHaveBeenCalled()

    scm.openChanges(id)
    store().newTerminal('pi')
    const added = store().tabs.at(-1)!
    const order = [`terminal:${terminals[0].id}`, 'preview', 'changes', `terminal:${added.id}`]
    expect(session()!.tabOrder).toEqual(order)
    const stableOrder = session()!.tabOrder
    store().selectTab(terminals[0].id)
    scm.update(id, { preview: true })
    scm.openChanges(id)
    expect(session()!.tabOrder).toBe(stableOrder)
    store().shortcut('tab-4')
    expect(store().activeTabs[id]).toBe(added.id)
    expect(session()!.changesActive).toBe(false)
    store().shortcut('tab-2')
    expect(session()!.preview).toBe(true)

    store().reorderTab(id, added.id, 0)
    expect(session()!.tabOrder).toEqual([order[3], ...order.slice(0, 3)])
    expect(store().tabs.map((tab) => tab.id)).toEqual([added.id, terminals[0].id])
    store().shortcut('tab-3')
    expect(session()!.preview).toBe(true)
    store().openDiff(id, first)
    scm.pinDiff(id)
    expect(session()!.tabOrder).toEqual([
      order[3],
      order[0],
      `diff:${gitFileKey(first)}`,
      'changes',
    ])
    scm.closePinnedDiff(id, gitFileKey(first))
    store().openDiff(id, first)
    scm.pinDiff(id)
    expect(session()!.tabOrder.at(-1)).toBe(`diff:${gitFileKey(first)}`)
    scm.update(id, { file: 'new-preview.ts', preview: true })
    expect(session()!.tabOrder.at(-1)).toBe('preview')
    scm.closeChanges(id)
    scm.openChanges(id)
    expect(session()!.tabOrder.at(-1)).toBe('changes')
    expect(useSourceControl.getState().sessions['other-workspace']!.tabOrder).toEqual([])
    store().updateTab(added.id, { status: 'running' })
    await store().closeTab(added.id)
    expect(session()!.tabOrder).not.toContain(`terminal:${added.id}`)
  })

  it('pins ordinary file previews without replacing fixed tabs and restores them after closing', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const id = currentWorkspace(store())!.id
    const scm = useSourceControl.getState()
    const session = () => useSourceControl.getState().sessions[id]
    const terminals = store().tabs
    const first = 'src/first.ts'
    const second = 'src/second.ts'
    const third = 'src/third.ts'
    const diff = { path: first, area: 'unstaged' as const }

    store().openFile(id, first)
    store().openFile(id, second)
    expect(session()).toMatchObject({ file: second, preview: true, pinnedFiles: [] })
    scm.pinFile(id)
    scm.pinFile(id)
    expect(session()).toMatchObject({
      file: undefined,
      preview: false,
      pinnedFiles: [second],
      activePinnedFile: second,
    })
    expect(session()!.tabOrder).toEqual([`terminal:${terminals[0].id}`, `file:${second}`])
    store().openFile(id, first)
    scm.pinFile(id)
    store().openFile(id, third)
    store().openFile(id, second)
    scm.pinFile(id)
    expect(session()).toMatchObject({
      file: third,
      preview: false,
      pinnedFiles: [second, first],
      activePinnedFile: second,
    })
    expect(session()!.tabOrder).toEqual([
      `terminal:${terminals[0].id}`,
      `file:${second}`,
      `file:${first}`,
      'preview',
    ])

    store().shortcut('tab-4')
    expect(session()).toMatchObject({ file: third, preview: true, activePinnedFile: undefined })
    store().shortcut('tab-3')
    expect(session()).toMatchObject({ preview: false, activePinnedFile: first })
    store().openDiff(id, diff)
    scm.pinDiff(id)
    expect(session()).toMatchObject({ activePinnedFile: undefined, activePinnedDiff: diff })
    store().openFile(id, first)
    expect(session()).toMatchObject({ activePinnedFile: first, activePinnedDiff: undefined })
    scm.openChanges(id)
    expect(session()).toMatchObject({ changesActive: true, activePinnedFile: undefined })
    store().shortcut('tab-2')
    expect(session()).toMatchObject({ changesActive: false, activePinnedFile: second })
    store().shortcut('tab-1')
    expect(session()).toMatchObject({ activePinnedFile: undefined, pinnedFiles: [second, first] })
    store().shortcut('tab-2')
    store().shortcut('close-terminal')
    expect(session()).toMatchObject({ pinnedFiles: [first], activePinnedFile: first })
    expect(session()!.tabOrder).not.toContain(`file:${second}`)
    expect(session()!.closedTabs.at(-1)).toEqual({ kind: 'file', path: second })
    store().shortcut('reopen-tab')
    expect(session()).toMatchObject({ pinnedFiles: [first, second], activePinnedFile: second })
    expect(session()!.tabOrder.at(-1)).toBe(`file:${second}`)
    store().shortcut('close-terminal')
    store().openFile(id, second)
    scm.pinFile(id)
    store().shortcut('reopen-tab')
    expect(session()!.pinnedFiles).toEqual([first, second])
    expect(session()!.closedTabs).toEqual([])

    store().openFile('other-workspace', first)
    scm.pinFile('other-workspace')
    scm.closePinnedFile('other-workspace', first)
    expect(session()!.pinnedFiles).toEqual([first, second])
    expect(store().tabs).toBe(terminals)
    expect(api.closeTerminal).not.toHaveBeenCalled()

    store().openFile(id, third)
    store().openDiff('other-workspace', diff)
    scm.showTerminal('other-workspace')
    const order = session()!.tabOrder
    const disabled = { ...store().preferences, reusePreviewTabs: false }
    vi.mocked(api.savePreferences).mockResolvedValueOnce({ ok: false, error: '保存失败' })
    await expect(store().savePreferences(disabled)).rejects.toThrow('保存失败')
    expect(store().preferences.reusePreviewTabs).toBe(true)
    expect(session()).toMatchObject({ file: third, preview: true })
    await store().savePreferences(disabled)
    expect(session()).toMatchObject({
      file: undefined,
      preview: false,
      pinnedFiles: [first, second, third],
      activePinnedFile: third,
    })
    expect(session()!.tabOrder).toEqual(
      order.map((key) => (key === 'preview' ? `file:${third}` : key)),
    )
    expect(useSourceControl.getState().sessions['other-workspace']).toMatchObject({
      selection: undefined,
      preview: false,
      pinnedDiffs: [diff],
      activePinnedDiff: undefined,
    })
    store().openFile(id, 'fourth.ts')
    store().openFile(id, 'fifth.ts')
    store().openFile(id, 'fourth.ts')
    expect(session()).toMatchObject({
      preview: false,
      pinnedFiles: [first, second, third, 'fourth.ts', 'fifth.ts'],
      activePinnedFile: 'fourth.ts',
    })
    const staged = { ...diff, area: 'staged' as const }
    store().openDiff(id, staged)
    store().openDiff(id, diff)
    store().openDiff(id, staged)
    expect(session()).toMatchObject({
      preview: false,
      pinnedDiffs: [diff, staged],
      activePinnedDiff: staged,
      activePinnedFile: undefined,
    })
    expect(session()!.tabOrder).not.toContain('preview')
    await store().savePreferences({ ...store().preferences, reusePreviewTabs: true })
    store().openFile(id, 'sixth.ts')
    store().openFile(id, 'seventh.ts')
    expect(session()).toMatchObject({
      preview: true,
      file: 'seventh.ts',
      pinnedFiles: [first, second, third, 'fourth.ts', 'fifth.ts'],
      pinnedDiffs: [diff, staged],
    })
  })

  it('reopens closed tabs in workspace-local reverse order without reviving terminal identity', async () => {
    const store = () => useWorkspace.getState()
    await store().bootstrap()
    await store().openProject()
    const first = store().tabs[0]
    const id = first.workspaceId
    const scm = useSourceControl.getState()
    const session = () => useSourceControl.getState().sessions[id]
    const diff = { path: 'pinned.ts', area: 'staged' as const }
    const preview = {
      path: 'review.ts',
      area: 'review' as const,
      base: null,
      head: 'a'.repeat(40),
      label: 'snapshot',
      status: 'A',
      submodule: false,
    }
    scm.update(id, { file: 'plain.ts', preview: true, draft: 'keep draft' })
    scm.closePreview(id)
    store().openDiff(id, diff)
    scm.pinDiff(id)
    scm.closePinnedDiff(id, gitFileKey(diff))
    store().openDiff(id, preview)
    store().shortcut('close-terminal')
    scm.openChanges(id)
    scm.closeChanges(id)
    store().newTerminal('pi')
    const agent = store().tabs.at(-1)!
    store().updateTab(agent.id, { status: 'exited', exitCode: 1, error: 'old failure' })
    await store().closeTab(agent.id)
    expect(session()!.closedTabs.map((tab) => tab.kind)).toEqual([
      'preview',
      'diff',
      'preview',
      'changes',
      'terminal',
    ])

    await store().newWorkspace(first.projectPath)
    const other = currentWorkspace(store())!.id
    const before = store().tabs
    store().shortcut('reopen-tab')
    expect(store().tabs).toBe(before)
    await store().selectProject(first.projectPath, id)
    const history = session()!.closedTabs
    for (const busy of [{ removingWorkspace: id }, { creatingWorktree: true }]) {
      useWorkspace.setState(busy)
      store().shortcut('reopen-tab')
      expect(session()!.closedTabs).toBe(history)
      useWorkspace.setState({ removingWorkspace: undefined, creatingWorktree: false })
    }
    const tabs = store().tabs
    const activeTabs = store().activeTabs
    while (store().tabs.length < MAX_TERMINALS) store().newTerminal()
    store().shortcut('reopen-tab')
    expect(session()!.closedTabs).toBe(history)
    useWorkspace.setState({ tabs, activeTabs })

    store().shortcut('reopen-tab')
    const restored = store().tabs.at(-1)!
    expect(restored).toMatchObject({
      workspaceId: id,
      cwd: first.projectPath,
      kind: 'agent',
      provider: 'pi',
      title: agent.title,
      status: 'starting',
    })
    expect(restored.id).not.toBe(agent.id)
    expect(restored.launchId).not.toBe(agent.launchId)
    expect(restored.exitCode).toBeUndefined()
    expect(restored.error).toBeUndefined()
    expect(restored.agent).toBeUndefined()
    expect(session()!.tabOrder.at(-1)).toBe(`terminal:${restored.id}`)
    store().shortcut('reopen-tab')
    expect(session()!.changesActive).toBe(true)
    store().shortcut('reopen-tab')
    expect(session()).toMatchObject({ selection: preview, preview: true })
    store().shortcut('reopen-tab')
    expect(session()).toMatchObject({
      pinnedDiffs: [diff],
      activePinnedDiff: diff,
      selection: preview,
    })
    store().shortcut('reopen-tab')
    expect(session()).toMatchObject({
      file: 'plain.ts',
      preview: true,
      draft: 'keep draft',
      closedTabs: [],
    })
    const unchanged = store()
    store().shortcut('reopen-tab')
    expect(store()).toBe(unchanged)
    expect(useSourceControl.getState().sessions[other]!.closedTabs).toEqual([])

    // Non-terminal tabs keep the workspace open after its last terminal closes.
    store().updateTab(restored.id, { status: 'running' })
    await store().closeTab(restored.id)
    store().updateTab(first.id, { status: 'running' })
    await store().closeTab(first.id)
    expect(currentWorkspace(store())?.id).toBe(id)
    expect(session()!.preview).toBe(true)
    store().shortcut('reopen-tab')
    expect(currentWorkspace(store())?.id).toBe(id)
    expect(store().tabs.at(-1)).toMatchObject({
      title: first.title,
      cwd: first.projectPath,
      status: 'starting',
    })
    expect(store().tabs.at(-1)!.id).not.toBe(first.id)

    for (let index = 0; index < 25; index++) {
      scm.openChanges(id)
      scm.closeChanges(id)
    }
    expect(session()!.closedTabs).toHaveLength(20)
    await store().removeWorkspace(id)
    const remaining = store().tabs
    store().shortcut('reopen-tab')
    expect(store().tabs).toBe(remaining)
    expect(store().tabs.some((tab) => tab.workspaceId === id)).toBe(false)
  })

  it('isolates workspace file loads, coalesces refreshes and keeps file and diff previews exclusive', async () => {
    const pending: ((entries: FileEntry[]) => void)[] = []
    const listFiles = vi.fn<DesktopAPI['listFiles']>(
      () =>
        new Promise((resolve) => {
          pending.push((value) => resolve({ ok: true, value }))
        }),
    )
    api.listFiles = listFiles
    const a = { projectPath: '/a', workspaceId: 'a' }
    const b = { projectPath: '/b', workspaceId: 'b' }
    const files = [{ name: 'src', path: 'src', kind: 'directory' as const }]
    const first = useFileExplorer.getState().load(a, '')
    await useFileExplorer.getState().load(a, '')
    const second = useFileExplorer.getState().load(b, '')
    expect(listFiles).toHaveBeenCalledTimes(2)
    pending[1]([{ name: 'b.txt', path: 'b.txt', kind: 'file' }])
    await second
    pending[0](files)
    await first
    expect(listFiles).toHaveBeenCalledTimes(3)
    pending[2](files)
    await vi.waitFor(() =>
      expect(useFileExplorer.getState().sessions.a!.directories['']!.loading).toBe(false),
    )
    expect(useFileExplorer.getState().sessions.b!.directories['']!.entries?.[0].name).toBe('b.txt')
    useFileExplorer
      .getState()
      .update('a', { expanded: { src: true }, selected: 'src', scrollTop: 42 })
    const child = useFileExplorer.getState().load(a, 'src')
    pending[3]([{ name: 'child.ts', path: 'src/child.ts', kind: 'file' }])
    await child
    expect(
      explorerRows(useFileExplorer.getState().sessions.a!).map((entry) => [
        entry.path,
        entry.depth,
      ]),
    ).toEqual([
      ['src', 0],
      ['src/child.ts', 1],
    ])
    const loadedDirectories = useFileExplorer.getState().sessions.a!.directories
    useFileExplorer.getState().update('a', {
      directories: {
        ...loadedDirectories,
        '': { entries: [{ ...files[0], empty: true }] },
      },
    })
    expect(explorerRows(useFileExplorer.getState().sessions.a!).map((entry) => entry.path)).toEqual(
      ['src'],
    )
    useFileExplorer.getState().update('a', { directories: loadedDirectories })
    listFiles.mockRejectedValueOnce(new Error('permission denied'))
    await useFileExplorer.getState().load(a, '')
    expect(useFileExplorer.getState().sessions.a!).toMatchObject({
      scrollTop: 42,
      selected: 'src',
      expanded: { src: true },
      directories: { '': { entries: files, error: 'permission denied' } },
    })
    const deleted = useFileExplorer.getState().load(a, '')
    useFileExplorer.setState({ sessions: {} })
    pending[4](files)
    await deleted
    expect(useFileExplorer.getState().sessions).toEqual({})
    const scm = useSourceControl.getState()
    scm.update('a', {
      selection: { path: 'old', area: 'unstaged' },
      preview: true,
      draft: 'keep draft',
    })
    scm.update('a', { file: 'src/child.ts', preview: true })
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: 'src/child.ts',
      selection: undefined,
      changesOpen: false,
      preview: true,
      draft: 'keep draft',
    })
    scm.showTerminal('a')
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: 'src/child.ts',
      preview: false,
    })
    scm.openChanges('a')
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: 'src/child.ts',
      preview: false,
      changesOpen: true,
      changesActive: true,
    })
    scm.update('a', { file: 'src/child.ts', preview: true })
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: 'src/child.ts',
      preview: true,
      changesOpen: true,
      changesActive: false,
    })
    scm.closeChanges('a')
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: 'src/child.ts',
      preview: true,
      changesOpen: false,
      changesActive: false,
    })
    scm.openChanges('a')
    scm.update('a', { selection: { path: 'git', area: 'staged' }, preview: true })
    expect(useSourceControl.getState().sessions.a!).toMatchObject({
      file: undefined,
      selection: { path: 'git', area: 'staged' },
      preview: true,
      changesOpen: true,
      changesActive: false,
    })
  })
})
