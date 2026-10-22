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
import { findExecutable, loginShellEnvironment, resolveCommand } from '../system/shell'

export class AgentCliManagement {
  private installing = new Set<AgentProvider>()

  async inspect(settings: Preferences, checkUpdates: boolean): Promise<AgentCliStatus[]> {
    const detected = await detectAgents(settings)
    return Promise.all(
      detected.map(async (entry): Promise<AgentCliStatus> => {
        const status: AgentCliStatus = { ...entry, installing: this.installing.has(entry.provider) }
        if (!checkUpdates) return status
        try {
          const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(AGENT_CLI_PACKAGES[entry.provider])}/latest`,
            { signal: AbortSignal.timeout(10000), redirect: 'error' },
          )
          if (!response.ok) throw new Error(`版本服务返回 ${response.status}`)
          const metadata = (await response.json()) as { version?: unknown }
          if (
            typeof metadata.version !== 'string' ||
            !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)
          )
            throw new Error('版本服务返回了无效版本号。')
          status.latestVersion = metadata.version
          if (entry.version)
            status.updateAvailable = isNewerVersion(entry.version, metadata.version)
        } catch (cause) {
          status.updateError = cause instanceof Error ? cause.message : '版本检查失败。'
        }
        return status
      }),
    )
  }

  async install(provider: AgentProvider, settings: Preferences): Promise<AgentCliInstallResult> {
    if (this.installing.size) throw new Error('已有 CLI 正在安装或更新，请等待完成。')
    this.installing.add(provider)
    try {
      const env = await loginShellEnvironment(settings)
      const npm = await findExecutable('npm', env).catch(() => {
        throw new Error('未找到 npm，请先安装 Node.js 22 或更新版本，再重试。')
      })
      const command = await resolveCommand(
        npm,
        [
          'install',
          '--global',
          ...(provider === 'pi' ? ['--ignore-scripts'] : []),
          `${AGENT_CLI_PACKAGES[provider]}@latest`,
        ],
        env,
      )
      const { stdout, stderr } = await promisify(execFile)(command.executable, command.args, {
        cwd: homedir(),
        env: command.env,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 512 * 1024,
      }).catch((cause: unknown) => {
        const error = cause as Error & { stderr?: string }
        throw new Error(`安装或更新失败：${(error.stderr || error.message).slice(-8000)}`)
      })
      const detected = (await this.inspect(settings, true)).find(
        (entry) => entry.provider === provider,
      )!
      detected.installing = false
      if (!detected.executable)
        throw new Error(
          '安装命令已完成，但 PATH 中仍未检测到 CLI。请检查 npm 全局目录是否已加入 PATH，然后重新检测。',
        )
      if (detected.updateAvailable)
        throw new Error(
          `安装命令已完成，但当前检测到的 ${detected.version} 仍不是最新版。PATH 可能优先使用了另一安装位置：${detected.executable}。`,
        )
      return { status: detected, output: `${stdout}\n${stderr}`.trim().slice(-16000) }
    } finally {
      this.installing.delete(provider)
    }
  }
}
