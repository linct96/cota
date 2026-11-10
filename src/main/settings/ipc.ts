import { clipboard, nativeTheme } from 'electron'
import type { ConfigStore } from './config-store'
import type { IpcHandler } from '../app/ipc'
import type { HostClient } from '../host/host-client'
import type { AgentSleepPrevention } from '../agents/runtime/sleep-prevention'
import type { FileExplorerWatches } from '../files/file-explorer-watch'
import { resolveShell } from '../system/shell'
import { executable, preferences } from '../validation'

export function registerSettingsIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  manager: HostClient
  agentSleep: AgentSleepPrevention
  fileWatches: FileExplorerWatches
  updateWindowBackground: () => void
  updateMenu: () => void
}): void {
  const { handle, config, manager, agentSleep, fileWatches } = deps
  handle('shell:default', () => resolveShell({ shellPath: null }))
  handle('preferences:save', async (value: unknown) => {
    const previous = config.snapshot().preferences
    const next = preferences(value)
    if (next.shellPath) await executable(next.shellPath)
    await config.savePreferences(next)
    agentSleep.setEnabled(next.preventSleep)
    nativeTheme.themeSource = next.theme
    deps.updateWindowBackground()
    deps.updateMenu()
    if (JSON.stringify(previous.fileExplorer) !== JSON.stringify(next.fileExplorer))
      fileWatches.close()
    if (next.scrollback !== previous.scrollback)
      await manager.request('setScrollback', [next.scrollback])
    return next
  })
  handle('clipboard:read', () => clipboard.readText())
  handle('clipboard:write', (text: unknown) => {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024)
      throw new Error('剪贴板文本无效。')
    return clipboard.writeText(text)
  })
}
