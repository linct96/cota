import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopAPI,
  Result,
  CreateWorktreeResult,
  WorktreeScan,
} from '../src/shared/contracts'
import { DEFAULT_CONFIG, MAX_TERMINALS } from '../src/shared/contracts'
import { terminalPaneIds } from '../src/shared/terminal-layout'
import {
  isTerminalMenuShortcut,
  shortcutBinding,
  validateShortcutBindings,
} from '../src/shared/shortcuts'
import {
  currentWorkspace,
  nextWorkspaceName,
  terminalTabs,
  useWorkspace,
  type TerminalTab,
} from '../src/renderer/src/store'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/headless'
import { createTerminalKeyboardState } from '../src/shared/terminal-keyboard-state'
import { createTerminalRenderer } from '../src/renderer/src/lib/terminal-renderer'
import { createTerminalInputHandler } from '../src/renderer/src/lib/terminal-input'
import { useSourceControl } from '../src/renderer/src/lib/source-control-store'
import { createSourceControlRefreshQueue } from '../src/renderer/src/lib/source-control-refresh'
import { buildGitChangeTree, gitChangeRows } from '../src/renderer/src/lib/source-control-tree'
import { gitFileKey, type GitChange } from '../src/shared/source-control'
import { useRightPanel } from '../src/renderer/src/lib/right-panel-store'
import { explorerRows, useFileExplorer } from '../src/renderer/src/lib/file-explorer-store'
import type { FileEntry } from '../src/shared/file-explorer'
import {
  agentIndicatorState,
  agentTabState,
  workspaceTerminalSummary as workspaceAgentSummary,
  terminalIndicatorState,
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
  useFileExplorer.setState(useFileExplorer.getInitialState(), true)
  api = {
    initialAppearance: { theme: 'system', windowBlur: false },
    readClipboard: vi.fn(),
    writeClipboard: vi.fn(),
    setShortcutRecording: vi.fn(),
    setTerminalInputFocused: vi.fn(),
    inspectAgentClis: vi.fn(),
    installAgentCli: vi.fn(),
    accounts: {
      list: vi.fn(),
      add: vi.fn(),
      importCurrent: vi.fn(),
      importCortana: vi.fn(),
      switch: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      reorder: vi.fn(),
      startOAuth: vi.fn(),
      cancelOAuth: vi.fn(),
      onOAuth: vi.fn(() => vi.fn()),
    },
    platform: 'darwin',
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
    listFiles: vi.fn(),
    readFile: vi.fn(),
    fileAction: vi.fn(),
    watchFiles: vi.fn(() => vi.fn()),
    gitStatus: vi.fn(),
    watchGit: vi.fn(() => vi.fn()),
    gitDiff: vi.fn(),
    gitMutate: vi.fn(),
    generateCommitMessage: vi.fn(),
    cancelCommitMessage: vi.fn(),
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
    worktreeSetupConfig: vi.fn(),
    saveWorktreeSetupConfig: vi.fn(),
    inspectWorktreeSetup: vi.fn(),
    startWorktreeSetup: vi.fn(),
    stopWorktreeSetup: vi.fn(),
    listWorkspaceOpeners: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    openWorkspaceWith: vi.fn().mockResolvedValue({ ok: true }),
    removeWorkspace: vi.fn().mockResolvedValue({ ok: true, value: true }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, value: true }),
    getDefaultShell: vi.fn().mockResolvedValue({ ok: true, value: '/bin/zsh' }),
    savePreferences: vi.fn(async (value) => ({ ok: true as const, value })),
    sendTestNotification: vi.fn().mockResolvedValue({ ok: true }),
    openNotificationSettings: vi.fn().mockResolvedValue({ ok: true }),
    chooseNotificationSound: vi.fn(),
    onNotificationSound: vi.fn(() => vi.fn()),
    closeTerminal: vi.fn().mockResolvedValue({ ok: true, value: true }),
    stopService: vi.fn().mockResolvedValue({ ok: true }),
    openService: vi.fn().mockResolvedValue({ ok: true }),
    closeWindow: vi.fn(),
    forceExitApp: vi.fn(),
    minimizeWindow: vi.fn(),
    toggleMaximizeWindow: vi.fn(),
    isWindowMaximized: vi.fn().mockResolvedValue({ ok: true, value: false }),
    onWindowMaximized: vi.fn(() => vi.fn()),
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
  it('runs quick commands only in their scoped workspace and never saves or replays startup text', async () => {
    await useWorkspace.getState().bootstrap()
    const value = managedWorktree()
    const local = {
      id: crypto.randomUUID(),
      projectPath: value.record.projectPath,
      name: '本地',
      kind: 'local' as const,
    }
    const scan = scanFor(value)
    useWorkspace.setState({
      projects: [value.record.projectPath],
      workspaces: [local, value.workspace],
      worktreeScans: { [value.record.projectPath]: scan },
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        quickCommands: [
          {
            id: 'dev',
            name: '开发服务',
            command: 'pnpm dev',
            scope: { type: 'project', projectPath: value.record.projectPath },
          },
          { id: 'global', name: '全局', command: 'git status', scope: { type: 'global' } },
          {
            id: 'other',
            name: '其他项目',
            command: 'false',
            scope: { type: 'project', projectPath: '/tmp/other' },
          },
        ],
      },
    })
    const store = () => useWorkspace.getState()
    store().runQuickCommand('dev', value.workspace.id)
    const tab = store().tabs[0]
    expect(tab).toMatchObject({
      workspaceId: value.workspace.id,
      cwd: value.record.path,
      title: '开发服务',
      startupCommand: 'pnpm dev',
      status: 'starting',
    })
    expect(store().activeTabs[value.workspace.id]).toBe(tab.id)
    expect(store().recentQuickCommands[value.workspace.id]).toBe('dev')
    expect(vi.mocked(api.saveLayout).mock.calls.at(-1)![0].tabs[0]).not.toHaveProperty(
      'startupCommand',
    )
    store().updateTab(tab.id, { status: 'running', startupCommand: undefined })
    await store().closeTab(tab.id)
    store().reopenTab()
    expect(store().tabs[0].id).not.toBe(tab.id)
    expect(store().tabs[0].startupCommand).toBeUndefined()
    store().runQuickCommand('global', local.id)
    expect(store().tabs.at(-1)).toMatchObject({
      workspaceId: local.id,
      cwd: value.record.projectPath,
      startupCommand: 'git status',
    })
    const before = store().tabs
    expect(() => store().runQuickCommand('other', local.id)).toThrow('不属于当前项目')
    expect(() => store().runQuickCommand('deleted', local.id)).toThrow('快捷命令不存在')
    scan.entries[0].status = 'missing'
    expect(() => store().runQuickCommand('dev', value.workspace.id)).toThrow('不可用')
    useWorkspace.setState({ removingWorkspace: local.id })
    expect(() => store().runQuickCommand('global', local.id)).toThrow('正在关闭')
    expect(store().tabs).toBe(before)
    useWorkspace.setState({
      removingWorkspace: undefined,
      tabs: Array.from({ length: MAX_TERMINALS }, () => ({
        ...before[0],
        id: crypto.randomUUID(),
      })),
    })
    expect(() => store().runQuickCommand('global', local.id)).toThrow('最多保留 10 个终端')
    expect(api.writeTerminal).not.toHaveBeenCalled()
    scan.entries[0].status = 'ready'
    useWorkspace.setState({
      tabs: [],
      preferences: {
        ...store().preferences,
        quickCommands: store().preferences.quickCommands.map((entry) =>
          entry.id === 'dev'
            ? { ...entry, mode: 'service' as const, port: 'auto' as const }
            : entry,
        ),
      },
    })
    store().runQuickCommand('dev', value.workspace.id)
    const service = store().tabs[0]
    expect(service.service).toEqual({ commandId: 'dev', name: '开发服务' })
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().tabs).toHaveLength(1)
    store().updateTab(service.id, { status: 'running' })
    store().runQuickCommand('dev', local.id)
    expect(store().tabs).toHaveLength(2)
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().activeTabs[value.workspace.id]).toBe(service.id)
    expect(store().tabs).toHaveLength(2)
    store().updateTab(service.id, { status: 'exited' })
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().tabs).toHaveLength(3)
    expect(store().tabs.at(-1)!.id).not.toBe(service.id)
  })
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
    const history = useSourceControl.getState().sessions[value.workspace.id].closedTabs
    const scan = scanFor(value)
    scan.entries[0].status = 'missing'
    useWorkspace.setState({ worktreeScans: { [value.record.projectPath]: scan } })
    state.shortcut('reopen-tab')
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useSourceControl.getState().sessions[value.workspace.id].closedTabs).toBe(history)
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
  it('routes modified Enter once without submitting IME input or writing to inactive sessions', async () => {
    vi.useFakeTimers()
    const screen = new Terminal({
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
    })
    const keyboard = createTerminalKeyboardState(screen.parser)
    const replies: string[] = []
    screen.onData((data) => replies.push(data))
    const output = async (data: string) => {
      const parsed = new Promise<void>((resolve) => screen.write(data, resolve))
      await vi.runAllTimersAsync()
      await parsed
    }
    const expectFlags = async (flags: number) => {
      await output('\x1b[?u')
      expect(replies.at(-1)).toBe(`\x1b[?${flags}u`)
      expect(keyboard.flags).toBe(flags)
    }
    let running = true
    const write = vi.fn()
    const input = createTerminalInputHandler({
      platform: 'darwin',
      canSend: () => running,
      write,
      getKittyFlags: () => keyboard.flags,
      textarea: { value: '' },
    })
    type KeyEvent = Parameters<typeof input.handleKeyEvent>[0]
    const key = (overrides: Partial<KeyEvent> = {}): KeyEvent => ({
      type: 'keydown',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: vi.fn(),
      ...overrides,
    })
    const expectMenuShortcuts = () => {
      const shortcuts: Partial<KeyEvent>[] = [
        ...[
          'o',
          't',
          'd',
          'w',
          ',',
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          'a',
          'x',
          'c',
          'v',
          'z',
          'q',
          'h',
          'm',
        ].map((key) => ({ key })),
        { key: 'Z', shiftKey: true },
        { key: 'T', code: 'KeyT', shiftKey: true },
        { key: 'D', code: 'KeyD', shiftKey: true },
        { key: '˙', code: 'KeyH', altKey: true },
      ]
      for (const shortcut of shortcuts) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const event = key({
            code: '',
            keyCode: 0,
            shiftKey: false,
            metaKey: true,
            ...shortcut,
            type,
          })
          expect(input.handleKeyEvent(event)).toBe(false)
          expect(event.preventDefault).not.toHaveBeenCalled()
        }
      }
      expect(
        input.handleKeyEvent(key({ key: 'w', shiftKey: false, metaKey: true, repeat: true })),
      ).toBe(false)
      for (const modifiers of [
        { metaKey: false, ctrlKey: true, shiftKey: false },
        { metaKey: true, ctrlKey: true, shiftKey: false },
        { metaKey: true, altKey: true, shiftKey: false },
        { metaKey: true, shiftKey: true },
      ])
        expect(input.handleKeyEvent(key({ key: 'w', code: 'KeyW', ...modifiers }))).toBe(true)
      expect(
        input.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: false })),
      ).toBe(true)
    }
    try {
      for (const platform of ['darwin', 'win32', 'linux']) {
        const editKey = (value: string, shiftKey = false) =>
          key({
            key: value,
            code: `Key${value.toUpperCase()}`,
            shiftKey,
            metaKey: platform === 'darwin',
            ctrlKey: platform !== 'darwin',
          })
        const remapped = { copy: 'CommandOrControl+Shift+B', paste: '', 'select-all': '' }
        for (const value of ['c', 'v', 'a']) {
          expect(isTerminalMenuShortcut(editKey(value), {}, platform)).toBe(true)
          expect(isTerminalMenuShortcut(editKey(value), remapped, platform)).toBe(true)
        }
        expect(isTerminalMenuShortcut(editKey('b', true), remapped, platform)).toBe(true)
        expect(isTerminalMenuShortcut(editKey('v', true), remapped, platform)).toBe(false)
        for (const value of ['x', 'z', 't', ','])
          expect(isTerminalMenuShortcut(editKey(value), remapped, platform)).toBe(false)
        const onShortcut = vi.fn()
        const clipboardInput = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 0,
          textarea: { value: '' },
          getShortcuts: () => remapped,
          onShortcut,
        })
        for (const type of ['keydown', 'keypress', 'keyup'])
          clipboardInput.handleKeyEvent({ ...editKey('b', true), type })
        expect(onShortcut).toHaveBeenCalledExactlyOnceWith('copy')
        clipboardInput.dispose()
        expect(shortcutBinding({}, 'toggle-right-panel', platform)).toBe('CommandOrControl+L')
        expect(shortcutBinding({ paste: '' }, 'paste', platform)).toBe('')
        expect(() =>
          validateShortcutBindings(
            {
              'toggle-right-panel': 'Shift+CommandOrControl+P',
              'new-terminal': 'CommandOrControl+Shift+P',
            },
            platform,
          ),
        ).toThrow('“新建终端”与“展开 / 收起右侧面板”的快捷键冲突。')
        const bindings = validateShortcutBindings(
          { 'toggle-right-panel': 'CommandOrControl+P' },
          platform,
        )
        let configured = false
        const panelInput = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 1,
          textarea: { value: '' },
          getShortcuts: () => (configured ? bindings : {}),
        })
        for (const value of ['l', 'p']) {
          for (const type of ['keydown', 'keypress', 'keyup'])
            expect(
              panelInput.handleKeyEvent(
                key({
                  key: value,
                  code: `Key${value.toUpperCase()}`,
                  type,
                  shiftKey: false,
                  metaKey: platform === 'darwin',
                  ctrlKey: platform !== 'darwin',
                }),
              ),
            ).toBe(false)
          configured = true
        }
        panelInput.dispose()
      }
      expectMenuShortcuts()
      for (const platform of ['win32', 'linux']) {
        const other = createTerminalInputHandler({
          platform,
          canSend: () => running,
          write,
          getKittyFlags: () => 1,
          textarea: { value: '' },
        })
        expect(other.handleKeyEvent(key({ key: 'w', shiftKey: false, metaKey: true }))).toBe(true)
        expect(other.handleKeyEvent(key({ key: 'w', shiftKey: false, ctrlKey: true }))).toBe(true)
        expect(
          other.handleKeyEvent(key({ key: 'd', code: 'KeyD', shiftKey: false, ctrlKey: true })),
        ).toBe(true)
        expect(other.handleKeyEvent(key({ key: 'c', ctrlKey: true }))).toBe(platform !== 'win32')
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const reopen = key({ key: 'T', code: 'KeyT', ctrlKey: true, type })
          expect(other.handleKeyEvent(reopen)).toBe(false)
          expect(reopen.preventDefault).not.toHaveBeenCalled()
        }
        expect(other.handleKeyEvent(key({ key: 't', ctrlKey: true, shiftKey: false }))).toBe(true)
        other.dispose()
      }
      expect(input.handleKeyEvent(key({ shiftKey: false }))).toBe(true)
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const)
        expect(input.handleKeyEvent(key({ [modifier]: true }))).toBe(true)
      expect(input.handleKeyEvent(key({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false)
      expect(write).not.toHaveBeenCalled()

      const shiftEnter = key()
      expect(input.handleKeyEvent(shiftEnter)).toBe(false)
      expect(shiftEnter.preventDefault).toHaveBeenCalledOnce()
      expect(input.handleKeyEvent(key({ type: 'keypress' }))).toBe(false)
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(false)
      expect(input.handleKeyEvent(key({ type: 'keyup', shiftKey: false }))).toBe(false)
      expect(write.mock.calls).toEqual([['\x1b\r']])

      input.compositionStart()
      const confirm = key({ shiftKey: false, isComposing: true })
      expect(input.handleKeyEvent(confirm)).toBe(false)
      expect(confirm.preventDefault).not.toHaveBeenCalled()
      input.compositionEnd()
      expect(input.handleKeyEvent(key({ type: 'keyup' }))).toBe(false)
      expect(input.handleKeyEvent(key())).toBe(false)
      input.send('中文')
      vi.runAllTimers()
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(false)
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(input.handleKeyEvent(key())).toBe(false)
      expect(write.mock.calls).toEqual([['\x1b\r'], ['中文'], ['\x1b\r']])

      input.reset()
      expect(input.handleKeyEvent(key({ isComposing: true }))).toBe(false)
      input.reset()
      expect(input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))).toBe(false)
      input.reset()
      running = false
      input.send('late input')
      input.handleKeyEvent(key())
      expect(write).toHaveBeenCalledTimes(3)
      running = true
      input.compositionEnd()
      input.reset()
      expect(vi.getTimerCount()).toBe(0)
      input.send('resumed')
      expect(write.mock.calls).toEqual([['\x1b\r'], ['中文'], ['\x1b\r'], ['resumed']])

      await output('\x1b[>7') // Pi negotiation can span PTY output chunks.
      expect(keyboard.flags).toBe(0)
      await output('u')
      await expectFlags(7)
      expectMenuShortcuts()
      expect(input.handleKeyEvent(key({ shiftKey: false }))).toBe(true)
      const nativeShiftEnter = key()
      expect(input.handleKeyEvent(nativeShiftEnter)).toBe(true)
      expect(nativeShiftEnter.preventDefault).not.toHaveBeenCalled()
      expect(input.handleKeyEvent(key({ type: 'keypress' }))).toBe(true)
      expect(input.handleKeyEvent(key({ repeat: true }))).toBe(true)
      expect(input.handleKeyEvent(key({ type: 'keyup' }))).toBe(true)
      expect(write).toHaveBeenCalledTimes(4)
      input.reset() // Focus changes must not erase the CLI's negotiated mode.
      expect(keyboard.flags).toBe(7)
      input.compositionStart()
      expect(input.handleKeyEvent(key({ isComposing: true }))).toBe(false)
      input.compositionEnd()
      input.handleKeyEvent(key({ type: 'keyup' }))
      vi.runAllTimers()
      await output('\x1b[=1;3u')
      await expectFlags(6)
      await output('\x1b[=1;2u\x1b[=0;4u')
      await expectFlags(7)
      await output('\x1b[>3u\x1b[<u')
      await expectFlags(7)
      await output('\x1b[<u')
      await expectFlags(0)
      input.handleKeyEvent(key())
      expect(write).toHaveBeenLastCalledWith('\x1b\r')
      await output('\x1b[>1u\x1b[?1049h\x1b[>7u\x1b[!p')
      await expectFlags(0)
      expect(screen.buffer.active.type).toBe('alternate')
      await output('\x1b[?1049l')
      await expectFlags(0)
      await output('\x1b[>7u'.repeat(20) + '\x1b[<65535u')
      await expectFlags(0)
      await output('\x1b[>7u\x1b[?1049h\x1bc')
      await expectFlags(0)
      expect(screen.buffer.active.type).toBe('normal')
      input.compositionEnd()
      input.dispose()
      vi.runAllTimers()
      input.send('disposed input')
      expect(input.handleKeyEvent(key())).toBe(false)
      expect(write).toHaveBeenCalledTimes(5)
    } finally {
      input.dispose()
      keyboard.dispose()
      screen.dispose()
      vi.useRealTimers()
    }
  })

  it('routes native text commits once, preserving composition order, Kitty releases and cancellation', () => {
    vi.useFakeTimers()
    let flags = 0
    let running = true
    const textarea = { value: '' }
    const write = vi.fn()
    const input = createTerminalInputHandler({
      platform: 'darwin',
      canSend: () => running,
      write,
      getKittyFlags: () => flags,
      textarea,
    })
    type KeyEvent = Parameters<typeof input.handleKeyEvent>[0]
    const key = (overrides: Partial<KeyEvent> = {}): KeyEvent => ({
      type: 'keydown',
      key: '.',
      code: 'Period',
      keyCode: 190,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: vi.fn(),
      ...overrides,
    })
    const commit = (data: string, overrides = {}) => {
      textarea.value += data
      const event = {
        inputType: 'insertText',
        data,
        isComposing: false,
        stopImmediatePropagation: vi.fn(),
        ...overrides,
      }
      input.handleInput(event)
      return event
    }
    const output = () => write.mock.calls.map(([data]) => data).join('')
    try {
      for (const initial of ['', '上次提交']) {
        textarea.value = initial
        for (const process of [false, true]) {
          for (const delayed of [false, true]) {
            const event = key(process ? { key: 'Process', keyCode: 229 } : {})
            expect(input.handleKeyEvent(event)).toBe(false)
            expect(event.preventDefault).not.toHaveBeenCalled()
            expect(textarea.value).toBe('')
            expect(input.handleKeyEvent(key({ ...event, type: 'keypress' }))).toBe(false)
            if (delayed) {
              vi.runAllTimers()
              expect(input.handleKeyEvent(key({ ...event, type: 'keyup' }))).toBe(false)
            }
            expect(commit('。').stopImmediatePropagation).toHaveBeenCalledOnce()
            if (!delayed) input.handleKeyEvent(key({ ...event, type: 'keyup' }))
            expect(textarea.value).toBe('')
          }
        }
      }
      expect(output()).toBe('。'.repeat(8))
      write.mockClear()

      // A claimed printable key can open a real composition instead of committing directly.
      input.handleKeyEvent(key({ key: 'n', code: 'KeyN', keyCode: 78 }))
      input.compositionStart()
      expect(commit('ni', { isComposing: true }).stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      setTimeout(() => input.send(textarea.value), 0) // xterm's deferred composition commit
      input.compositionEnd()
      expect(commit('你').stopImmediatePropagation).not.toHaveBeenCalled()
      textarea.value = '你'
      input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))
      commit('。')
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(output()).toBe('')
      expect(textarea.value).toBe('你')
      vi.runAllTimers()
      expect(output()).toBe('你。')

      write.mockClear()
      input.compositionStart()
      textarea.value = '好'
      input.compositionEnd()
      input.handleKeyEvent(key())
      commit('。')
      const control = key({ key: 'c', code: 'KeyC', ctrlKey: true })
      expect(input.handleKeyEvent(control)).toBe(true)
      input.send('好') // xterm finalizes before onKey, then emits the control byte.
      input.flushText()
      input.send('\x03')
      vi.runAllTimers()
      expect(output()).toBe('好。\x03')
      input.reset()

      for (flags of [0, 1, 2, 4, 7, 8, 10, 16, 24, 31]) {
        write.mockClear()
        input.handleKeyEvent(key())
        commit('。')
        input.handleKeyEvent(key({ type: 'keyup' }))
        const press = flags & 8 ? (flags & 16 ? '\x1b[46;;12290u' : '\x1b[46u') : '。'
        expect(output()).toBe(press + (flags & 2 ? '\x1b[46;1:3u' : ''))
      }
      flags = 7
      write.mockClear()
      input.handleKeyEvent(key({ key: '?', code: 'Slash', shiftKey: true }))
      input.handleKeyEvent(key({ key: '/', code: 'Slash', type: 'keyup' }))
      commit('？') // Key release may precede the native commit.
      expect(output()).toBe('？\x1b[47;1:3u')
      write.mockClear()
      input.handleKeyEvent(key())
      commit('。')
      flags = 0 // An exiting CLI must not leak a release report into its successor.
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(output()).toBe('。')

      write.mockClear()
      const letter = key({ key: 'a', code: 'KeyA' })
      input.handleKeyEvent(letter)
      commit('a')
      input.handleKeyEvent(key({ ...letter, repeat: true }))
      commit('a')
      input.handleKeyEvent(key({ ...letter, type: 'keyup' }))
      input.handleKeyEvent(key({ key: 'Process', keyCode: 229 }))
      commit('🙂')
      expect(output()).toBe('aa🙂')
      write.mockClear()
      expect(input.handleKeyEvent(key({ key: 'Dead', code: 'Quote' }))).toBe(true)
      expect(input.handleKeyEvent(key({ key: 'e', code: 'KeyE' }))).toBe(true)
      expect(commit('é').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(key())
      input.reset() // Blur cancels a pending native commit.
      expect(commit('。').stopImmediatePropagation).not.toHaveBeenCalled()
      input.handleKeyEvent(key())
      running = false
      commit('。')
      running = true
      flags = 7
      input.handleKeyEvent(key({ type: 'keyup' }))
      expect(write).not.toHaveBeenCalled()
      input.compositionStart()
      textarea.value = '再'
      input.compositionEnd()
      input.handleKeyEvent(key())
      commit('。')
      input.dispose()
      vi.runAllTimers()
      input.send('late')
      expect(write).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      input.dispose()
      vi.useRealTimers()
    }
  })

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
      preferredOpenerId: 'zed',
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

  it('shows ordinary shell running and unread completion dots without changing Agent indicators', () => {
    const shell = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectPath: '/tmp/project',
      title: 'Shell',
      kind: 'shell' as const,
      status: 'running' as const,
      shellActivity: 'running' as const,
    }
    expect(terminalIndicatorState(shell)).toBe('running')
    expect(workspaceAgentSummary([shell])).toEqual({
      state: 'running',
      count: 1,
      description: '1 个运行中',
    })
    for (const shellActivity of ['unknown', 'idle', undefined] as const) {
      expect(terminalIndicatorState({ ...shell, shellActivity })).toBe('other')
      expect(workspaceAgentSummary([{ ...shell, shellActivity }])).toBeUndefined()
    }
    for (const status of ['starting', 'exited', 'error'] as const)
      expect(terminalIndicatorState({ ...shell, status })).toBe('other')
    expect(terminalIndicatorState({ ...shell, closingStatus: 'running' })).toBe('other')
    expect(terminalIndicatorState({ ...shell, kind: 'agent' })).toBe('other')
    expect(workspaceAgentSummary([shell, { ...shell, kind: 'agent', status: 'error' }])).toEqual({
      state: 'error',
      count: 1,
      description: '1 个连接失败 · 1 个运行中',
    })

    const store = () => useWorkspace.getState()
    const current = () => store().tabs[0]
    useWorkspace.setState({
      workspaces: [
        {
          id: shell.workspaceId,
          projectPath: shell.projectPath,
          name: '工作区',
          kind: 'local',
        },
      ],
      selectedProject: shell.projectPath,
      activeTabs: { [shell.workspaceId]: shell.id },
      tabs: [{ ...shell, shellActivity: undefined }],
    })
    store().updateTab(shell.id, { shellActivity: 'idle' })
    expect(terminalIndicatorState(current())).toBe('other')
    vi.useFakeTimers()
    try {
      store().updateTab(shell.id, { shellActivity: 'running' })
      expect(terminalIndicatorState(current())).toBe('running')
      store().updateTab(shell.id, { shellActivity: 'idle' })
      expect(terminalIndicatorState(current())).toBe('completed')
      expect(workspaceAgentSummary(store().tabs)).toEqual({
        state: 'completed',
        count: 1,
        description: '1 个本轮结束',
      })
      const focused = { ...shell, id: 'focused', shellActivity: 'idle' as const }
      const grouped = terminalTabs({
        tabs: [focused, current()],
        closingTerminalTabs: [],
        terminalLayouts: [
          {
            id: 'group',
            activePaneId: focused.id,
            root: {
              type: 'split',
              id: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              children: [
                { type: 'terminal', id: focused.id },
                { type: 'terminal', id: shell.id },
              ],
            },
          },
        ],
      })[0]
      expect(grouped.indicatorTab).toBe(current())
      vi.advanceTimersByTime(5000)
      expect(current().shellUnread).toBe(true)
      store().setVisibleTerminal(shell.id)
      vi.advanceTimersByTime(1999)
      expect(terminalIndicatorState(current())).toBe('completed')
      store().updateTab(shell.id, { title: 'Shell renamed' })
      vi.advanceTimersByTime(1)
      expect(terminalIndicatorState(current())).toBe('other')
      expect(workspaceAgentSummary(store().tabs)).toBeUndefined()
      store().updateTab(shell.id, { shellActivity: 'idle' })
      expect(terminalIndicatorState(current())).toBe('other')

      store().updateTab(shell.id, { shellActivity: 'running' })
      expect(current().shellUnread).toBe(false)
      store().updateTab(shell.id, { shellActivity: 'idle' })
      vi.advanceTimersByTime(1000)
      store().setVisibleTerminal(undefined)
      vi.advanceTimersByTime(3000)
      expect(terminalIndicatorState(current())).toBe('completed')
      store().setVisibleTerminal(shell.id)
      vi.advanceTimersByTime(1000)
      store().updateTab(shell.id, { shellActivity: 'running' })
      vi.advanceTimersByTime(1000)
      expect(terminalIndicatorState(current())).toBe('running')
      store().updateTab(shell.id, { shellActivity: 'idle' })
      vi.advanceTimersByTime(1999)
      expect(terminalIndicatorState(current())).toBe('completed')
      vi.advanceTimersByTime(1)
      expect(terminalIndicatorState(current())).toBe('other')
      expect(api.readAgent).not.toHaveBeenCalled()
    } finally {
      store().setVisibleTerminal(undefined)
      vi.useRealTimers()
    }
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
    const groupIndicator = (background: TerminalTab, focused = store().tabs[0]) =>
      terminalTabs({
        ...store(),
        tabs: [focused, background],
        terminalLayouts: [
          {
            id: 'group',
            activePaneId: focused.id,
            root: {
              type: 'split',
              id: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              children: [
                { type: 'terminal', id: focused.id },
                { type: 'terminal', id: background.id },
              ],
            },
          },
        ],
      })[0]
    for (const background of [working, succeeded, store().tabs[1], failed]) {
      const grouped = groupIndicator(background)
      expect(grouped.indicatorTab).toBe(background)
      expect(grouped).toMatchObject({ id: 'group', kind: 'shell', cwd: other.cwd })
    }
    const focusedAgent = { ...succeeded, id: other.id }
    expect(groupIndicator(working, focusedAgent).indicatorTab).toBe(working)
    expect(groupIndicator(succeeded, focusedAgent).indicatorTab).toBe(focusedAgent)
    expect(groupIndicator(succeeded, { ...store().tabs[0], status: 'error' }).indicatorTab).toBe(
      succeeded,
    )
    for (const background of [
      { ...succeeded, agent: { ...succeeded.agent, unread: false } },
      { ...working, closingStatus: 'running' as const },
      { ...working, agent: { ...buffered, runtimeState: 'exited' as const } },
      { ...working, agent: { ...buffered, activityState: 'idle' as const } },
    ]) {
      expect(groupIndicator(background).indicatorTab).toBe(store().tabs[0])
    }
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
      cwd: path,
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
    expect(useSourceControl.getState().sessions[target.id].changesActive).toBe(true)
    store().shortcut('close-terminal')
    expect(useSourceControl.getState().sessions[target.id]).toMatchObject({
      changesOpen: false,
      changesActive: false,
      draft: 'keep draft',
    })
    expect(store().tabs).toBe(terminalTabs)
    expect(api.closeTerminal).toHaveBeenCalledTimes(closeCalls)
    expect(useSourceControl.getState().sessions[initial.workspaceId]?.changesOpen).not.toBe(true)
    useSourceControl.getState().openChanges(target.id)
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
    scm.openDiff(id, first)
    scm.openDiff(id, second)
    expect(session()).toMatchObject({ selection: second, preview: true, pinnedDiffs: [] })
    scm.pinDiff(id)
    scm.pinDiff(id)
    expect(session()).toMatchObject({
      selection: undefined,
      preview: false,
      activePinnedDiff: second,
      pinnedDiffs: [second],
    })
    scm.openDiff(id, first)
    expect(session()).toMatchObject({
      selection: first,
      preview: true,
      activePinnedDiff: undefined,
    })
    scm.openDiff(id, second)
    expect(session()).toMatchObject({ selection: first, preview: false, activePinnedDiff: second })
    scm.openDiff(id, staged)
    scm.pinDiff(id)
    expect(session().pinnedDiffs).toEqual([second, staged])
    scm.openDiff(id, first)
    scm.openChanges(id)
    expect(session().tabOrder).toEqual([
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
    expect(session().activePinnedDiff).toEqual(second)
    scm.update(id, { file: 'plain.ts', preview: true })
    expect(session()).toMatchObject({
      activePinnedDiff: undefined,
      file: 'plain.ts',
      preview: true,
    })
    scm.pinDiff(id)
    expect(session().pinnedDiffs).toEqual([second])
    scm.openDiff(id, second)
    scm.showTerminal(id)
    expect(session()).toMatchObject({ activePinnedDiff: undefined, pinnedDiffs: [second] })
    scm.openDiff(id, second)
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
    scm.openDiff('other-workspace', first)
    scm.pinDiff('other-workspace')
    scm.closePinnedDiff('other-workspace', gitFileKey(first))
    expect(session().pinnedDiffs).toEqual([second])
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
    expect(session().tabOrder).toEqual(order)
    const stableOrder = session().tabOrder
    store().selectTab(terminals[0].id)
    scm.update(id, { preview: true })
    scm.openChanges(id)
    expect(session().tabOrder).toBe(stableOrder)
    store().shortcut('tab-4')
    expect(store().activeTabs[id]).toBe(added.id)
    expect(session().changesActive).toBe(false)
    store().shortcut('tab-2')
    expect(session().preview).toBe(true)

    store().reorderTab(id, added.id, 0)
    expect(session().tabOrder).toEqual([order[3], ...order.slice(0, 3)])
    expect(store().tabs.map((tab) => tab.id)).toEqual([added.id, terminals[0].id])
    store().shortcut('tab-3')
    expect(session().preview).toBe(true)
    scm.openDiff(id, first)
    scm.pinDiff(id)
    expect(session().tabOrder).toEqual([order[3], order[0], `diff:${gitFileKey(first)}`, 'changes'])
    scm.closePinnedDiff(id, gitFileKey(first))
    scm.openDiff(id, first)
    scm.pinDiff(id)
    expect(session().tabOrder.at(-1)).toBe(`diff:${gitFileKey(first)}`)
    scm.update(id, { file: 'new-preview.ts', preview: true })
    expect(session().tabOrder.at(-1)).toBe('preview')
    scm.closeChanges(id)
    scm.openChanges(id)
    expect(session().tabOrder.at(-1)).toBe('changes')
    expect(useSourceControl.getState().sessions['other-workspace'].tabOrder).toEqual([])
    store().updateTab(added.id, { status: 'running' })
    await store().closeTab(added.id)
    expect(session().tabOrder).not.toContain(`terminal:${added.id}`)
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

    scm.openFile(id, first)
    scm.openFile(id, second)
    expect(session()).toMatchObject({ file: second, preview: true, pinnedFiles: [] })
    scm.pinFile(id)
    scm.pinFile(id)
    expect(session()).toMatchObject({
      file: undefined,
      preview: false,
      pinnedFiles: [second],
      activePinnedFile: second,
    })
    expect(session().tabOrder).toEqual([`terminal:${terminals[0].id}`, `file:${second}`])
    scm.openFile(id, first)
    scm.pinFile(id)
    scm.openFile(id, third)
    scm.openFile(id, second)
    scm.pinFile(id)
    expect(session()).toMatchObject({
      file: third,
      preview: false,
      pinnedFiles: [second, first],
      activePinnedFile: second,
    })
    expect(session().tabOrder).toEqual([
      `terminal:${terminals[0].id}`,
      `file:${second}`,
      `file:${first}`,
      'preview',
    ])

    store().shortcut('tab-4')
    expect(session()).toMatchObject({ file: third, preview: true, activePinnedFile: undefined })
    store().shortcut('tab-3')
    expect(session()).toMatchObject({ preview: false, activePinnedFile: first })
    scm.openDiff(id, diff)
    scm.pinDiff(id)
    expect(session()).toMatchObject({ activePinnedFile: undefined, activePinnedDiff: diff })
    scm.openFile(id, first)
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
    expect(session().tabOrder).not.toContain(`file:${second}`)
    expect(session().closedTabs.at(-1)).toEqual({ kind: 'file', path: second })
    store().shortcut('reopen-tab')
    expect(session()).toMatchObject({ pinnedFiles: [first, second], activePinnedFile: second })
    expect(session().tabOrder.at(-1)).toBe(`file:${second}`)
    store().shortcut('close-terminal')
    scm.openFile(id, second)
    scm.pinFile(id)
    store().shortcut('reopen-tab')
    expect(session().pinnedFiles).toEqual([first, second])
    expect(session().closedTabs).toEqual([])

    scm.openFile('other-workspace', first)
    scm.pinFile('other-workspace')
    scm.closePinnedFile('other-workspace', first)
    expect(session().pinnedFiles).toEqual([first, second])
    expect(store().tabs).toBe(terminals)
    expect(api.closeTerminal).not.toHaveBeenCalled()
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
    scm.openDiff(id, diff)
    scm.pinDiff(id)
    scm.closePinnedDiff(id, gitFileKey(diff))
    scm.openDiff(id, preview)
    store().shortcut('close-terminal')
    scm.openChanges(id)
    scm.closeChanges(id)
    store().newTerminal('pi')
    const agent = store().tabs.at(-1)!
    store().updateTab(agent.id, { status: 'exited', exitCode: 1, error: 'old failure' })
    await store().closeTab(agent.id)
    expect(session().closedTabs.map((tab) => tab.kind)).toEqual([
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
    const history = session().closedTabs
    for (const busy of [{ removingWorkspace: id }, { creatingWorktree: true }]) {
      useWorkspace.setState(busy)
      store().shortcut('reopen-tab')
      expect(session().closedTabs).toBe(history)
      useWorkspace.setState({ removingWorkspace: undefined, creatingWorktree: false })
    }
    const tabs = store().tabs
    const activeTabs = store().activeTabs
    while (store().tabs.length < 10) store().newTerminal()
    store().shortcut('reopen-tab')
    expect(session().closedTabs).toBe(history)
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
    expect(session().tabOrder.at(-1)).toBe(`terminal:${restored.id}`)
    store().shortcut('reopen-tab')
    expect(session().changesActive).toBe(true)
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
    expect(useSourceControl.getState().sessions[other].closedTabs).toEqual([])

    // Non-terminal tabs keep the workspace open after its last terminal closes.
    store().updateTab(restored.id, { status: 'running' })
    await store().closeTab(restored.id)
    store().updateTab(first.id, { status: 'running' })
    await store().closeTab(first.id)
    expect(currentWorkspace(store())?.id).toBe(id)
    expect(session().preview).toBe(true)
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
    expect(session().closedTabs).toHaveLength(20)
    await store().removeWorkspace(id)
    const remaining = store().tabs
    store().shortcut('reopen-tab')
    expect(store().tabs).toBe(remaining)
    expect(store().tabs.some((tab) => tab.workspaceId === id)).toBe(false)
  })

  it('builds sorted Git directory trees without changing file identity or paths', () => {
    const entries: GitChange[] = [
      'README.md',
      'src/components/file10.tsx',
      'src/components/file2.tsx',
      'src/lib/state.ts',
      '__proto__/constructor.txt',
      '中文/空 格\t换行\n.txt',
      'back\\slash.txt',
    ].map((path) => ({ path, area: 'unstaged', status: 'M', submodule: false }))
    entries[1].oldPath = 'old/path.tsx'
    entries[1].stats = { additions: 2, deletions: 1 }
    const original = structuredClone(entries)
    const tree = buildGitChangeTree(entries)
    expect(tree.map((node) => node.kind)).toEqual([
      'directory',
      'directory',
      'directory',
      'file',
      'file',
    ])
    const source = tree.find((node) => node.path === 'src')
    if (source?.kind !== 'directory') throw new Error('Missing src directory')
    expect(source.children.map((node) => node.name)).toEqual(['components', 'lib'])
    const components = source.children[0]
    if (components.kind !== 'directory') throw new Error('Missing components directory')
    expect(components.children.map((node) => node.name)).toEqual(['file2.tsx', 'file10.tsx'])
    expect(components.children[1]).toMatchObject({ kind: 'file', entry: entries[1] })
    expect(source.entries).toEqual(entries.slice(1, 4))
    expect(components.entries).toEqual(entries.slice(1, 3))
    const sibling = { ...entries[0], path: 'src-extra/sibling.ts' }
    const scoped = buildGitChangeTree([...entries, sibling]).find((node) => node.path === 'src')
    if (scoped?.kind !== 'directory') throw new Error('Missing scoped src directory')
    expect(scoped.entries).toEqual(entries.slice(1, 4))
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '__proto__',
        children: [
          expect.objectContaining({
            name: 'constructor.txt',
            entry: entries[4],
          }),
        ],
      }),
    )
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '中文',
        children: [
          expect.objectContaining({
            name: '空 格\t换行\n.txt',
            entry: entries[5],
          }),
        ],
      }),
    )
    const leaves: GitChange[] = []
    const pending = [...tree]
    while (pending.length) {
      const node = pending.pop()!
      if (node.kind === 'directory') {
        expect(node.entries).toEqual(
          entries.filter((entry) => entry.path.startsWith(`${node.path}/`)),
        )
        expect(node.entries.every((entry) => entries.includes(entry))).toBe(true)
        pending.push(...node.children)
      } else leaves.push(node.entry)
    }
    expect(leaves).toHaveLength(entries.length)
    expect(leaves.every((entry) => entries.includes(entry))).toBe(true)
    const rows = gitChangeRows(tree, new Set())
    expect(rows.find((row) => row.key === 'file:src/components/file2.tsx')).toMatchObject({
      node: { entry: entries[2] },
      depth: 2,
      parent: 'directory:src/components',
      position: 1,
      siblings: 2,
    })
    const collapsed = new Set(['src/components'])
    const visible = gitChangeRows(tree, collapsed)
    expect(visible.map((row) => row.node.path)).toEqual(
      rows
        .filter((row) => !row.node.path.startsWith('src/components/'))
        .map((row) => row.node.path),
    )
    expect(visible.find((row) => row.node.path === 'src/lib')?.parent).toBe('directory:src')
    expect(gitChangeRows(tree, new Set(['src'])).map((row) => row.node.path)).not.toContain(
      'src/lib',
    )
    expect(gitChangeRows(tree, new Set())).toEqual(rows)
    expect([...collapsed]).toEqual(['src/components'])
    // 文件替换为目录时，Git 可在同组同时返回删除的文件和新增的子文件。
    const replacement = gitChangeRows(
      buildGitChangeTree([...entries, { ...entries[0], path: 'src' }]),
      new Set(),
    )
    expect(replacement.filter((row) => row.node.path === 'src').map((row) => row.key)).toEqual([
      'directory:src',
      'file:src',
    ])
    expect(new Set(replacement.map((row) => row.key)).size).toBe(replacement.length)
    expect(gitChangeRows([], new Set())).toEqual([])
    expect(entries).toEqual(original)
    expect(buildGitChangeTree([])).toEqual([])
    expect(buildGitChangeTree([entries[0]])).toEqual([
      { kind: 'file', name: 'README.md', path: 'README.md', entry: entries[0] },
    ])

    const compactEntries = [
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
      'packages/app/main.ts',
      'packages/README.md',
      'README.md',
    ].map((path) => ({ path }))
    const compactOriginal = structuredClone(compactEntries)
    const compactTree = buildGitChangeTree(compactEntries)
    expect(compactTree.map((node) => node.name)).toEqual([
      'packages',
      'src/components/ui',
      'README.md',
    ])
    const compactSource = compactTree[1]
    if (compactSource.kind !== 'directory') throw new Error('Missing compact src directory')
    expect(compactSource.path).toBe('src/components/ui')
    expect(compactSource.entries).toEqual(compactEntries.slice(0, 2))
    expect(compactSource.entries[0]).toBe(compactEntries[0])
    expect(compactSource.children.map((node) => node.name)).toEqual(['button.tsx', 'input.tsx'])
    expect(gitChangeRows(compactTree, new Set())).toContainEqual(
      expect.objectContaining({
        key: 'file:src/components/ui/button.tsx',
        node: expect.objectContaining({ entry: compactEntries[0] }),
        depth: 1,
        parent: 'directory:src/components/ui',
        position: 1,
        siblings: 2,
      }),
    )
    const compactCollapsed = gitChangeRows(compactTree, new Set(['src/components/ui']))
    expect(compactCollapsed.map((row) => row.node.path)).toEqual([
      'packages',
      'packages/app',
      'packages/app/main.ts',
      'packages/README.md',
      'src/components/ui',
      'README.md',
    ])
    expect(compactEntries).toEqual(compactOriginal)
  })

  it('coalesces Git refreshes and retains trailing signals across reads and writes', async () => {
    vi.useFakeTimers()
    let visible = true
    let writing = false
    let finish!: () => void
    const read = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const queue = createSourceControlRefreshQueue(read, () => visible && !writing)
    try {
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(read).toHaveBeenCalledTimes(1)
      finish()
      await vi.advanceTimersByTimeAsync(2999)
      expect(read).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(read).toHaveBeenCalledTimes(2)
      finish()
      await vi.advanceTimersByTimeAsync(3000)

      writing = true
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(2)
      writing = false
      queue.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(3)
      finish()
      await vi.advanceTimersByTimeAsync(0)

      queue.request()
      visible = false
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(3)
      visible = true
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(4)
      queue.request()
      queue.cancel()
      finish()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(4)

      queue.request()
      queue.cancel()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(4)
      read.mockRejectedValueOnce(new Error('Git unavailable'))
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      queue.request()
      await vi.advanceTimersByTimeAsync(3000)
      expect(read).toHaveBeenCalledTimes(6)
      finish()
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      queue.cancel()
      vi.useRealTimers()
    }
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

  it('isolates workspace file loads, coalesces refreshes and keeps file and diff previews exclusive', async () => {
    const pending: Array<(entries: FileEntry[]) => void> = []
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
      expect(useFileExplorer.getState().sessions.a.directories[''].loading).toBe(false),
    )
    expect(useFileExplorer.getState().sessions.b.directories[''].entries?.[0].name).toBe('b.txt')
    useFileExplorer
      .getState()
      .update('a', { expanded: { src: true }, selected: 'src', scrollTop: 42 })
    const child = useFileExplorer.getState().load(a, 'src')
    pending[3]([{ name: 'child.ts', path: 'src/child.ts', kind: 'file' }])
    await child
    expect(
      explorerRows(useFileExplorer.getState().sessions.a).map((entry) => [entry.path, entry.depth]),
    ).toEqual([
      ['src', 0],
      ['src/child.ts', 1],
    ])
    listFiles.mockRejectedValueOnce(new Error('permission denied'))
    await useFileExplorer.getState().load(a, '')
    expect(useFileExplorer.getState().sessions.a).toMatchObject({
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
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: 'src/child.ts',
      selection: undefined,
      changesOpen: false,
      preview: true,
      draft: 'keep draft',
    })
    scm.showTerminal('a')
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: 'src/child.ts',
      preview: false,
    })
    scm.openChanges('a')
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: 'src/child.ts',
      preview: false,
      changesOpen: true,
      changesActive: true,
    })
    scm.update('a', { file: 'src/child.ts', preview: true })
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: 'src/child.ts',
      preview: true,
      changesOpen: true,
      changesActive: false,
    })
    scm.closeChanges('a')
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: 'src/child.ts',
      preview: true,
      changesOpen: false,
      changesActive: false,
    })
    scm.openChanges('a')
    scm.update('a', { selection: { path: 'git', area: 'staged' }, preview: true })
    expect(useSourceControl.getState().sessions.a).toMatchObject({
      file: undefined,
      selection: { path: 'git', area: 'staged' },
      preview: true,
      changesOpen: true,
      changesActive: false,
    })
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
    const order = () => useSourceControl.getState().sessions[a.workspaceId].tabOrder
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
    vi.mocked(api.closeTerminal).mockImplementationOnce(async () => {
      store().shortcut('close-terminal')
      expect(api.closeTerminal).toHaveBeenCalledExactlyOnceWith(a.id)
      vi.mocked(api.onTerminal).mock.calls.at(-1)![0]({ type: 'closing', id: a.id, closing: true })
      expect(store().activeTabs[a.workspaceId]).toBe(c.id)
      throw new Error('cleanup failed')
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
    expect(useSourceControl.getState().sessions[a.workspaceId].closedTabs).toEqual([])
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
    expect(useSourceControl.getState().sessions[a.workspaceId].closedTabs).toEqual([])
    await store().closeTab(a.id)
    expect(store().terminalLayouts).toEqual([])
    expect(store().activeTabs[a.workspaceId]).toBe(d)
    expect(store().tabs.map((tab) => tab.id)).toEqual([d])
    expect(useSourceControl.getState().sessions[a.workspaceId].closedTabs).toMatchObject([
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
    expect(useSourceControl.getState().sessions[b.workspaceId].closedTabs).toEqual([])
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
    expect(useSourceControl.getState().sessions[b.workspaceId].closedTabs).toEqual([])
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
    scm.openDiff(id, diff)
    scm.pinDiff(id)
    scm.openChanges(id)
    scm.update(id, { file: 'preview.ts', preview: true })
    store().reorderTab(id, right.id, 3)
    expect(session().tabOrder).toEqual([
      `terminal:${middle.id}`,
      `diff:${gitFileKey(diff)}`,
      'changes',
      `terminal:${right.id}`,
      'preview',
    ])
    store().selectWorkspaceTab(id, 'changes')
    await store().closeTab(middle.id)
    expect(session().changesActive).toBe(true)
    store().selectWorkspaceTab(id, `diff:${gitFileKey(diff)}`)
    store().closeWorkspaceTab(id, `diff:${gitFileKey(diff)}`)
    expect(session()).toMatchObject({ changesActive: true, activePinnedDiff: undefined })
    store().shortcut('close-terminal')
    expect(store().activeTabs[id]).toBe(right.id)
    expect(session()).toMatchObject({ changesActive: false, preview: false })
    store().selectWorkspaceTab(id, 'preview')
    store().closeWorkspaceTab(id, 'preview')
    expect(store().activeTabs[id]).toBe(right.id)
    expect(session().preview).toBe(false)

    scm.openChanges(id)
    scm.update(id, { file: 'last-preview.ts', preview: true })
    store().selectTab(right.id)
    await store().closeTab(right.id)
    expect(store().tabs).toEqual([])
    expect(currentWorkspace(store())?.id).toBe(id)
    expect(session().changesActive).toBe(true)
    store().closeWorkspaceTab(id, 'changes')
    expect(session().preview).toBe(true)
    store().closeWorkspaceTab(id, 'preview')
    expect(session().tabOrder).toEqual([])
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
      vi.mocked(api.closeTerminal).mockImplementationOnce(async () => {
        if (outcome === 'rejected') {
          const onTerminal = vi.mocked(api.onTerminal).mock.calls.at(-1)![0]
          onTerminal({ type: 'closing', id: tab.id, closing: true })
          expect(useWorkspace.getState().tabs).toEqual([])
          onTerminal({ type: 'exit', id: tab.id, attachmentId: 'closing-view', exitCode: 1 })
          throw new Error('清理失败')
        }
        useWorkspace.getState().updateTab(tab.id, { status: 'exited', exitCode: 1 })
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
      expect(useSourceControl.getState().sessions[tab.workspaceId].tabOrder).toEqual([
        `terminal:${tab.id}`,
        'changes',
      ])
      expect(useSourceControl.getState().sessions[tab.workspaceId].closedTabs).toEqual([])
      expect(useSourceControl.getState().sessions[tab.workspaceId].changesActive).toBe(false)
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
