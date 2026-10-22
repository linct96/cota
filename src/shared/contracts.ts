import type { FileEntry, FilePreview, FileAction, FileWatchEvent } from './file-explorer'
import type {
  GitDiff,
  GitDiffSelection,
  GitMutation,
  GitStatus,
  GitReferences,
  GitHistory,
  GitHistoryRequest,
  GitComparison,
  GitCompareRequest,
} from './source-control'

export interface WorkspaceOpener {
  id: string
  name: string
  command: string
  arguments: string
}

export type TerminalGpuAcceleration = 'auto' | 'on' | 'off'

export interface Preferences {
  terminalGpuAcceleration: TerminalGpuAcceleration
  shellName: string | null
  shellPath: string | null
  scrollback: number
  openWith: WorkspaceOpener[]
}

export interface AppConfig {
  version: 2
  recentProjects: string[]
  preferences: Preferences
  layout?: WorkspaceLayout
  worktreeRecords: WorktreeRecord[]
  worktreeNameHistory?: Record<string, string[]>
}

export type WorktreeErrorCode =
  | 'NOT_GIT_REPO'
  | 'GIT_UNAVAILABLE'
  | 'REPOSITORY_UNAVAILABLE'
  | 'UNSUPPORTED_REPOSITORY'
  | 'INVALID_INPUT'
  | 'INVALID_BRANCH_NAME'
  | 'BRANCH_EXISTS'
  | 'BASE_REF_NOT_FOUND'
  | 'PATH_CONFLICT'
  | 'WORKTREE_LOCKED'
  | 'GIT_COMMAND_FAILED'
  | 'CONFIG_PERSIST_FAILED'
  | 'REMOVAL_BLOCKED'

export interface WorktreeFailureDetails {
  operationId?: string
  path?: string
  gitState?: 'created' | 'not-created' | 'removed' | 'unknown'
  worktrees?: GitWorktreeInfo[]
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: WorktreeErrorCode; details?: WorktreeFailureDetails }
export type Shortcut =
  | 'open-folder'
  | 'new-terminal'
  | 'close-terminal'
  | 'settings'
  | `tab-${number}`
export type TerminalEvent =
  | ((
      | { type: 'data'; id: string; data: string }
      | { type: 'exit'; id: string; exitCode: number; signal?: number }
      | { type: 'error'; id: string; error: string }
    ) & { attachmentId: string })
  | { type: 'closing'; id: string; attachmentId?: string; closing: boolean }

export type WorkspaceKind = 'local' | 'git-worktree'

export type ProjectWorkspace = {
  id: string
  projectPath: string
  name: string
} & ({ kind: 'local'; worktreeId?: never } | { kind: 'git-worktree'; worktreeId: string })

export interface WorktreeRecord {
  id: string
  projectPath: string
  repoCommonDir: string
  repoId: string
  path: string
  origin: 'created' | 'linked'
  initialBranch?: string
  baseRef?: string
  registeredAt: string
}

export interface GitWorktreeInfo {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isBare: boolean
  locked: boolean
  lockReason?: string
  prunable: boolean
  prunableReason?: string
  managedByCota: boolean
  worktreeId?: string
}

export type GitRepositoryInfo =
  | {
      status: 'ready'
      projectPath: string
      rootPath: string
      repoCommonDir: string
      isBare: false
    }
  | {
      status: 'unsupported'
      projectPath: string
      repoCommonDir: string
      isBare: true
      error: string
      code: 'UNSUPPORTED_REPOSITORY'
    }
  | {
      status: 'nonGit' | 'gitUnavailable' | 'unavailable'
      projectPath: string
      error: string
      code: WorktreeErrorCode
    }

export interface WorktreeNameSuggestion {
  name: string
  branchPrefix: string
}

export interface CreateWorktreeInput {
  projectPath: string
  name: string
  branchName: string
  baseRef: string
}

export interface CreateWorktreeResult {
  worktree: GitWorktreeInfo
  record: WorktreeRecord
  workspace: ProjectWorkspace
}

