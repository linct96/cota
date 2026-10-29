import type { GitReferences } from './source-control'

export interface GitBranchTarget {
  projectPath: string
  workspaceId?: string
}
export type GitBranchChange = 'refs' | 'worktrees' | 'config' | 'head' | 'unknown'

export interface GitBranchData {
  branches: (GitReferences['branches'][number] & { oid: string })[]
  remoteHeads: { ref: string; target: string }[]
}

export interface GitBranchSnapshot extends GitBranchData {
  repositoryId: string
  revision: number
  fetchedAt: number
}

export interface GitBranchView {
  snapshot: GitBranchSnapshot
  remotes: string[]
  stale: boolean
  currentBranch?: string | null
  watching: boolean
}

export function branchReferences(data: GitBranchData, remotes: string[]): GitReferences {
  const branches = data.branches.map(({ ref, label, date, subject, worktreePath }) => ({
    ref,
    label,
    date,
    subject,
    ...(worktreePath ? { worktreePath } : {}),
  }))
  const defaultBranchRef = ['origin', ...remotes.filter((remote) => remote !== 'origin')]
    .map(
      (remote) =>
        data.remoteHeads.find((head) => head.ref === `refs/remotes/${remote}/HEAD`)?.target,
    )
    .find((ref) => branches.some((branch) => branch.ref === ref))
  return { remotes, branches, defaultBranchRef }
}
