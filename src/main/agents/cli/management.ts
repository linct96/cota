import { AGENT_PROVIDERS } from '../../../shared/contracts'
import type { AgentProvider, Preferences } from '../../../shared/contracts'
import type { ConfigStore } from '../../settings/config-store'
import { AGENT_CLI_PACKAGES, isNewerVersion } from '../../../shared/agent-cli'
import type {
  AgentCliCache,
  AgentCliInstallResult,
  AgentCliStatus,
} from '../../../shared/agent-cli'
import { detectAgents, resolveAgent } from './registry'
import {
  ExecutableNotFoundError,
  findExecutable,
  loginShellEnvironment,
  resolveCommand,
} from '../../system/shell'
import { detectAgentInstallation } from './installation'
import type { ExecuteCliInstall } from './install-terminal'

export class AgentCliManagement {
  private installing = new Set<AgentProvider>()
  private latestVersions = new Map<string, { version: string; checkedAt: number }>()
  private queue: Promise<unknown> = Promise.resolve()
  private running = new Set<{ provider: AgentProvider }>()

  constructor(
    private readonly config: ConfigStore,
    private readonly publish: (cache: AgentCliCache) => void,
  ) {}

  async initialize(): Promise<void> {
    if (!this.config.snapshot().agentCliCache)
      await this.inspect(this.config.snapshot().preferences, false)
  }

  read(): AgentCliCache {
    const cache = this.config.snapshot().agentCliCache
    if (!cache) throw new Error('Agent CLI 缓存尚未初始化，请在设置中检测并刷新缓存。')
    return cache
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }

  private async save(entries: AgentCliStatus[], pathEnv: string): Promise<AgentCliCache> {
    const cache = {
      entries,
      pathEnv,
      checkedAt: Math.max(Date.now(), (this.config.snapshot().agentCliCache?.checkedAt ?? 0) + 1),
    }
    await this.config.saveAgentClis(cache)
    const saved = this.read()
    this.publish(saved)
    return saved
  }

  async run<T>(
    provider: AgentProvider,
    settings: Preferences,
    execute: (
      command: Awaited<ReturnType<typeof resolveAgent>>,
      cache: AgentCliCache,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.installing.has(provider)) throw new Error('该 Agent CLI 正在更新，请稍后重试。')
    const cache = this.read()
    const entry = cache.entries.find((candidateEntry) => candidateEntry.provider === provider)!
    if (!entry.executable)
      throw new Error(`${AGENT_PROVIDERS[provider].name} 未安装，请在设置中安装或重新检测。`)
    const running = { provider }
    this.running.add(running)
    try {
      const command = await resolveAgent(provider, settings, cache)
      if (command.cliExecutable !== entry.executable) {
        await this.replaceEntry(cache, provider, {
          provider,
          executable: command.cliExecutable,
          installMethod: 'unknown',
        })
      }
      return await execute(command, cache)
    } catch (error) {
      // A failed spawn can mean a deleted cwd, a missing interpreter or an ordinary CLI failure.
      try {
        await resolveAgent(provider, settings, cache)
      } catch (probeError) {
        if (probeError instanceof ExecutableNotFoundError) {
          const message = `${AGENT_PROVIDERS[provider].name} CLI 已不存在，启动失败。请在设置中重新安装或检测。`
          await this.replaceEntry(cache, provider, { provider })
          throw new Error(message, { cause: error })
        }
      }
      throw error
    } finally {
      this.running.delete(running)
    }
  }

  private replaceEntry(
    expected: AgentCliCache,
    provider: AgentProvider,
    entry: AgentCliStatus,
  ): Promise<void> {
    return this.enqueue(async () => {
      const current = this.read()
      if (
        JSON.stringify(current.entries.find((item) => item.provider === provider)) !==
        JSON.stringify(expected.entries.find((item) => item.provider === provider))
      )
        return
      await this.save(
        current.entries.map((item) => (item.provider === provider ? entry : item)),
        current.pathEnv,
      )
    })
  }

  inspect(
    settings: Preferences,
    checkUpdates: boolean,
    provider?: AgentProvider,
  ): Promise<AgentCliStatus[]> {
    return this.enqueue(() => this.inspectNow(settings, checkUpdates, provider))
  }

  private async inspectNow(
    settings: Preferences,
    checkUpdates: boolean,
    provider?: AgentProvider,
  ): Promise<AgentCliStatus[]> {
    const env = await loginShellEnvironment(settings)
    const previous = this.config.snapshot().agentCliCache
    const detected = await this.scan(settings, checkUpdates, previous ? provider : undefined, env)
    const entries =
      previous && provider
        ? previous.entries.map(
            (entry) => detected.find((item) => item.provider === entry.provider) ?? entry,
          )
        : detected
    const cache = await this.save(entries, env.PATH || '')
    return provider ? cache.entries.filter((entry) => entry.provider === provider) : cache.entries
  }

  private async scan(
    settings: Preferences,
    checkUpdates: boolean,
    provider: AgentProvider | undefined,
    env: Record<string, string>,
  ): Promise<AgentCliStatus[]> {
    const detected = await detectAgents(settings, provider, env)
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
            const metadata = await response.json()
            const version =
              installation?.method === 'brew' && !installation.cask
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

  async update(
    provider: AgentProvider,
    settings: Preferences,
    assertIdle: () => Promise<void>,
    execute: ExecuteCliInstall,
  ): Promise<AgentCliInstallResult> {
    if (this.installing.size) throw new Error('已有 CLI 正在更新，请等待完成。')
    if ([...this.running].some((entry) => entry.provider === provider))
      throw new Error('该 Agent CLI 正在启动或执行，请稍后更新。')
    this.installing.add(provider)
    return this.enqueue(async () => {
      try {
        await assertIdle()
        const env = await loginShellEnvironment(settings)
        let executable: string
        try {
          executable = await findExecutable(AGENT_PROVIDERS[provider].command, env)
        } catch (error) {
          if (!(error instanceof ExecutableNotFoundError)) throw error
          const status = { provider }
          await this.save(
            this.read().entries.map((entry) => (entry.provider === provider ? status : entry)),
            env.PATH || '',
          )
          return { status, output: '' }
        }
        const command = await resolveCommand(executable, ['update'], env)
        await assertIdle()
        const { stdout, stderr } = await execute(command).catch((cause: unknown) => {
          const error = cause as Error & { stderr?: string }
          throw new Error(`更新失败：${(error.stderr || error.message).slice(-8000)}`)
        })
        const detected = (await this.inspectNow(settings, true, provider)).find(
          (entry) => entry.provider === provider,
        )!
        detected.installing = false
        if (detected.error) throw new Error(detected.error)
        if (detected.updateAvailable)
          throw new Error(
            `更新命令已完成，但当前检测到的 ${detected.version} 仍不是最新版。PATH 可能优先使用了另一安装位置：${detected.executable}。`,
          )
        return { status: detected, output: `${stdout}\n${stderr}`.trim().slice(-16000) }
      } catch (error) {
        await this.inspectNow(settings, false, provider).catch(() => {})
        throw error
      } finally {
        this.installing.delete(provider)
      }
    })
  }
}
