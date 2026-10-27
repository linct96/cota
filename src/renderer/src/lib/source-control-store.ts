import { create } from 'zustand'
import type { AgentProvider } from '../../../shared/contracts'
import type { TerminalLayout } from '../../../shared/terminal-layout'
import { gitFileKey, type GitDiffSelection, type GitStatus } from '../../../shared/source-control'

export type ClosedTab =
  | { kind: 'terminal'; title: string; provider?: AgentProvider }
  | {
      kind: 'terminal-group'
      layout: TerminalLayout
      panes: { id: string; title: string; provider?: AgentProvider }[]
    }
  | { kind: 'changes' }
  | { kind: 'diff'; selection: GitDiffSelection }
  | { kind: 'file'; path: string }
  | { kind: 'preview'; file?: string; selection?: GitDiffSelection }

interface SourceControlSession {
  tabOrder: string[]
  closedTabs: ClosedTab[]
  selection?: GitDiffSelection
  pinnedDiffs: GitDiffSelection[]
  activePinnedDiff?: GitDiffSelection
  pinnedFiles: string[]
  activePinnedFile?: string
  file?: string
  mode: 'changes' | 'history' | 'compare'
  baseRef?: string
  preview: boolean
  changesOpen: boolean
  changesActive: boolean
  draft: string
  draftRevision: number
  status?: GitStatus
  refreshed: number
}
export const EMPTY_SOURCE_CONTROL: SourceControlSession = {
  tabOrder: [],
  closedTabs: [],
  pinnedDiffs: [],
  pinnedFiles: [],
  preview: false,
  changesOpen: false,
  changesActive: false,
  mode: 'changes',
  draft: '',
  draftRevision: 0,
  refreshed: 0,
}
interface SourceControlState {
  sessions: Record<string, SourceControlSession>
  update(id: string, patch: Partial<SourceControlSession>): void
  syncTerminals(id: string, terminalIds: string[]): void
  openDiff(id: string, selection: GitDiffSelection): void
  pinDiff(id: string): void
  selectPinnedDiff(id: string, key: string): void
  closePinnedDiff(id: string, key: string): void
  openFile(id: string, path: string): void
  pinFile(id: string): void
  selectPinnedFile(id: string, path: string): void
  closePinnedFile(id: string, path: string): void
  openChanges(id: string): void
  closeChanges(id: string): void
  closePreview(id: string): void
  rememberClosedTab(id: string, tab: ClosedTab): void
  showTerminal(id: string): void
}

