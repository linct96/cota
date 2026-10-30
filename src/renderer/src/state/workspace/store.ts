import { create } from 'zustand'
import { DEFAULT_CONFIG } from '../../../../shared/contracts'
import type { WorkspaceState } from './types'
import { createBootstrapActions } from './bootstrap-actions'
import { createWorkspaceActions } from './workspace-actions'
import { createWorktreeActions } from './worktree-actions'
import { createTerminalActions } from './terminal-actions'
import { createTabActions } from './tab-actions'
import { createAgentActions } from './agent-actions'
import { createPreferencesActions } from './preferences-actions'
import { installWorkspaceSubscriptions } from './subscriptions'

// Share one Store so cross-domain updates remain atomic.
export const useWorkspace = create<WorkspaceState>((set, get, api) => ({
  ready: false,
  layoutLoaded: false,
  projects: [],
  workspaces: [],
  selectedWorkspaces: {},
  preferences: DEFAULT_CONFIG.preferences,
  workspaceOpeners: [],
  tabs: [],
  terminalLayouts: [],
  closingTerminalTabs: [],
  pendingAgentUpdates: {},
  agentConnectionLost: false,
  activeTabs: {},
  focusVersion: 0,
  worktreeRecords: [],
  worktreeScans: {},
  orphanSessions: [],
  creatingWorktree: false,
  recentQuickCommands: {},
  ...createBootstrapActions(set, get, api),
  ...createWorkspaceActions(set, get, api),
  ...createWorktreeActions(set, get, api),
  ...createTerminalActions(set, get, api),
  ...createTabActions(set, get, api),
  ...createAgentActions(set, get, api),
  ...createPreferencesActions(set, get, api),
}))

const stopSubscriptions = installWorkspaceSubscriptions(useWorkspace)
import.meta.hot?.dispose(stopSubscriptions)
