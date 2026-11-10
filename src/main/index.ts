import { app, dialog, nativeTheme, powerMonitor } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { ConfigStore } from './settings/config-store'
import { AccountService } from './accounts/service'
import { registerAccountsIPC } from './accounts/ipc'
import { SourceControlService } from './git/source-control/service'
import { registerGitIPC } from './git/ipc'
import type { GitResources } from './git/ipc'
import { CodeHostingService } from './code-hosting/service'
import { registerCodeHostingIPC } from './code-hosting/ipc'
import { WorktreeManager } from './git/worktrees/manager'
import { WorktreeSetupService } from './git/worktrees/setup'
import { registerWorkspaceIPC } from './workspace/ipc'
import { registerFilesIPC } from './files/ipc'
import type { FileExplorerWatches } from './files/file-explorer-watch'
import { registerPortsIPC } from './ports/ipc'
import type { WorkspacePorts } from './ports/workspace-ports'
import { CommitMessageService } from './git/commit-message/service'
import { AgentSleepPrevention } from './agents/runtime/sleep-prevention'
import { createDesktopNotifications } from './agents/notifications/desktop'
import { registerAgentsIPC } from './agents/ipc'
import { AgentCliManagement } from './agents/cli/management'
import { AgentCliInstallTerminals } from './agents/cli/install-terminal'
import { connectTerminalHost } from './host/host-client'
import type { HostClient } from './host/host-client'
import { registerTerminalIPC } from './terminal/ipc'
import { registerSettingsIPC } from './settings/ipc'
import { AppLifecycle } from './app/lifecycle'
import { AppRenderer } from './app/renderer'
import { createAppWindow } from './app/window'
import { installMenu } from './app/menu'
import { createIPC } from './app/ipc'

let window: BrowserWindow | undefined
// Recovery IPC is installed without a Host; createIPC blocks Host-dependent calls on startup failure.
let manager: HostClient | undefined
let config: ConfigStore
let agentClis: AgentCliManagement
let accounts: AccountService
let worktrees: WorktreeManager
let worktreeSetups: WorktreeSetupService
let codeHosting: CodeHostingService | undefined
let git: GitResources | undefined
let fileWatches: FileExplorerWatches | undefined
let workspacePorts: WorkspacePorts | undefined
const sourceControl = new SourceControlService()
const commitMessages = new CommitMessageService((settings, execute) =>
  agentClis.run('pi', settings, execute),
)
const agentSleep = new AgentSleepPrevention()
const getWindow = () => window
const renderer = new AppRenderer(getWindow)
const cliInstallTerminals = new AgentCliInstallTerminals((event) =>
  renderer.send('agent:cli-install-progress', event),
)
const lifecycle = new AppLifecycle({
  getWindow,
  getManager: () => manager,
  getConfig: () => config,
  getWorktrees: () => worktrees,
  getWorktreeSetups: () => worktreeSetups,
  getAccounts: () => accounts,
  closeResources: () => {
    if (git) git.close()
    else codeHosting?.close()
    fileWatches?.close()
  },
  renderer,
  agentSleep,
  commitMessages,
  cliInstallTerminals,
})
const appName = app.isPackaged ? 'Cota' : 'Cota Dev'
const rendererFile = join(__dirname, '../renderer/index.html')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererURL = URL.parse(devURL || pathToFileURL(rendererFile).href)?.href.split('#')[0]
const { handle, trusted } = createIPC(getWindow, rendererURL, lifecycle)

