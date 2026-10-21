import { create } from 'zustand'
import { unwrap, type WorkspaceTarget } from '../../../shared/contracts'
import type { FileEntry } from '../../../shared/file-explorer'

interface DirectoryState {
  entries?: FileEntry[]
  loading?: boolean
  error?: string
  request?: number
  dirty?: boolean
}
interface ExplorerSession {
  expanded: Record<string, boolean>
  directories: Record<string, DirectoryState>
  selected?: string
  scrollTop: number
}
export const EMPTY_EXPLORER: ExplorerSession = { expanded: {}, directories: {}, scrollTop: 0 }
let nextRequest = 0

interface ExplorerState {
  sessions: Record<string, ExplorerSession>
  update(id: string, patch: Partial<ExplorerSession>): void
  load(target: WorkspaceTarget, path: string): Promise<void>
}

export const useFileExplorer = create<ExplorerState>((set, get) => ({
  sessions: {},
  update(id, patch) {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: { ...(state.sessions[id] || EMPTY_EXPLORER), ...patch },
      },
    }))
  },
  async load(target, path) {
    const id = target.workspaceId
    const initial = get().sessions[id] || EMPTY_EXPLORER
    const previous = initial.directories[path]
    if (previous?.loading) {
      get().update(id, {
        directories: { ...initial.directories, [path]: { ...previous, dirty: true } },
      })
      return
    }
    const request = ++nextRequest
    get().update(id, {
      directories: {
        ...initial.directories,
        [path]: { ...previous, loading: true, error: undefined, request, dirty: false },
      },
    })
    let entries: FileEntry[] | undefined
    let error: string | undefined
    try {
      entries = unwrap(await window.desktop.listFiles(target, path))
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const session = get().sessions[id]
    const current = session?.directories[path]
    if (!session || current?.request !== request) return
    get().update(id, {
      directories: {
        ...session.directories,
        [path]: {
          ...current,
          entries: entries ?? current.entries,
          error,
          loading: false,
          dirty: false,
        },
      },
    })
    if (current.dirty) void get().load(target, path)
  },
}))

export interface ExplorerRow extends FileEntry {
  depth: number
  parent: string
  position: number
  siblings: number
}

export function explorerRows(session: ExplorerSession): ExplorerRow[] {
  const rows: ExplorerRow[] = []
  function visit(path: string, depth: number) {
    const entries = session.directories[path]?.entries || []
    for (const [index, entry] of entries.entries()) {
      rows.push({ ...entry, depth, parent: path, position: index + 1, siblings: entries.length })
      if (entry.kind === 'directory' && session.expanded[entry.path]) visit(entry.path, depth + 1)
    }
  }
  visit('', 0)
  return rows
}
