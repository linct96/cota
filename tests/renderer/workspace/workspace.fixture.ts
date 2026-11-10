import { afterEach, beforeEach, vi } from 'vitest'
import type { DesktopAPI } from '../../../src/shared/contracts'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { useWorkspace } from '../../../src/renderer/src/state/workspace'

import { useSourceControl } from '../../../src/renderer/src/state/source-control-store'
import { useRightPanel } from '../../../src/renderer/src/state/right-panel-store'
import { useFileExplorer } from '../../../src/renderer/src/state/file-explorer-store'

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
    system: { homeDirectory: '/Users/test' },
    initialAppearance: { theme: 'system', windowBlur: false },
    readClipboard: vi.fn(),
    writeClipboard: vi.fn(),
    setShortcutRecording: vi.fn(),
    setTerminalInputFocused: vi.fn(),
    inspectAgentClis: vi.fn(),
    openAgentCliInstallGuide: vi.fn(),
    updateAgentCli: vi.fn(),
    listAgentCliInstalls: vi.fn(),
    readAgentCliInstallTerminal: vi.fn(),
    detachAgentCliInstallTerminal: vi.fn(),
    acknowledgeAgentCliInstallTerminal: vi.fn(),
    writeAgentCliInstallTerminal: vi.fn(),
    resizeAgentCliInstallTerminal: vi.fn(),
    onAgentCliInstall: vi.fn(),
    codeHosting: {
      context: vi.fn(),
      accounts: vi.fn(),
      connection: vi.fn(),
      inspect: vi.fn(),
      creationContext: vi.fn(),
      refreshBranches: vi.fn(),
      history: vi.fn(),
      prepare: vi.fn(),
      create: vi.fn(),
      merge: vi.fn(),
      open: vi.fn(),
      clearCreation: vi.fn(),
    },
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
    changeProjectGrouping: vi.fn(),
    selectProject: vi.fn().mockResolvedValue({ ok: true }),
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
    gitBranches: vi.fn(),
    releaseGitBranches: vi.fn().mockResolvedValue({ ok: true }),
    onGitBranchesChanged: vi.fn(() => vi.fn()),
    gitHistory: vi.fn(),
    gitCompare: vi.fn(),
    createGitWorktree: vi.fn(),
    planGitWorktree: vi.fn(),
    workspacePath: vi.fn(),
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
    savePreferences: vi.fn((value) => Promise.resolve({ ok: true as const, value })),
    sendTestNotification: vi.fn().mockResolvedValue({ ok: true }),
    openNotificationSettings: vi.fn().mockResolvedValue({ ok: true }),
    chooseNotificationSound: vi.fn(),
    onNotificationSound: vi.fn(() => vi.fn()),
    onWarning: vi.fn(() => vi.fn()),
    closeTerminal: vi.fn().mockResolvedValue({ ok: true, value: true }),
    stopService: vi.fn().mockResolvedValue({ ok: true }),
    openService: vi.fn().mockResolvedValue({ ok: true }),
    scanWorkspacePorts: vi.fn(),
    stopWorkspacePort: vi.fn(),
    openWorkspacePort: vi.fn(),
    closeWindow: vi.fn(),
    forceExitApp: vi.fn(),
    minimizeWindow: vi.fn(),
    toggleMaximizeWindow: vi.fn(),
    isWindowMaximized: vi.fn().mockResolvedValue({ ok: true, value: false }),
    onWindowMaximized: vi.fn(() => vi.fn()),
    respondToConfirmation: vi.fn().mockResolvedValue({ ok: true }),
    onConfirmation: vi.fn(() => vi.fn()),
    onExitProgress: vi.fn(() => vi.fn()),
    onExitLayoutRequest: vi.fn(() => vi.fn()),
    onShortcut: vi.fn(() => vi.fn()),
    onTerminal: vi.fn(() => vi.fn()),
    readAgentClis: vi.fn(),
    onAgentClis: vi.fn(() => vi.fn()),
    detectAgentHooks: vi.fn(),
    installAgentHook: vi.fn(),
    trustAgentHook: vi.fn(),
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

export { api }
