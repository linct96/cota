export interface Preferences {
  shellPath: string | null
  scrollback: number
}

export interface AppConfig {
  version: 1
  recentProjects: string[]
  preferences: Preferences
  layout?: WorkspaceLayout
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type Shortcut =
  | 'open-folder'
  | 'new-terminal'
  | 'close-terminal'
  | 'settings'
  | `tab-${number}`
export type TerminalEvent = (
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
  | { type: 'error'; id: string; error: string }
) & { attachmentId: string }

export interface ProjectWorkspace {
  id: string
  projectPath: string
  name: string
}

export interface SavedTerminal extends WorkspaceTarget {
  id: string
  title: string
}

export interface WorkspaceLayout {
  workspaces: ProjectWorkspace[]
  tabs: SavedTerminal[]
  selectedProject?: string
  selectedWorkspaces: Record<string, string>
  activeTabs: Record<string, string>
}

export interface TerminalSession extends WorkspaceTarget {
  id: string
  cols: number
  rows: number
  exited: boolean
  exitCode?: number
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

export interface CreateTerminal extends WorkspaceTarget {
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

export interface DesktopAPI {
  bootstrap(): Promise<Result<{ config: AppConfig; sessions: TerminalSession[]; warning?: string }>>
  saveLayout(layout: WorkspaceLayout): Promise<Result<void>>
  openProject(): Promise<Result<string | null>>
  selectProject(path: string): Promise<Result<void>>
  projectBranch(path: string): Promise<Result<string | null>>
  removeWorkspace(target: RemoveWorkspace): Promise<Result<boolean>>
  removeProject(path: string): Promise<Result<boolean>>
  savePreferences(preferences: Preferences): Promise<Result<Preferences>>
  createTerminal(options: CreateTerminal): Promise<Result<void>>
  attachTerminal(options: AttachTerminal): Promise<Result<TerminalAttachment>>
  detachTerminal(id: string, attachmentId: string): Promise<Result<void>>
  writeTerminal(id: string, data: string): Promise<Result<void>>
  resizeTerminal(id: string, cols: number, rows: number): Promise<Result<void>>
  acknowledge(id: string, attachmentId: string, length: number): void
  closeTerminal(id: string): Promise<Result<boolean>>
  closeWindow(): void
  respondToConfirmation(id: string, confirmed: boolean): Promise<Result<void>>
  onConfirmation(listener: (request: ConfirmationRequest) => void): () => void
  onTerminal(listener: (event: TerminalEvent) => void): () => void
  onShortcut(listener: (shortcut: Shortcut) => void): () => void
}

export const MAX_TERMINALS = 10
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  recentProjects: [],
  preferences: { shellPath: null, scrollback: 5000 },
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}