export interface WorktreePlan extends CreateWorktreeInput {
  id: string
  path: string
}

export type WorktreeStatus = 'ready' | 'missing' | 'unavailable' | 'conflict' | 'external'
export interface WorktreeState {
  record: WorktreeRecord
  status: WorktreeStatus
  worktree?: GitWorktreeInfo
  error?: string
}
export interface WorktreeScan {
  error?: string
  repository: GitRepositoryInfo
  entries: WorktreeState[]
  external: GitWorktreeInfo[]
}
export type RemovalBlocker =
  | 'UNMANAGED'
  | 'MAIN_WORKTREE'
  | 'MISSING_OR_UNKNOWN_PATH'
  | 'LOCKED'
  | 'PRUNABLE'
  | 'DIRTY'
  | 'UNTRACKED_FILES'
  | 'IGNORED_CONTENT'
  | 'POPULATED_SUBMODULE'
  | 'RUNNING_SESSIONS'
  | 'GIT_UNAVAILABLE'
  | 'OWNERSHIP_MISMATCH'
export const REMOVAL_BLOCKER_LABELS: Record<RemovalBlocker, string> = {
  UNMANAGED: '并非 Cota 创建的目录',
  MAIN_WORKTREE: '主工作树不可删除',
  MISSING_OR_UNKNOWN_PATH: '目录缺失或无法确认',
  LOCKED: 'Worktree 已锁定',
  PRUNABLE: 'Git 元数据需要修复',
  DIRTY: '存在未提交修改',
  UNTRACKED_FILES: '存在未跟踪文件',
  IGNORED_CONTENT: '存在被忽略的文件',
  POPULATED_SUBMODULE: '存在已初始化的子模块',
  RUNNING_SESSIONS: '有关联运行中终端',
  GIT_UNAVAILABLE: 'Git 查询不可用',
  OWNERSHIP_MISMATCH: '路径或仓库归属不匹配',
}
export interface WorktreeRemovalCheck {
  allowed: boolean
  worktreeId: string
  worktreePath: string
  currentBranch: string | null
  blockers: RemovalBlocker[]
  liveTerminalIds: string[]
}
export interface RemoveWorktreeResult {
  removed: boolean
  cancelled?: boolean
  branchRetained?: boolean
  warning?: string
  operationId: string
}

export const AGENT_PROVIDERS = {
  pi: { name: 'Pi', command: 'pi' },
  codex: { name: 'Codex', command: 'codex' },
  claude: { name: 'Claude Code', command: 'claude' },
} as const
export type AgentProvider = keyof typeof AGENT_PROVIDERS
export type TerminalLaunch =
  | { kind?: 'shell'; provider?: never; launchId?: never }
  | { kind: 'agent'; provider: AgentProvider; launchId: string }

export interface AgentAvailability {
  provider: AgentProvider
  executable?: string
  version?: string
  error?: string
}

export type AgentActivity =
  | 'unknown'
  | 'idle'
  | 'working'
  | 'needs-input'
  | 'completed'
  | 'failed'
  | 'interrupted'
export type AgentOutcome = 'success' | 'failure' | 'cancelled' | 'unknown'
export type AgentEventType =
  | 'session-started'
  | 'turn-started'
  | 'turn-active'
  | 'attention-required'
  | 'turn-ended'
  | 'turn-completed'
  | 'turn-failed'
  | 'turn-interrupted'
  | 'activity-unknown'
  | 'integration-unavailable'
  | 'session-ended'

export interface AgentLifecycleEvent {
  token: string
  terminalId: string
  launchId: string
  provider: AgentProvider
  eventId: string
  timestamp: number
  type: AgentEventType
  turnId?: string
  agentId?: string
  requestId?: string
  toolName?: string
  requestDone?: boolean
  waitingFor?: 'permission' | 'question'
  backgroundTasks?: { agentIds: string[]; otherCount: number }
}

export interface ManagedAgentEvent extends Omit<AgentLifecycleEvent, 'launchId'> {
  managed: true
  processId: number
  sessionId: string
}

