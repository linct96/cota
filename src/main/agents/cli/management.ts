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
  private providerQueues = new Map<AgentProvider, Promise<unknown>>()
  private running = new Set<{ provider: AgentProvider }>()
  private updateRevision = 0

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

  private enqueueProvider<T>(provider: AgentProvider, operation: () => Promise<T>): Promise<T> {
    const pending = (this.providerQueues.get(provider) ?? Promise.resolve()).then(operation)
    this.providerQueues.set(
      provider,
      pending.catch(() => {}),
    )
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

  isUpdating(provider: AgentProvider): boolean {
    return this.installing.has(provider)
  }

  async use<T>(provider: AgentProvider, operation: () => Promise<T>): Promise<T> {
    if (this.installing.has(provider)) throw new Error('该 Agent CLI 正在更新，请稍后重试。')
    const running = { provider }
    this.running.add(running)
    try {
      return await operation()
    } finally {
      this.running.delete(running)
    }
  }

  run<T>(
    provider: AgentProvider,
    settings: Preferences,
    execute: (
      command: Awaited<ReturnType<typeof resolveAgent>>,
      cache: AgentCliCache,
    ) => Promise<T>,
  ): Promise<T> {
    return this.use(provider, async () => {
      const cache = this.read()
      const entry = cache.entries.find((candidateEntry) => candidateEntry.provider === provider)!
      if (!entry.executable)
        throw new Error(`${AGENT_PROVIDERS[provider].name} 未安装，请在设置中安装或重新检测。`)
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
      }
    })
  }

  private replaceEntry(
    expected: AgentCliCache,
    provider: AgentProvider,
    entry: AgentCliStatus,
  ): Promise<void> {
    return this.enqueue(async () => {
      const current = this.read()
      if (
        current.pathEnv !== expected.pathEnv ||
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

  async inspect(
    settings: Preferences,
    checkUpdates: boolean,
    provider?: AgentProvider,
  ): Promise<AgentCliStatus[]> {
    if (!this.config.snapshot().agentCliCache) {
      const initialized = await this.enqueue(async () => {
        if (this.config.snapshot().agentCliCache) return undefined
        const env = await loginShellEnvironment(settings)
        return this.save(await this.scan(settings, checkUpdates, undefined, env), env.PATH || '')
      })
      if (initialized)
        return provider
          ? initialized.entries.filter((entry) => entry.provider === provider)
          : initialized.entries
    }
    if (!provider) return this.synchronize(settings, checkUpdates)
    const cached = () => this.read().entries.find((entry) => entry.provider === provider)!
    if (this.installing.has(provider)) return [cached()]
    return [
      await this.enqueueProvider(provider, async () =>
        this.installing.has(provider)
          ? cached()
          : this.inspectNow(settings, checkUpdates, provider),
      ),
    ]
  }

  private async mergeEntries(
    entries: AgentCliStatus[],
    pathEnv: string,
    expected: AgentCliCache,
  ): Promise<AgentCliCache | undefined> {
    return this.enqueue(async () => {
      const current = this.read()
      if (
        current.pathEnv !== expected.pathEnv ||
        entries.some(
          ({ provider }) =>
            JSON.stringify(current.entries.find((entry) => entry.provider === provider)) !==
            JSON.stringify(expected.entries.find((entry) => entry.provider === provider)),
        )
      )
        return undefined
      return this.save(
        current.entries.map(
          (entry) => entries.find((item) => item.provider === entry.provider) ?? entry,
        ),
        pathEnv,
      )
    })
  }

  private async synchronize(
    settings: Preferences,
    checkUpdates: boolean,
    completed?: AgentProvider,
  ): Promise<AgentCliStatus[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const expected = this.read()
      const revision = this.updateRevision
      const env = await loginShellEnvironment(settings)
      const detected = await Promise.all(
        (Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) => {
          if (this.installing.has(provider) && provider !== completed)
            return Promise.resolve(undefined)
          return this.enqueueProvider(provider, async () => {
            if (this.installing.has(provider) && provider !== completed) return undefined
            return (await this.scan(settings, checkUpdates, provider, env))[0]
          })
        }),
      )
      const entries = detected.filter((entry): entry is AgentCliStatus => entry !== undefined)
      const cache = await this.mergeEntries(entries, env.PATH || '', expected)
      if (this.updateRevision !== revision) {
        if ([...this.installing].some((provider) => provider !== completed))
          return this.read().entries
        continue
      }
      if (cache) return cache.entries
    }
    throw new Error('Shell 环境或 CLI 状态持续变化，请重新检测。')
  }

  private async inspectNow(
    settings: Preferences,
    checkUpdates: boolean,
    provider: AgentProvider,
  ): Promise<AgentCliStatus> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const expected = this.read()
      const env = await loginShellEnvironment(settings)
      const detected = await this.scan(settings, checkUpdates, provider, env)
      const cache = await this.mergeEntries(detected, env.PATH || '', expected)
      if (cache) return cache.entries.find((entry) => entry.provider === provider)!
    }
    throw new Error('Shell 环境或 CLI 状态持续变化，请重新检测。')
  }

  private async scan(
    settings: Preferences,
    checkUpdates: boolean,
    provider: AgentProvider | undefined,
    env: Record<string, string>,
  ): Promise<AgentCliStatus[]> {
    const previous = this.config.snapshot().agentCliCache?.entries
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
        const prior = previous?.find((item) => item.provider === entry.provider)
        if (
          !checkUpdates &&
          prior?.updateError &&
          status.executable === prior.executable &&
          status.version === prior.version &&
          status.installMethod === prior.installMethod
        )
          status.updateError = prior.updateError
        const cacheKey = JSON.stringify([entry.provider, installation ?? entry.executable])
        const cached = this.latestVersions.get(cacheKey)
        const cacheAge = cached ? Date.now() - cached.checkedAt : Infinity
        if (cached && cacheAge < 3 * 24 * 60 * 60 * 1000) {
          status.latestVersion = cached.version
        }
        const npmPackage = AGENT_CLI_PACKAGES[entry.provider]
        const latestUrl =
          installation?.latestUrl ??
          (npmPackage && `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}/latest`)
        if (checkUpdates && entry.executable && latestUrl && cacheAge >= 60_000) {
          try {
            const response = await fetch(latestUrl, {
              signal: AbortSignal.timeout(10000),
              redirect: 'error',
            })
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
    this.read()
    if (this.installing.has(provider)) throw new Error('该 Agent CLI 正在更新，请稍后重试。')
    if ([...this.running].some((entry) => entry.provider === provider))
      throw new Error('该 Agent CLI 正在启动或执行，请稍后更新。')
    this.updateRevision++
    this.installing.add(provider)
    let result: AgentCliInstallResult | undefined
    let failure: unknown
    let failed = false
    let refreshFailure: unknown
    try {
      result = await this.enqueueProvider(provider, async () => {
        try {
          await assertIdle()
          const env = await loginShellEnvironment(settings)
          let executable: string
          try {
            executable = await findExecutable(AGENT_PROVIDERS[provider].command, env)
          } catch (error) {
            if (!(error instanceof ExecutableNotFoundError)) throw error
            const status = await this.inspectNow(settings, false, provider)
            if (status.error) throw new Error(status.error)
            if (status.executable) throw new Error('CLI 状态已变化，请重新更新。')
            return { status, output: '' }
          }
          const command = await resolveCommand(executable, ['update'], env)
          await assertIdle()
          const { stdout, stderr } = await execute(command).catch((cause: unknown) => {
            const error = cause as Error & { stderr?: string }
            throw new Error(`更新失败：${(error.stderr || error.message).slice(-8000)}`)
          })
          const detected = await this.inspectNow(settings, true, provider)
          detected.installing = false
          if (detected.error) throw new Error(detected.error)
          return { status: detected, output: `${stdout}\n${stderr}`.trim().slice(-16000) }
        } catch (error) {
          await this.inspectNow(settings, false, provider).catch((cause) => {
            refreshFailure = cause
          })
          throw error
        }
      })
    } catch (error) {
      failed = true
      failure = error
    }
    try {
      if (this.installing.size === 1) {
        const entries = await this.synchronize(settings, false, provider)
        const status = entries.find((entry) => entry.provider === provider)!
        if (
          status.error &&
          (!failed || !(failure instanceof Error) || failure.message !== status.error)
        )
          throw new Error(status.error)
        if (result) result.status = status.executable ? { ...status, installing: false } : status
        refreshFailure = undefined
      }
    } catch (error) {
      refreshFailure = error
    } finally {
      this.installing.delete(provider)
    }
    if (refreshFailure !== undefined) {
      const detail =
        refreshFailure instanceof Error
          ? refreshFailure.message
          : typeof refreshFailure === 'string'
            ? refreshFailure
            : '未知错误'
      const original = failed
        ? `${failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : '更新失败。'}\n`
        : result?.status.executable
          ? '更新命令已完成。\n'
          : ''
      throw new Error(`${original}缓存同步失败：${detail}。请重新检测。`, {
        cause: failed ? failure : refreshFailure,
      })
    }
    if (failed) throw failure
    const updated = result!
    if (updated.status.updateAvailable)
      throw new Error(
        `更新命令已完成，但当前检测到的 ${updated.status.version} 仍不是最新版。PATH 可能优先使用了另一安装位置：${updated.status.executable}。`,
      )
    return updated
  }
}
