import { shell } from 'electron'
import type { WorkspaceTarget } from '../../shared/contracts'
import type { IpcHandler } from '../app/ipc'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { WorktreeManager } from '../git/worktrees/manager'
import type { GitResources } from '../git/ipc'
import type { CodeHostingService } from './service'

export function registerCodeHostingIPC(deps: {
  handle: IpcHandler
  codeHosting: CodeHostingService
  worktrees: WorktreeManager
  git: GitResources
  lifecycle: AppLifecycle
  renderer: AppRenderer
}): void {
  const { handle, codeHosting, worktrees, git, lifecycle, renderer } = deps
  const assertLifecycle = () => lifecycle.assertAvailable()
  const assertReadable = () => lifecycle.assertAvailable(true)
  const readHosting = git.readHosting
  handle('code-hosting:context', (target: WorkspaceTarget) => {
    assertReadable()
    return readHosting(target, (_cwd, context) => context)
  })
  handle('code-hosting:accounts', (provider: unknown) => {
    assertReadable()
    return codeHosting.accounts(provider)
  })
  handle('code-hosting:connection', (provider: unknown, host: unknown) => {
    assertReadable()
    return codeHosting.connection(provider, host)
  })
  handle('code-hosting:inspect', (target: WorkspaceTarget) => {
    assertReadable()
    return readHosting(target, (cwd, context) => codeHosting.inspect(cwd, context))
  })
  handle('code-hosting:creation-context', (target: WorkspaceTarget) => {
    assertReadable()
    return readHosting(target, (cwd, context) => codeHosting.creationContext(cwd, context))
  })
  handle('code-hosting:history', (target: WorkspaceTarget, key: unknown, page: unknown) => {
    assertReadable()
    return readHosting(target, (cwd, context) => codeHosting.history(cwd, key, page, context))
  })
  handle('code-hosting:prepare', (target: WorkspaceTarget, input: unknown) => {
    assertReadable()
    return readHosting(target, (cwd, context) => codeHosting.prepare(cwd, input, context))
  })
  handle('code-hosting:refresh-branches', (target: WorkspaceTarget, input: unknown) => {
    assertLifecycle()
    return readHosting(target, (cwd, context) => codeHosting.refreshBranches(cwd, input, context))
  })
  handle('code-hosting:create', (target: WorkspaceTarget, input: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => codeHosting.create(binding.cwd, input))
  })
  handle('code-hosting:merge', (target: WorkspaceTarget, input: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => codeHosting.merge(binding.cwd, input))
  })
  handle('code-hosting:open', (target: WorkspaceTarget, number: unknown, sourceBranch: unknown) => {
    assertLifecycle()
    const url = readHosting(target, (cwd, context) =>
      codeHosting.reviewUrl(cwd, number, sourceBranch, context),
    )
    return url.then(async (value) => {
      assertLifecycle()
      await shell.openExternal(value)
    })
  })
  handle(
    'code-hosting:clear-creation',
    (target: WorkspaceTarget, key: unknown, sourceBranch: unknown) => {
      assertLifecycle()
      return worktrees.withTerminalTarget(target, async (binding) => {
        if (
          await renderer.confirm({
            title: '解除重复创建保护',
            description:
              '请先在对应平台网页核对所选来源分支确实没有 PR/MR。解除后再次创建可能产生重复记录。',
            confirmLabel: '已核对，解除保护',
          })
        ) {
          assertLifecycle()
          await codeHosting.clearCreation(binding.cwd, key, sourceBranch)
        }
      })
    },
  )
}