export interface AgentHookStatus {
  provider: AgentProvider
  state: 'installed' | 'missing' | 'outdated' | 'conflict' | 'error'
  paths: string[]
  detail: string
}

export type AgentUpdate =
  | { type: 'state'; session: AgentSession }
  | { type: 'removed'; terminalId: string; launchId: string; revision: number }
  | { type: 'disconnected' }

export interface AgentSession extends WorkspaceTarget {
  cwd: string
  terminalId: string
  launchId: string
  provider: AgentProvider
  runtimeState: 'starting' | 'running' | 'stopping' | 'exited' | 'error'
  activityState: AgentActivity
  outcome?: AgentOutcome
  workingChildren?: number
  waitingChildren?: number
  startedAt: string
  lastEventAt: string
  lastTurnId?: string
  eventSource: 'process' | 'pi-extension' | 'claude-hooks' | 'codex-hooks'
  observability: 'full' | 'partial' | 'unavailable'
  observabilityReason?: string
  revision: number
  unread: boolean
  exitCode?: number
}

export interface SavedTerminal extends WorkspaceTarget {
  id: string
  title: string
  kind?: 'shell' | 'agent'
  provider?: AgentProvider
}

export interface WorkspaceLayout {
  workspaces: ProjectWorkspace[]
  tabs: SavedTerminal[]
  selectedProject?: string
  selectedWorkspaces: Record<string, string>
  activeTabs: Record<string, string>
}

export interface TerminalBinding extends WorkspaceTarget {
  cwd: string
  workspaceKind: WorkspaceKind
  worktreeId?: string
  repoCommonDir?: string
}

export interface TerminalSession extends TerminalBinding {
  id: string
  cols: number
  rows: number
  exited: boolean
  exitCode?: number
  kind?: 'shell' | 'agent'
  provider?: AgentProvider
  agent?: AgentSession
  agentRevision?: number
}

export interface AttachTerminal extends WorkspaceTarget {
  id: string
  attachmentId: string
}

export interface TerminalAttachment extends TerminalSession {
  snapshot: string
}

export interface WorkspaceTarget {
  projectPath: string
  workspaceId: string
}

export interface RemoveWorkspace extends WorkspaceTarget {
  removeProject: boolean
}

export type CreateTerminal = WorkspaceTarget &
  TerminalLaunch & {
    id: string
    cols: number
    rows: number
  }

export interface ConfirmationRequest {
  id: string
  title: string
  description: string
  confirmLabel?: string
}

export type GitWatchEvent = 'ready' | 'change' | 'unavailable'

