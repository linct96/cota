import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI, Result } from '../src/shared/contracts'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import { useWorkspace } from '../src/renderer/src/store'

let api: DesktopAPI
beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  api = {
    bootstrap: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { config: structuredClone(DEFAULT_CONFIG) } }),
    openProject: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/中文 项目' }),
    selectProject: vi.fn().mockResolvedValue({ ok: true }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, value: true }),
    savePreferences: vi.fn(async (value) => ({ ok: true as const, value })),
    closeTerminal: vi.fn().mockResolvedValue({ ok: true, value: true }),
    closeWindow: vi.fn(),
    onShortcut: vi.fn(() => vi.fn()),
    onTerminal: vi.fn(() => vi.fn()),
    createTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    acknowledge: vi.fn(),
  }
  vi.stubGlobal('window', { desktop: api })
})
afterEach(() => vi.unstubAllGlobals())

describe('workspace state', () => {
  it('opens and deduplicates projects; cancellation changes nothing', async () => {
    await useWorkspace.getState().bootstrap()
    await useWorkspace.getState().openProject()
    await useWorkspace.getState().openProject()
    expect(useWorkspace.getState().projects).toEqual(['/tmp/中文 项目'])
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: null })
    await useWorkspace.getState().openProject()
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/中文 项目')
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
    expect(useWorkspace.getState().activeTabs[b.projectPath]).toBe(a.id)
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
      expect(useWorkspace.getState().activeTabs[tab.projectPath]).toBe(tab.id)
      expect(useWorkspace.getState().error).toBe(outcome === 'cancelled' ? undefined : '清理失败')
    },
  )
  it('caps tabs and exposes invalid project errors without changing the current project', async () => {
    await useWorkspace.getState().openProject()
    for (let i = 0; i < 11; i++) useWorkspace.getState().newTerminal()
    expect(useWorkspace.getState().tabs).toHaveLength(10)
    expect(useWorkspace.getState().error).toContain('10')
    vi.mocked(api.selectProject).mockResolvedValueOnce({ ok: false, error: '项目目录不可访问' })
    await useWorkspace.getState().selectProject('/missing')
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/中文 项目')
    expect(useWorkspace.getState().error).toContain('不可访问')
  })
  it('keeps project state and terminals unchanged when deletion is cancelled or fails', async () => {
    await useWorkspace.getState().openProject()
    useWorkspace.getState().newTerminal()
    const before = useWorkspace.getState()
    vi.mocked(api.removeProject).mockResolvedValueOnce({ ok: true, value: false })
    await useWorkspace.getState().removeProject('/tmp/中文 项目')
    expect(useWorkspace.getState()).toMatchObject({
      projects: before.projects,
      tabs: before.tabs,
      activeTabs: before.activeTabs,
      selectedProject: before.selectedProject,
      removingProject: undefined,
    })
    vi.mocked(api.removeProject).mockResolvedValueOnce({ ok: false, error: '终端清理失败' })
    await useWorkspace.getState().removeProject('/tmp/中文 项目')
    expect(useWorkspace.getState().tabs).toEqual(before.tabs)
    expect(useWorkspace.getState().projects).toEqual(before.projects)
    expect(useWorkspace.getState().error).toBe('终端清理失败')
    expect(useWorkspace.getState().removingProject).toBeUndefined()
    expect(api.closeTerminal).not.toHaveBeenCalled()
  })
  it('removes all project tabs only after Main confirms success and keeps other projects', async () => {
    await useWorkspace.getState().selectProject('/tmp/other')
    useWorkspace.getState().newTerminal()
    const other = useWorkspace.getState().tabs[0]
    await useWorkspace.getState().openProject()
    useWorkspace.getState().newTerminal()
    useWorkspace.getState().newTerminal()
    let finish!: (result: { ok: true; value: boolean }) => void
    vi.mocked(api.removeProject).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const removing = useWorkspace.getState().removeProject('/tmp/中文 项目')
    await useWorkspace.getState().removeProject('/tmp/中文 项目')
    useWorkspace.getState().shortcut('new-terminal')
    await useWorkspace.getState().selectProject('/tmp/blocked')
    expect(api.removeProject).toHaveBeenCalledOnce()
    expect(useWorkspace.getState().tabs).toHaveLength(3)
    finish({ ok: true, value: true })
    await removing
    expect(useWorkspace.getState().tabs).toEqual([other])
    expect(useWorkspace.getState().activeTabs).toEqual({ '/tmp/other': other.id })
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/other')
    expect(useWorkspace.getState().projects).toEqual(['/tmp/other'])
    await useWorkspace.getState().removeProject('/tmp/other')
    expect(useWorkspace.getState().selectedProject).toBeUndefined()
    expect(useWorkspace.getState().tabs).toEqual([])
  })
  it('removes a background project without changing the current selection', async () => {
    await useWorkspace.getState().openProject()
    await useWorkspace.getState().selectProject('/tmp/current')
    await useWorkspace.getState().removeProject('/tmp/中文 项目')
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/current')
  })
  it('keeps a project outside recent history reachable after removing the selected project', async () => {
    await useWorkspace.getState().selectProject('/tmp/old')
    useWorkspace.getState().newTerminal()
    await useWorkspace.getState().openProject()
    useWorkspace.setState({ projects: ['/tmp/中文 项目'] })
    await useWorkspace.getState().removeProject('/tmp/中文 项目')
    expect(useWorkspace.getState().selectedProject).toBe('/tmp/old')
  })
})
