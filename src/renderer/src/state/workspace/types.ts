import { type TerminalLayout } from '../../../../shared/terminal-layout'
import {
  type AgentProvider,
  type AgentSession,
  type AgentUpdate,
  type Preferences,
  type WorkspaceOpener,
  type ProjectWorkspace,
  type Shortcut,
  type CreateWorktreeInput,
  type CreateWorktreeResult,
  type WorktreeRecord,
  type WorktreeScan,
  type TerminalSession,
} from '../../../../shared/contracts'
import type { GitDiffSelection } from '../../../../shared/source-control'

export interface TerminalTab {
  id: string
  projectPath: string
  workspaceId: string
  title: string
  kind?: 'shell' | 'agent'
  provider?: AgentProvider
  launchId?: string
  agent?: AgentSession
  agentRevision?: number
  cwd?: string
  status: 'starting' | 'running' | 'exited' | 'error'
  shellActivity?: import('../../../../shared/contracts').ShellActivity
  // shortcut: 完成未读仅保留在 Renderer；需要跨应用重启恢复时再迁移到 Host。
  shellUnread?: boolean
  exitCode?: number
  error?: string
  // shortcut: 连接失败已读仅保留在 Renderer；需要跨应用重启恢复时再迁移到 Host。
  errorRead?: boolean
  startupCommand?: string
  service?: import('../../../../shared/contracts').TerminalService
  closingStatus?: TerminalTab['status']
}

export interface WorkspaceState {
  bootstrapError?: string
  ready: boolean
  layoutLoaded: boolean
  layoutFrozen: boolean
  projects: string[]
  selectedProject?: string
  workspaces: ProjectWorkspace[]
  selectedWorkspaces: Record<string, string>
  removingWorkspace?: string
  preferences: Preferences
  workspaceOpeners: WorkspaceOpener[]
  refreshWorkspaceOpeners(): Promise<void>
  tabs: TerminalTab[]
  terminalLayouts: TerminalLayout[]
  closingTerminalTabs: string[]
  pendingAgentUpdates: Record<string, Exclude<AgentUpdate, { type: 'disconnected' }>>
  agentConnectionLost: boolean
  visibleTerminal?: string
  receiveAgent(event: AgentUpdate): void
  setVisibleTerminal(id?: string): void
  activeTabs: Record<string, string>
  lastClosedWorkspaceId?: string
  focusVersion: number
  worktreeRecords: WorktreeRecord[]
  worktreeScans: Record<string, WorktreeScan>
  worktreeError?: string
  orphanSessions: TerminalSession[]
  creatingWorktree: boolean
  createGitWorktree(input: CreateWorktreeInput & { planId: string }): Promise<CreateWorktreeResult>
  refreshWorktrees(path: string): Promise<void>
  removeWorktree(id: string, deleteBranch?: boolean, unlink?: boolean): Promise<void>
  bootstrap(): Promise<void>
  openProject(): Promise<void>
  selectProject(path: string, workspaceId?: string): Promise<boolean>
  newWorkspace(path: string, name?: string): Promise<boolean>
  renameWorkspace(id: string, name: string): boolean
  removeWorkspace(id: string): Promise<boolean>
  removeProject(path: string): Promise<boolean>
  newTerminal(
    provider?: AgentProvider,
    workspaceId?: string,
    command?: import('../../../../shared/contracts').QuickCommand,
  ): string | undefined
  recentQuickCommands: Record<string, string>
  runQuickCommand(id: string, workspaceId: string): void
  splitTerminal(id: string, direction?: 'horizontal' | 'vertical'): void
  resizeTerminalSplit(id: string, ratio: number): void
  reopenTab(): void
  selectTab(id: string): void
  selectWorkspaceTab(workspaceId: string, key: string): void
  closeWorkspaceTab(workspaceId: string, key: string): void
  reorderTab(workspaceId: string, id: string, toIndex: number): void
  updateTab(id: string, value: Partial<TerminalTab>): void
  closeTab(id?: string): Promise<void>
  closePane(id: string, remember?: boolean): Promise<void>
  savePreferences(value: Preferences): Promise<void>
  openDiff(workspaceId: string, selection: GitDiffSelection): void
  openFile(workspaceId: string, path: string): void
  shortcut(value: Exclude<Shortcut, 'settings'>): void
}