export interface DesktopAPI {
  readonly accounts: import('./accounts').AccountsAPI
  readonly platform: string
  bootstrap(): Promise<
    Result<{
      config: AppConfig
      sessions: TerminalSession[]
      warning?: string
      worktreeScans?: Record<string, WorktreeScan>
    }>
  >
  saveLayout(layout: WorkspaceLayout): Promise<Result<void>>
  openProject(): Promise<Result<string | null>>
  selectProject(path: string): Promise<Result<void>>
  projectBranch(path: string): Promise<Result<string | null>>
  inspectRepository(path: string): Promise<Result<GitRepositoryInfo>>
  listWorktrees(path: string): Promise<Result<GitWorktreeInfo[]>>
  listFiles(target: WorkspaceTarget, path: string): Promise<Result<FileEntry[]>>
  readFile(target: WorkspaceTarget, path: string): Promise<Result<FilePreview>>
  fileAction(target: WorkspaceTarget, path: string, action: FileAction): Promise<Result<void>>
  watchFiles(
    target: WorkspaceTarget,
    paths: string[],
    listener: (event: FileWatchEvent) => void,
  ): () => void
  gitStatus(target: WorkspaceTarget): Promise<Result<GitStatus>>
  watchGit(target: WorkspaceTarget, listener: (event: GitWatchEvent) => void): () => void
  gitDiff(target: WorkspaceTarget, file: GitDiffSelection): Promise<Result<GitDiff>>
  gitReferences(target: WorkspaceTarget): Promise<Result<GitReferences>>
  gitHistory(target: WorkspaceTarget, request?: GitHistoryRequest): Promise<Result<GitHistory>>
  gitCompare(target: WorkspaceTarget, request: GitCompareRequest): Promise<Result<GitComparison>>
  gitMutate(input: GitMutation): Promise<Result<boolean>>
  planGitWorktree(input: CreateWorktreeInput): Promise<Result<WorktreePlan>>
  worktreeBranches(path: string): Promise<Result<string[]>>
  suggestWorktreeName(path: string): Promise<Result<WorktreeNameSuggestion>>
  scanWorktrees(path: string): Promise<Result<WorktreeScan>>
  createGitWorktree(
    input: CreateWorktreeInput & { planId?: string },
  ): Promise<Result<CreateWorktreeResult>>
  linkGitWorktree(path: string, worktreePath: string): Promise<Result<CreateWorktreeResult>>
  inspectWorktreeRemoval(id: string): Promise<Result<WorktreeRemovalCheck>>
  removeGitWorktree(id: string, deleteBranch: boolean): Promise<Result<RemoveWorktreeResult>>
  unlinkGitWorktree(id: string): Promise<Result<boolean>>
  workspacePath(target: WorkspaceTarget): Promise<Result<string>>
  openWorkspaceWith(path: string | WorkspaceTarget, openerId: string): Promise<Result<void>>
  removeWorkspace(target: RemoveWorkspace): Promise<Result<boolean>>
  removeProject(path: string): Promise<Result<boolean>>
  getDefaultShell(): Promise<Result<string>>
  savePreferences(preferences: Preferences): Promise<Result<Preferences>>
  detectAgents(): Promise<Result<AgentAvailability[]>>
  detectAgentHooks(): Promise<Result<AgentHookStatus[]>>
  installAgentHook(provider: AgentProvider): Promise<Result<AgentHookStatus | null>>
  uninstallAgentHook(provider: AgentProvider): Promise<Result<AgentHookStatus | null>>
  readAgent(id: string, launchId: string, revision: number): Promise<Result<void>>
  setVisibleTerminal(id?: string): Promise<Result<void>>
  onAgentFocus(
    listener: (target: Pick<AgentSession, 'terminalId' | 'launchId'>) => void,
  ): () => void
  onAgent(listener: (event: AgentUpdate) => void): () => void
  createTerminal(options: CreateTerminal): Promise<Result<void>>
  attachTerminal(options: AttachTerminal): Promise<Result<TerminalAttachment>>
  detachTerminal(id: string, attachmentId: string): Promise<Result<void>>
  writeTerminal(id: string, data: string, encoding?: 'utf8' | 'binary'): Promise<Result<void>>
  resizeTerminal(id: string, cols: number, rows: number): Promise<Result<void>>
  acknowledge(id: string, attachmentId: string, length: number): void
  closeTerminal(id: string): Promise<Result<boolean>>
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  isWindowMaximized(): Promise<Result<boolean>>
  onWindowMaximized(listener: (maximized: boolean) => void): () => void
  closeWindow(): void
  restartApp(): void
  respondToConfirmation(id: string, confirmed: boolean): Promise<Result<void>>
  onConfirmation(listener: (request: ConfirmationRequest) => void): () => void
  onTerminal(listener: (event: TerminalEvent) => void): () => void
  onShortcut(listener: (shortcut: Shortcut) => void): () => void
}

export const MAX_TERMINALS = 10
export const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  recentProjects: [],
  worktreeRecords: [],
  preferences: {
    terminalGpuAcceleration: 'auto',
    shellName: null,
    shellPath: null,
    scrollback: 5000,
    // The system file manager is a built-in action on every platform.
    openWith: [],
  },
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(
      [
        result.error,
        result.details?.path && `目录：${result.details.path}`,
        result.details?.operationId && `操作：${result.details.operationId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  return result.value
}
