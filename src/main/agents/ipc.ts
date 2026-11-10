import { shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { AGENT_PROVIDERS } from '../../shared/contracts'
import type { AgentProvider } from '../../shared/contracts'
import type { ConfigStore } from '../settings/config-store'
import type { HostClient } from '../host/host-client'
import type { AppLifecycle } from '../app/lifecycle'
import type { AppRenderer } from '../app/renderer'
import type { IpcHandler } from '../app/ipc'
import { agentProvider, terminalId } from '../validation'
import { loginShellEnvironment, shellEnvironment } from '../system/shell'
import type { AgentCliManagement } from './cli/management'
import type { AgentCliInstallTerminals } from './cli/install-terminal'
import {
  inspectAgentHook,
  installAgentHook,
  trustAgentHook,
  uninstallAgentHook,
} from './hooks/managed'

const agentInstallGuides: Record<AgentProvider, string> = {
  pi: 'https://pi.dev/docs/latest/quickstart#1-install-pi',
  codex: 'https://github.com/openai/codex#installing-and-running-codex-cli',
  claude: 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code',
}

export function registerAgentsIPC(deps: {
  handle: IpcHandler
  config: ConfigStore
  manager: HostClient
  agentClis: AgentCliManagement
  cliInstallTerminals: AgentCliInstallTerminals
  lifecycle: AppLifecycle
  renderer: AppRenderer
  getWindow: () => BrowserWindow | undefined
}): void {
  const { handle, config, manager, lifecycle, renderer, agentClis, cliInstallTerminals } = deps
  handle('agent:cli-read', () => agentClis.read())
  handle('agent:cli-inspect', (checkUpdates: unknown = false, value?: unknown) => {
    if (typeof checkUpdates !== 'boolean') throw new Error('版本检查选项无效。')
    const provider = value === undefined ? undefined : agentProvider(value)
    return agentClis.inspect(config.snapshot().preferences, checkUpdates, provider)
  })
  handle('agent:cli-install-guide', async (value: unknown) => {
    await shell.openExternal(agentInstallGuides[agentProvider(value)])
  })
  handle('agent:cli-update', async (value: unknown) => {
    lifecycle.assertAvailable()
    const provider = agentProvider(value)
    return cliInstallTerminals.run(provider, (execute) =>
      agentClis.update(
        provider,
        config.snapshot().preferences,
        async () => {
          lifecycle.assertAvailable()
          if (
            (await manager.request('list', [])).some(
              (session) => session.provider === provider && !session.exited,
            )
          )
            throw new Error('请先关闭 Cota 中正在运行的该智能体终端，再更新。')
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
    const env = await loginShellEnvironment(config.snapshot().preferences)
    const agents = agentClis.read().entries
    return Promise.all(
      (Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) =>
        inspectAgentHook(
          provider,
          env,
          agents.find((agent) => agent.provider === provider)?.version,
          agents.find((agent) => agent.provider === provider)?.executable,
        ),
      ),
    )
  })
  for (const operation of ['install', 'trust', 'uninstall'] as const) {
    handle(`agent:hooks-${operation}`, async (value: unknown) => {
      const provider = agentProvider(value)
      const env = shellEnvironment()
      const uninstall = operation === 'uninstall'
      const trust = operation === 'trust'
      if (trust && provider !== 'codex') throw new Error('仅 Codex 支持单独信任 Hooks。')
      const label = uninstall ? '卸载' : trust ? '信任' : '安装'
      // The installed CLI version determines supported Hook events, not trust consent.
      const codex =
        !uninstall && provider === 'codex'
          ? (await agentClis.inspect(config.snapshot().preferences, false, provider)).find(
              (agent) => agent.provider === provider,
            )
          : undefined
      if (trust && !codex?.executable) throw new Error('找不到 Codex，无法信任 Hooks。')
      const version = codex?.version
      const status = await inspectAgentHook(provider, env, version)
      if (status.state === 'conflict' || status.state === 'error') throw new Error(status.detail)
      if (trust && status.state !== 'installed')
        throw new Error('请先安装或更新 Codex 的 Cota Hooks，再授予信任。')
      const window = deps.getWindow()
      if (!renderer.ready || !window || window.webContents.isDestroyed() || renderer.confirming)
        throw new Error(
          uninstall
            ? '当前无法显示卸载确认，请关闭其他确认弹窗后重试；仍无响应时请重新打开应用。'
            : `当前无法${label}，请关闭其他确认弹窗后重试；仍无响应时请重新打开应用。`,
        )
      if (operation === 'install') return installAgentHook(provider, env, version)
      if (trust)
        return trustAgentHook(
          provider,
          await loginShellEnvironment(config.snapshot().preferences),
          version,
          codex?.executable,
        )
      if (
        !(await renderer.confirm({
          title: `卸载 ${AGENT_PROVIDERS[provider].name} 状态集成？`,
          description: '不会退出正在运行的 Agent；重启 Agent 后停止状态同步。',
          confirmLabel: '卸载',
        }))
      )
        return null
      return uninstallAgentHook(provider, env)
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
