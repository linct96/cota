import type { ConfigStore } from '../settings/config-store'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler } from '../app/ipc'
import type { CodeHostingService } from '../code-hosting/service'
import type { HostingContext } from '../../shared/code-hosting'
import type { GitBranchTarget } from '../../shared/git-branches'
import type { WorkspaceTarget } from '../../shared/contracts'
import type { CommitMessageRequest } from '../../shared/commit-message'
import type {
  GitDiffSelection,
  GitMutation,
  GitHistoryRequest,
  GitCompareRequest,
} from '../../shared/source-control'
import type { CommitMessageService } from './commit-message/service'
import type { WorktreeManager } from './worktrees/manager'
import type { SourceControlService } from './source-control/service'
import { BranchService } from './branches/service'
import { isBranchMutation } from './branches/mutations'
import { SourceControlWatches } from './source-control/watch'
import { WorktreeError } from './worktrees/git'
import { absolutePath, terminalId, workspaceTarget } from '../validation'

export function registerGitIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  worktrees: WorktreeManager
  sourceControl: SourceControlService
  codeHosting: CodeHostingService
  commitMessages: CommitMessageService
  lifecycle: AppLifecycle
  renderer: AppRenderer
}) {
  const {
    handle,
    config,
    worktrees,
    sourceControl,
    codeHosting,
    commitMessages,
    lifecycle,
    renderer,
  } = deps
  const assertLifecycle = () => lifecycle.assertAvailable()
  let hostingGeneration = 0
  const sourceControlWatches = new SourceControlWatches(undefined, (_cwd, changes, commonDir) =>
    branches.invalidateRepository(commonDir, changes),
  )
  const branches = new BranchService(
    (repositoryId) => renderer.send('git:branches-changed', repositoryId),
    undefined,
    undefined,
    sourceControlWatches,
  )

  function prune(): void {
    const snapshot = config.snapshot()
    codeHosting.prune([
      ...snapshot.recentProjects,
      ...(snapshot.layout?.workspaces || [])
        .filter((workspace) => snapshot.recentProjects.includes(workspace.projectPath))
        .flatMap((workspace) =>
          workspace.kind === 'git-worktree'
            ? snapshot.worktreeRecords
                .filter((record) => record.id === workspace.worktreeId)
                .map((record) => record.path)
            : [workspace.projectPath],
        ),
    ])
    branches.prune([
      ...(snapshot.layout?.workspaces || [])
        .filter((workspace) => snapshot.recentProjects.includes(workspace.projectPath))
        .map((workspace) => ({ projectPath: workspace.projectPath, workspaceId: workspace.id })),
      ...snapshot.recentProjects.map((projectPath) => ({ projectPath })),
    ])
  }

  async function withBranchInvalidation<T>(
    action: () => Promise<T>,
    projectPath?: string,
  ): Promise<T> {
    const repository = projectPath ? await worktrees.inspectRepository(projectPath) : undefined
    try {
      return await action()
    } finally {
      if (repository?.status === 'ready') branches.invalidateRepository(repository.repoCommonDir)
      prune()
    }
  }

  function branchTarget(value: GitBranchTarget): GitBranchTarget {
    return value?.workspaceId === undefined
      ? { projectPath: absolutePath(value?.projectPath) }
      : workspaceTarget(value)
  }

  function withBranchTarget<T>(
    target: GitBranchTarget,
    read: (binding: { cwd: string }) => Promise<T>,
  ): Promise<T> {
    return target.workspaceId
      ? worktrees.withTerminalTarget(target as WorkspaceTarget, read)
      : worktrees.withProjectTarget(target.projectPath, read)
  }

  async function readBranches(target: GitBranchTarget, id: string, force = false) {
    const owner = () =>
      JSON.stringify(
        config
          .snapshot()
          .layout?.workspaces.find(
            (workspace) =>
              workspace.id === target.workspaceId && workspace.projectPath === target.projectPath,
          ),
      )
    const binding = owner()
    branches.subscribe(id, target)
    try {
      const view = await withBranchTarget(target, (binding) =>
        branches.query(binding.cwd, id, force),
      )
      if (owner() !== binding || !config.snapshot().recentProjects.includes(target.projectPath))
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '工作区绑定已改变，请重新读取。')
      return view
    } catch (error) {
      branches.release(id)
      throw error
    }
  }

  async function readHosting<T>(
    target: WorkspaceTarget,
    read: (cwd: string, context: HostingContext) => Promise<T>,
  ): Promise<T> {
    prune()
    const generation = hostingGeneration
    const capture = () =>
      worktrees.withTerminalTarget(target, async (binding) => ({
        binding,
        local: await codeHosting.capture(binding.cwd),
      }))
    const initial = await capture()
    try {
      const context = await codeHosting.resolveContext(initial.local)
      const result = await read(initial.binding.cwd, context)
      const current = await capture()
      if (generation !== hostingGeneration || JSON.stringify(current) !== JSON.stringify(initial))
        throw new WorktreeError('REPOSITORY_UNAVAILABLE', '工作区、仓库或分支已改变，请重新读取。')
      return result
    } finally {
      if (generation === hostingGeneration) prune()
    }
  }

  handle('git:status', (target: WorkspaceTarget) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.status(binding.cwd, true),
    )
  })
  handle('git:generate-commit-message', (input: CommitMessageRequest) => {
    assertLifecycle()
    const target = workspaceTarget(input)
    const requestId = terminalId(input.requestId)
    if (typeof input.indexVersion !== 'string' || !/^[\da-f]{64}$/.test(input.indexVersion))
      throw new Error('暂存区版本无效，请刷新后重试。')
    return commitMessages.generate(
      `${target.projectPath}\0${target.workspaceId}`,
      requestId,
      config.snapshot().preferences,
      (signal) =>
        worktrees.withTerminalTarget(target, (binding) => {
          signal.throwIfAborted()
          assertLifecycle()
          return sourceControl.commitMessageContext(binding.cwd, input.indexVersion)
        }),
      (context, signal) =>
        worktrees.withTerminalTarget(target, (binding) => {
          signal.throwIfAborted()
          assertLifecycle()
          return sourceControl.validateCommitMessageContext(binding.cwd, context)
        }),
    )
  })
  handle('git:cancel-commit-message', (input: WorkspaceTarget & { requestId: string }) => {
    const target = workspaceTarget(input)
    return commitMessages.cancel(
      `${target.projectPath}\0${target.workspaceId}`,
      terminalId(input.requestId),
    )
  })
  handle('git:watch', (target: WorkspaceTarget, id: unknown) => {
    assertLifecycle()
    return sourceControlWatches.start(
      id,
      () => worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
      (event) => renderer.send('git:changed', { id, event }),
    )
  })
  handle('git:unwatch', (id: unknown) => sourceControlWatches.stop(id))
  handle(
    'git:branch-snapshot',
    (value: GitBranchTarget, subscriptionId: unknown, force = false) => {
      assertLifecycle()
      if (typeof force !== 'boolean') throw new Error('分支刷新参数无效。')
      return readBranches(branchTarget(value), terminalId(subscriptionId), force)
    },
  )
  handle('git:release-branches', (id: unknown) => branches.release(terminalId(id)))
  handle('git:history', (target: WorkspaceTarget, request?: GitHistoryRequest) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.history(binding.cwd, request),
    )
  })
  handle('git:compare', (target: WorkspaceTarget, request: GitCompareRequest) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) =>
      sourceControl.compare(binding.cwd, request),
    )
  })
  handle('git:diff', (target: WorkspaceTarget, file: GitDiffSelection) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => sourceControl.diff(binding.cwd, file))
  })
  handle('git:mutate', (input: GitMutation) => {
    assertLifecycle()
    if (!input || typeof input !== 'object') throw new Error('Git 操作参数无效。')
    return worktrees.withTerminalTarget(input, (binding) => {
      assertLifecycle()
      if (isBranchMutation(input))
        return branches.mutate(binding.cwd, input, sourceControl, (urls) =>
          codeHosting.invalidateRemoteBranches(urls),
        )
      const mutate = () =>
        sourceControl.mutate(binding.cwd, input, (description) =>
          renderer.confirm({ title: '丢弃工作区改动', description, confirmLabel: '丢弃改动' }),
        )
      return ['stage', 'unstage', 'discard'].includes(input.action)
        ? mutate()
        : withBranchInvalidation(mutate, binding.projectPath)
    })
  })

  return {
    prune,
    withBranchInvalidation,
    readHosting,
    invalidateProjects: (paths: string[]) => branches.invalidateProjects(paths),
    close() {
      sourceControlWatches.close()
      hostingGeneration++
      codeHosting.close()
      branches.close()
    },
  }
}

export type GitResources = ReturnType<typeof registerGitIPC>