export const useSourceControl = create<SourceControlState>((set, get) => ({
  sessions: {},
  update(id, patch) {
    set((state) => {
      const previous = state.sessions[id] || EMPTY_SOURCE_CONTROL
      const session = { ...previous, ...patch }
      if ('draft' in patch && patch.draft !== previous.draft)
        session.draftRevision = previous.draftRevision + 1
      if (patch.file !== undefined) session.selection = undefined
      else if ('selection' in patch) session.file = undefined
      if (patch.preview) session.changesActive = false
      if (
        patch.preview ||
        patch.changesActive ||
        patch.file !== undefined ||
        patch.activePinnedFile !== undefined
      )
        session.activePinnedDiff = undefined
      if (
        patch.preview ||
        patch.changesActive ||
        patch.file !== undefined ||
        patch.activePinnedDiff !== undefined
      )
        session.activePinnedFile = undefined
      if (patch.status && session.selection && session.selection.area !== 'review') {
        const selection = session.selection
        const entry =
          patch.status.entries.find((entry) => gitFileKey(entry) === gitFileKey(selection)) ||
          patch.status.entries.find((entry) => entry.path === selection.path)
        session.selection = entry ? { path: entry.path, area: entry.area } : undefined
        if (!entry) session.preview = false
      }
      const extraTabs = [
        ...(session.changesOpen ? ['changes'] : []),
        ...session.pinnedDiffs.map((selection) => `diff:${gitFileKey(selection)}`),
        ...session.pinnedFiles.map((path) => `file:${path}`),
        ...(session.file || session.selection ? ['preview'] : []),
      ]
      const tabOrder = session.tabOrder.filter(
        (key) => key.startsWith('terminal:') || extraTabs.includes(key),
      )
      for (const key of extraTabs) if (!tabOrder.includes(key)) tabOrder.push(key)
      if (
        tabOrder.length !== session.tabOrder.length ||
        tabOrder.some((key, index) => key !== session.tabOrder[index])
      )
        session.tabOrder = tabOrder
      return { sessions: { ...state.sessions, [id]: session } }
    })
  },
  syncTerminals(id, terminalIds) {
    const session = get().sessions[id] || EMPTY_SOURCE_CONTROL
    const keys = terminalIds.map((terminalId) => `terminal:${terminalId}`)
    const tabOrder = session.tabOrder.filter(
      (key) => !key.startsWith('terminal:') || keys.includes(key),
    )
    for (const key of keys) if (!tabOrder.includes(key)) tabOrder.push(key)
    if (
      tabOrder.length !== session.tabOrder.length ||
      tabOrder.some((key, index) => key !== session.tabOrder[index])
    )
      get().update(id, { tabOrder })
  },
  openDiff(id, selection) {
    const key = gitFileKey(selection)
    if (get().sessions[id]?.pinnedDiffs.some((file) => gitFileKey(file) === key))
      get().selectPinnedDiff(id, key)
    else get().update(id, { selection, preview: true })
  },
  pinDiff(id) {
    const session = get().sessions[id]
    if (!session?.preview || !session.selection) return
    const selection = session.selection
    get().update(id, {
      tabOrder: session.tabOrder.map((key) =>
        key === 'preview' ? `diff:${gitFileKey(selection)}` : key,
      ),
      pinnedDiffs: [...session.pinnedDiffs, selection],
      activePinnedDiff: selection,
      selection: undefined,
      preview: false,
    })
  },
  selectPinnedDiff(id, key) {
    const selection = get().sessions[id]?.pinnedDiffs.find((file) => gitFileKey(file) === key)
    if (selection)
      get().update(id, { activePinnedDiff: selection, preview: false, changesActive: false })
  },
  closePinnedDiff(id, key) {
    const session = get().sessions[id]
    const selection = session?.pinnedDiffs.find((file) => gitFileKey(file) === key)
    if (!session || !selection) return
    get().rememberClosedTab(id, { kind: 'diff', selection })
    get().update(id, {
      pinnedDiffs: session.pinnedDiffs.filter((file) => gitFileKey(file) !== key),
      activePinnedDiff:
        session.activePinnedDiff && gitFileKey(session.activePinnedDiff) === key
          ? undefined
          : session.activePinnedDiff,
    })
  },
  openFile(id, path) {
    if (get().sessions[id]?.pinnedFiles.includes(path)) get().selectPinnedFile(id, path)
    else get().update(id, { file: path, preview: true })
  },
  pinFile(id) {
    const session = get().sessions[id]
    if (!session?.preview || !session.file) return
    const path = session.file
    get().update(id, {
      tabOrder: session.tabOrder.map((key) => (key === 'preview' ? `file:${path}` : key)),
      pinnedFiles: [...session.pinnedFiles, path],
      activePinnedFile: path,
      file: undefined,
      preview: false,
    })
  },
  selectPinnedFile(id, path) {
    if (get().sessions[id]?.pinnedFiles.includes(path))
      get().update(id, { activePinnedFile: path, preview: false, changesActive: false })
  },
  closePinnedFile(id, path) {
    const session = get().sessions[id]
    if (!session?.pinnedFiles.includes(path)) return
    get().rememberClosedTab(id, { kind: 'file', path })
    get().update(id, {
      pinnedFiles: session.pinnedFiles.filter((file) => file !== path),
      activePinnedFile: session.activePinnedFile === path ? undefined : session.activePinnedFile,
    })
  },
  openChanges(id) {
    get().update(id, { changesOpen: true, changesActive: true, preview: false })
  },
  closeChanges(id) {
    if (!get().sessions[id]?.changesOpen) return
    get().rememberClosedTab(id, { kind: 'changes' })
    get().update(id, { changesOpen: false, changesActive: false })
  },
  closePreview(id) {
    const session = get().sessions[id]
    if (!session?.file && !session?.selection) return
    get().rememberClosedTab(id, {
      kind: 'preview',
      file: session.file,
      selection: session.selection,
    })
    get().update(id, { file: undefined, selection: undefined, preview: false })
  },
  rememberClosedTab(id, tab) {
    const session = get().sessions[id] || EMPTY_SOURCE_CONTROL
    get().update(id, { closedTabs: [...session.closedTabs.slice(-19), tab] })
  },
  showTerminal(id) {
    const session = get().sessions[id]
    if (
      session?.preview ||
      session?.changesActive ||
      session?.activePinnedDiff ||
      session?.activePinnedFile
    )
      get().update(id, {
        preview: false,
        changesActive: false,
        activePinnedDiff: undefined,
        activePinnedFile: undefined,
      })
  },
}))
