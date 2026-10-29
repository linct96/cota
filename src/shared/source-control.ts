import type { WorkspaceTarget } from './contracts'

export type GitArea = 'conflict' | 'staged' | 'unstaged' | 'untracked'
export interface GitChange {
  path: string
  oldPath?: string
  area: GitArea
  status: string
  submodule: boolean
  stats?: { additions: number; deletions: number } | null
}
export interface GitStatus {
  rootPath: string
  branch: string | null
  head: string | null
  upstream?: string
  tracking?: GitTracking
  ahead: number
  behind: number
  indexVersion: string
  entries: GitChange[]
}
export interface GitFileSelection {
  path: string
  area: GitArea
}
export type GitDiff =
  | { kind: 'text'; original: string; modified: string }
  | { kind: 'unavailable'; reason: string }

export interface GitTracking {
  remote: string
  branch: string
}
export type GitRemoteMutation =
  | { action: 'fetch'; remote: string }
  | { action: 'publish'; remote: string; branch: string; head: string }
  | { action: 'push' | 'pull' | 'sync'; branch: string; head: string; tracking: GitTracking }
export type GitMutation = WorkspaceTarget &
  (
    | { action: 'stage' | 'unstage' | 'discard'; files: GitFileSelection[] }
    | { action: 'commit'; message: string; indexVersion: string }
    | {
        action: 'switch-branch' | 'delete-branch'
        ref: string
        branch: string | null
        head: string | null
      }
    | { action: 'create-branch'; name: string; head: string }
    | { action: 'create-and-switch-branch'; name: string; branch: string | null; head: string }
    | GitRemoteMutation
  )
export interface GitReferences {
  defaultBranchRef?: string
  remotes: string[]
  branches: { ref: string; label: string; date: string; subject: string; worktreePath?: string }[]
}
export interface GitCommit {
  oid: string
  parents: string[]
  author: string
  date: string
  subject: string
}
export interface GitHistoryRequest {
  head?: string
  base?: string
  offset?: number
}
export interface GitHistory {
  head: string | null
  commits: GitCommit[]
  more: boolean
}
export type GitCompareRequest = { kind: 'branch'; ref: string } | { kind: 'commit'; commit: string }
export interface GitReviewFile {
  path: string
  oldPath?: string
  status: string
  submodule: boolean
  stats?: GitChange['stats']
}
export interface GitComparison {
  base: string | null
  head: string
  label: string
  entries: GitReviewFile[]
}
export interface GitReviewSelection extends GitReviewFile {
  area: 'review'
  base: string | null
  head: string
  label: string
}
export type GitDiffSelection = GitFileSelection | GitReviewSelection
export const gitFileKey = (file: GitDiffSelection): string =>
  file.area === 'review'
    ? `review:${file.base || 'empty'}:${file.head}:${file.path}`
    : `${file.area}:${file.path}`
