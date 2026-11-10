import type { CreateWorktreeResult, WorktreeScan } from '../../../src/shared/contracts'

export function managedWorktree(): CreateWorktreeResult {
  const id = crypto.randomUUID()
  const record = {
    id,
    projectPath: '/tmp/project',
    path: `/tmp/worktrees/${id}`,
    repoCommonDir: '/tmp/project/.git',
    repoId: 'a'.repeat(24),
    origin: 'created' as const,
    registeredAt: new Date().toISOString(),
    initialBranch: 'feature',
  }
  return {
    record,
    workspace: {
      id: crypto.randomUUID(),
      projectPath: record.projectPath,
      name: 'My work',
      kind: 'git-worktree',
      worktreeId: id,
    },
    worktree: {
      path: record.path,
      branch: 'feature',
      head: 'a'.repeat(40),
      isMain: false,
      isBare: false,
      locked: false,
      prunable: false,
      managedByCota: true,
      worktreeId: id,
    },
  }
}
export function scanFor(value: CreateWorktreeResult): WorktreeScan {
  return {
    repository: {
      status: 'ready',
      projectPath: value.record.projectPath,
      rootPath: value.record.projectPath,
      repoCommonDir: value.record.repoCommonDir,
      isBare: false,
    },
    entries: [{ record: value.record, worktree: value.worktree, status: 'ready' }],
    external: [],
  }
}
