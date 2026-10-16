export interface Preferences {
  shellPath: string | null
  scrollback: number
}

export interface AppConfig {
  version: 1
  recentProjects: string[]
  preferences: Preferences
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type Shortcut =
  | 'open-folder'
  | 'new-terminal'
  | 'close-terminal'
  | 'settings'
  | `tab-${number}`
export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }

export interface CreateTerminal {
  id: string
  projectPath: string
  cols: number
  rows: number
}

export interface DesktopAPI {
  bootstrap(): Promise<Result<{ config: AppConfig; warning?: string }>>
  openProject(): Promise<Result<string | null>>
  selectProject(path: string): Promise<Result<void>>
  removeProject(path: string): Promise<Result<boolean>>
  savePreferences(preferences: Preferences): Promise<Result<Preferences>>
  createTerminal(options: CreateTerminal): Promise<Result<void>>
  writeTerminal(id: string, data: string): Promise<Result<void>>
  resizeTerminal(id: string, cols: number, rows: number): Promise<Result<void>>
  acknowledge(id: string, length: number): void
  closeTerminal(id: string): Promise<Result<boolean>>
  closeWindow(): void
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
