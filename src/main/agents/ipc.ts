import type { BrowserWindow } from 'electron'
import { AGENT_PROVIDERS, type AgentProvider } from '../../shared/contracts'
import type { ConfigStore } from '../settings/config-store'
import type { HostClient } from '../host/host-client'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler } from '../app/ipc'
import { agentProvider, terminalId } from '../validation'
import { loginShellEnvironment, shellEnvironment } from '../system/shell'
import type { AgentCliManagement } from './cli/management'
import type { AgentCliInstallTerminals } from './cli/install-terminal'
import { hookFiles, inspectAgentHook, installAgentHook, uninstallAgentHook } from './hooks/managed'

export function registerAgentsIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  manager: HostClient
  agentClis: AgentCliManagement
  cliInstallTerminals: AgentCliInstallTerminals
  lifecycle: AppLifecycle
  renderer: AppRenderer
  getWindow(): BrowserWindow | undefined
}): void {
  const { handle, config, manager, lifecycle, renderer, agentClis, cliInstallTerminals } = deps
  handle('agent:cli-read', () => agentClis.read())
  handle('agent:cli-inspect', (checkUpdates: unknown = false, value?: unknown) => {
    if (typeof checkUpdates !== 'boolean') throw new Error('版本检查选项无效。')
    const provider = value === undefined ? undefined : agentProvider(value)
    return agentClis.inspect(config.snapshot().preferences, checkUpdates, provider)
  })
  handle('agent:cli-install', async (value: unknown) => {
    lifecycle.assertAvailable()
    const provider = agentProvider(value)
    return cliInstallTerminals.run(provider, (execute) =>
      agentClis.install(
        provider,
        config.snapshot().preferences,
        async () => {
          lifecycle.assertAvailable()
          if (
            (await manager.request('list', [])).some(
              (session) => session.provider === provider && !session.exited,
            )
          )
            throw new Error('请先关闭 Cota 中正在运行的该智能体终端，再安装或更新。')
        },
        execute,
      ),
    )
  })
  handle('agent:cli-install-list', () => cliInstallTerminals.list())
  handle('agent:cli-install-terminal', (value: unknown, attachment: unknown) =>
    cliInstallTerminals.snapshot(agentProvider(value), terminalId(attachment)),
  )
  handle('agent:cli-install-detach', (value: unknown, attachment: unknown) =>
    cliInstallTerminals.detach(agentProvider(value), terminalId(attachment)),
  )
  handle('agent:cli-install-ack', (value: unknown, attachment: unknown, length: unknown) =>
    cliInstallTerminals.acknowledge(agentProvider(value), terminalId(attachment), length),
  )
  handle('agent:cli-install-write', (id: unknown, data: unknown, encoding: unknown = 'utf8') =>
    cliInstallTerminals.write(terminalId(id), data, encoding),
  )
  handle('agent:cli-install-resize', (id: unknown, cols: unknown, rows: unknown) =>
    cliInstallTerminals.resize(terminalId(id), cols, rows),
  )
  handle('agent:hooks-detect', async () => {
    const env = shellEnvironment()
    const agents = agentClis.read().entries
    return Promise.all(
      (Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) =>
        inspectAgentHook(
          provider,
          env,
          agents.find((agent) => agent.provider === provider)?.version,
        ),
      ),
    )
  })
  for (const operation of ['install', 'uninstall'] as const) {
    handle(`agent:hooks-${operation}`, async (value: unknown) => {
      const provider = agentProvider(value)
      const env = shellEnvironment()
      const uninstall = operation === 'uninstall'
      const label = uninstall ? '卸载' : '安装'
      const trust = !uninstall && provider === 'codex'
      const actionLabel = trust ? '安装并信任' : label
      const integrationLabel = provider === 'pi' ? 'Extension' : 'Hooks'
      const trustDescription = trust
        ? '同时授权信任本次安装的 Cota Hooks，使用 Codex 原生定义哈希；不信任其他 Hooks，不修改 Hooks 功能开关，不绕过企业策略。'
        : ''
      // Codex supplies the native trust hashes and selects supported Hook events.
      const codex = trust
        ? (await agentClis.inspect(config.snapshot().preferences, false, provider)).find(
            (agent) => agent.provider === provider,
          )
        : undefined
      if (trust && !codex?.executable) throw new Error('找不到 Codex，无法安装并信任 Hooks。')
      const version = codex?.version
      const status = await inspectAgentHook(provider, env, version)
      if (status.state === 'conflict' || status.state === 'error') throw new Error(status.detail)
      const window = deps.getWindow()
      if (!renderer.ready || !window || window.webContents.isDestroyed() || renderer.confirming)
        throw new Error(
          `当前无法显示${label}确认，请关闭其他确认弹窗后重试；仍无响应时请重新打开应用。`,
        )
      if (
        !(await renderer.confirm({
          title: `${actionLabel} ${AGENT_PROVIDERS[provider].name} 的 Cota 状态集成？`,
          description: uninstall
            ? `仅在本次确认后移除以下文件中的 Cota 集成：\n${hookFiles(provider, env).config}\n\n保留其他 Hooks 和配置，卸载不创建备份；共享加载脚本不删除。Dev / 正式版共用此配置，均受影响。不会结束正在运行的 Agent，已加载的集成需重启对应 CLI 后停止生效。`
            : `仅在本次确认后写入以下文件：\n${status.paths.join('\n')}\n\n保留原有 Hooks，修改已有文件前创建备份。${trustDescription}不改变 CLI 权限。安装后请新建终端。`,
          confirmLabel: `${actionLabel} ${integrationLabel}`,
        }))
      )
        return null
      if (uninstall) return uninstallAgentHook(provider, env)
      return installAgentHook(
        provider,
        trust ? await loginShellEnvironment(config.snapshot().preferences) : env,
        version,
        codex?.executable,
      )
    })
  }
  handle('agent:visible', (id: unknown) => {
    renderer.visibleTerminal = id === undefined ? undefined : terminalId(id)
  })
  handle('agent:read', (id: unknown, launchId: unknown, revision: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0)
      throw new Error('Agent 状态版本无效。')
    return manager.request('readAgent', [terminalId(id), terminalId(launchId), Number(revision)])
  })
}