if (!app.isPackaged) {
  const userData = join(app.getPath('appData'), appName)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  app.setName(appName)
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app.on('before-quit', (event) => {
    if (!lifecycle.exiting && (manager || lifecycle.startupError || lifecycle.exitPending)) {
      event.preventDefault()
      void lifecycle.requestExit()
    }
  })
  app.on('will-quit', () => {
    agentSleep.dispose()
    workspacePorts?.dispose()
  })
  void (async () => {
    try {
      await app.whenReady()
      app.setName(appName)
      config = new ConfigStore(join(app.getPath('userData'), 'config.json'))
      codeHosting = new CodeHostingService(config, sourceControl)
      accounts = new AccountService(join(app.getPath('userData'), 'cortana.sqlite3'), (progress) =>
        renderer.send('accounts:oauth-progress', progress),
      )
      const warning = (await config.load()).warning
      agentClis = new AgentCliManagement(config, (cache) =>
        renderer.send('agent:clis-changed', cache),
      )
      await agentClis
        .initialize()
        .catch((error) => renderer.warn(`Agent CLI 初始化失败：${String(error)}`))
      agentSleep.setEnabled(config.snapshot().preferences.preventSleep)
      powerMonitor.on('resume', () => agentSleep.refresh())
      nativeTheme.themeSource = config.snapshot().preferences.theme
      worktrees = new WorktreeManager(
        config,
        join(homedir(), app.isPackaged ? '.cota' : '.cota-dev', 'worktrees'),
      )
      worktreeSetups = new WorktreeSetupService(
        config,
        worktrees,
        join(app.getPath('userData'), 'worktree-setups'),
      )
      const desktopNotifications = createDesktopNotifications({
        config,
        renderer,
        getWindow,
        getManager: () => manager,
      })
      try {
        manager = await connectTerminalHost(
          app.getPath('userData'),
          (event) => renderer.send('terminal:event', event),
          (event) => {
            agentSleep.receive(event)
            desktopNotifications.notifications.receive(event)
            renderer.send('agent:event', event)
          },
        )
        for (const session of await manager.request('list', [])) {
          if (!session.agent) continue
          agentSleep.receive({ type: 'state', session: session.agent })
          desktopNotifications.notifications.receive({ type: 'state', session: session.agent })
        }
      } catch (error) {
        // Keep the recovery window available without reusing or stopping an incompatible Host.
        lifecycle.startupError = error instanceof Error ? error : new Error(String(error))
        agentSleep.dispose()
        console.error(`${appName} Terminal Host 启动失败：`, error)
      }
      const desktop = createAppWindow({
        appName,
        preferences: config.snapshot().preferences,
        lifecycle,
        rendererUnavailable: () => {
          void commitMessages.close()
          git?.close()
          fileWatches?.close()
          renderer.reset()
          cliInstallTerminals.detachAll()
          void manager?.detachAll().catch(() => {})
        },
      })
      window = desktop.window
      const updateMenu = () => {
        const bindings = config.snapshot().preferences.shortcuts
        desktop.setShortcuts(bindings)
        installMenu(
          appName,
          bindings,
          (shortcut) => {
            if (!lifecycle.exitPending && !lifecycle.exiting)
              renderer.send('app:shortcut', shortcut)
          },
          () => void lifecycle.requestExit(true),
        )
      }
      const common = { handle, config, manager: manager!, worktrees, lifecycle, renderer }
      git = registerGitIPC({ ...common, sourceControl, codeHosting, commitMessages })
      fileWatches = registerFilesIPC(common)
      workspacePorts = registerPortsIPC(common)
      registerAccountsIPC(handle, accounts)
      registerCodeHostingIPC({ ...common, codeHosting, git })
      registerAgentsIPC({ ...common, agentClis, cliInstallTerminals, getWindow })
      registerTerminalIPC({ ...common, agentClis, trusted })
      registerSettingsIPC({
        handle,
        config,
        manager: common.manager,
        agentSleep,
        fileWatches,
        updateWindowBackground: desktop.updateBackground,
        updateMenu,
      })
      registerWorkspaceIPC({ ...common, worktreeSetups, git, getWindow, warning })
      desktopNotifications.registerIPC(handle)
      desktop.registerIPC(handle, trusted)
      handle('app:confirm-response', (id: unknown, confirmed: unknown) =>
        renderer.reply(id, confirmed),
      )
      handle('app:exit-layout', (id: unknown, layout: unknown) =>
        renderer.replyExitLayout(id, layout),
      )
      handle('app:force-exit', () => lifecycle.requestForceExit())
      updateMenu()
      if (devURL) await window.loadURL(devURL)
      else await window.loadFile(rendererFile)
    } catch (error) {
      agentSleep.dispose()
      console.error(`${appName} 启动失败：`, error)
      let detail = String(error)
      while (!lifecycle.exiting) {
        await dialog.showMessageBox({
          type: 'error',
          title: `${appName} 启动失败`,
          message: '应用无法启动',
          detail: `${detail}\n\n强制关闭将结束当前应用的终端、后台任务及 Terminal Host，未保存的内容可能丢失。`,
          buttons: ['强制关闭'],
          noLink: true,
        })
        try {
          await lifecycle.forceExit()
        } catch (cleanupError) {
          detail = `${String(error)}\n\n后台清理失败，应用暂未关闭，请重试。\n${String(cleanupError)}`
        }
      }
    }
  })()
}
