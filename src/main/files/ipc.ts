import { clipboard, shell } from 'electron'
import type { WorkspaceTarget } from '../../shared/contracts'
import type { FileAction } from '../../shared/file-explorer'
import type { ConfigStore } from '../settings/config-store'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler } from '../app/ipc'
import type { WorktreeManager } from '../git/worktrees/manager'
import { FileExplorerService } from './file-explorer'
import { FileExplorerWatches } from './file-explorer-watch'

export function registerFilesIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  worktrees: WorktreeManager
  lifecycle: AppLifecycle
  renderer: AppRenderer
}): FileExplorerWatches {
  const { handle, config, worktrees, lifecycle, renderer } = deps
  const files = new FileExplorerService(() => config.snapshot().preferences.fileExplorer)
  const fileWatches = new FileExplorerWatches(
    undefined,
    () => config.snapshot().preferences.fileExplorer,
  )
  const assertLifecycle = () => lifecycle.assertAvailable()
  handle('files:list', (target: WorkspaceTarget, path: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => files.list(binding.cwd, path))
  })
  handle('files:read', (target: WorkspaceTarget, path: unknown) => {
    assertLifecycle()
    return worktrees.withTerminalTarget(target, (binding) => files.read(binding.cwd, path))
  })
  handle('files:action', (target: WorkspaceTarget, path: unknown, action: FileAction) => {
    assertLifecycle()
    if (!['copy-relative', 'copy-absolute', 'reveal'].includes(action))
      throw new Error('文件操作无效。')
    return worktrees.withTerminalTarget(target, async (binding) => {
      const location = await files.location(binding.cwd, path)
      if (action === 'reveal') shell.showItemInFolder(location)
      else clipboard.writeText(action === 'copy-relative' ? String(path) || '.' : location)
    })
  })
  handle('files:watch', (target: WorkspaceTarget, paths: unknown, id: unknown) => {
    assertLifecycle()
    return fileWatches.start(
      id,
      paths,
      () => worktrees.withTerminalTarget(target, async (binding) => binding.cwd),
      (event) => renderer.send('files:changed', { id, event }),
    )
  })
  handle('files:unwatch', (id: unknown) => fileWatches.stop(id))
  return fileWatches
}
