import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { AgentProvider, Preferences } from '../../shared/contracts'
import {
  AGENT_CLI_PACKAGES,
  isNewerVersion,
  type AgentCliStatus,
  type AgentCliInstallResult,
} from '../../shared/agent-cli'
import { detectAgents } from './registry'
import { findExecutable, loginShellEnvironment } from '../system/shell'
import { agentUpdateCommand, detectAgentInstallation } from './cli-installation'

export class AgentCliManagement {
  private installing = new Set<AgentProvider>()
  private latestVersions = new Map<string, { version: string; checkedAt: number }>()

  async inspect(
    settings: Preferences,
    checkUpdates: boolean,
    provider?: AgentProvider,
  ): Promise<AgentCliStatus[]> {
    const [detected, env] = await Promise.all([
      detectAgents(settings, provider),
      loginShellEnvironment(settings),
    ])
    return Promise.all(
      detected.map(async (entry): Promise<AgentCliStatus> => {
        const installation = entry.executable
          ? await detectAgentInstallation(entry.provider, entry.executable, env).catch(
              () => undefined,
            )
          : undefined
        const status: AgentCliStatus = {
          ...entry,
          installing: this.installing.has(entry.provider),
          installMethod: entry.executable ? (installation?.method ?? 'unknown') : undefined,
        }
        const cacheKey = JSON.stringify([entry.provider, installation ?? entry.executable])
        const cached = this.latestVersions.get(cacheKey)
        const cacheAge = cached ? Date.now() - cached.checkedAt : Infinity
        if (cached && cacheAge < 3 * 24 * 60 * 60 * 1000) {
          status.latestVersion = cached.version
        }
        if (checkUpdates && entry.executable && cacheAge >= 60_000) {
          try {
            const response = await fetch(
              installation?.latestUrl ??
                `https://registry.npmjs.org/${encodeURIComponent(AGENT_CLI_PACKAGES[entry.provider])}/latest`,
              { signal: AbortSignal.timeout(10000), redirect: 'error' },
            )
            if (!response.ok) throw new Error(`版本服务返回 ${response.status}`)
            const metadata = installation?.method === 'native' ? undefined : await response.json()
            const version =
              installation?.method === 'native'
                ? (await response.text()).trim()
                : installation?.method === 'brew' && !installation.cask
                  ? metadata?.versions?.stable
                  : metadata?.version
            if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
              throw new Error('版本服务返回了无效版本号。')
            status.latestVersion = version
            this.latestVersions.set(cacheKey, {
              version,
              checkedAt: Date.now(),
            })
          } catch (cause) {
            status.updateError =
              cause instanceof TypeError ||
              (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name))
                ? '请求超时'
                : cause instanceof Error
                  ? cause.message
                  : '版本检查失败。'
          }
        }
        if (
          entry.version &&
          /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version) &&
          status.latestVersion
        )
          status.updateAvailable = isNewerVersion(entry.version, status.latestVersion)
        return status
      }),
    )
  }

  async install(provider: AgentProvider, settings: Preferences): Promise<AgentCliInstallResult> {
    if (this.installing.size) throw new Error('已有 CLI 正在安装或更新，请等待完成。')
    this.installing.add(provider)
    try {
      const env = await loginShellEnvironment(settings)
      const executable = await findExecutable(provider, env).catch(() => {
        throw new Error('未检测到已安装的 CLI，请重新检测。')
      })
      const installation = await detectAgentInstallation(provider, executable, env).catch(
        () => undefined,
      )
      if (!installation) throw new Error('无法确认 CLI 的安装来源，请使用原安装方式手动更新。')
      const command = await agentUpdateCommand(provider, installation, env)
      const { stdout, stderr } = await promisify(execFile)(command.executable, command.args, {
        cwd: homedir(),
        env: command.env,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 512 * 1024,
      }).catch((cause: unknown) => {
        const error = cause as Error & { stderr?: string }
        throw new Error(`更新失败：${(error.stderr || error.message).slice(-8000)}`)
      })
      const detected = (await this.inspect(settings, true, provider)).find(
        (entry) => entry.provider === provider,
      )!
      detected.installing = false
      if (!detected.executable)
        throw new Error(
          '更新命令已完成，但 PATH 中仍未检测到 CLI。请检查原安装目录是否已加入 PATH，然后重新检测。',
        )
      if (detected.updateAvailable)
        throw new Error(
          `更新命令已完成，但当前检测到的 ${detected.version} 仍不是最新版。PATH 可能优先使用了另一安装位置：${detected.executable}。`,
        )
      return { status: detected, output: `${stdout}\n${stderr}`.trim().slice(-16000) }
    } finally {
      this.installing.delete(provider)
    }
  }
}
