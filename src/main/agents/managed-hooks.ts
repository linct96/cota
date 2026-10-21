import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AGENT_PROVIDERS, type AgentHookStatus, type AgentProvider } from '../../shared/contracts'
import { findExecutable } from '../shell'
import { trustCodexHooks } from './codex-hook-trust'
import { isWindows } from '../platform'

const marker = 'cota-managed-agent-hook:v1'
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// Stable loaders are shared by Dev/release; the owning terminal supplies its own adapter and credentials.
const launcher = isWindows
  ? `// ${marker}
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const { COTA_AGENT_SOCKET, COTA_AGENT_TOKEN, COTA_AGENT_RUNNER, COTA_AGENT_ADAPTER_DIR } = process.env
if (COTA_AGENT_SOCKET && COTA_AGENT_TOKEN && COTA_AGENT_RUNNER && COTA_AGENT_ADAPTER_DIR) {
  const result = spawnSync(COTA_AGENT_RUNNER, [join(COTA_AGENT_ADAPTER_DIR, 'agent-hook.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', COTA_AGENT_PROVIDER: process.argv[2] },
    stdio: ['inherit', 'inherit', 'ignore'], windowsHide: true, timeout: 1500,
  })
  if (result.error) process.stdout.write('{}')
} else process.stdout.write('{}')
`
  : `#!/bin/sh
# ${marker}
if [ -z "$COTA_AGENT_SOCKET" ] || [ -z "$COTA_AGENT_TOKEN" ] || [ -z "$COTA_AGENT_RUNNER" ] || [ -z "$COTA_AGENT_ADAPTER_DIR" ]; then
  cat >/dev/null
  exit 0
fi
export COTA_AGENT_PROVIDER="$1"
ELECTRON_RUN_AS_NODE=1 "$COTA_AGENT_RUNNER" "$COTA_AGENT_ADAPTER_DIR/agent-hook.js" 2>/dev/null || :
exit 0
`
const extension = `// ${marker}
import { pathToFileURL } from 'node:url'
export default async function cotaManagedStatus(pi) {
  const dir = process.env.COTA_AGENT_ADAPTER_DIR
  if (!dir || !process.env.COTA_AGENT_SOCKET || !process.env.COTA_AGENT_TOKEN) return
  try {
    const adapter = await import(pathToFileURL(dir + '/pi-extension.js').href)
    await adapter.default(pi)
  } catch { /* Missing Cota adapters must never prevent Pi from starting. */ }
}
`

export function hookFiles(provider: AgentProvider, env: Record<string, string>) {
  const home = env.HOME || env.USERPROFILE || homedir()
  const directory = (value: string | undefined, fallback: string) => {
    const path = value || fallback
    if (!isAbsolute(path)) throw new Error('CLI 配置目录必须是绝对路径。')
    return path
  }
  const loader = join(
    directory(home, homedir()),
    '.cota',
    'hooks',
    isWindows ? 'agent-hook.cjs' : 'agent-hook.sh',
  )
  const config =
    provider === 'pi'
      ? join(
          directory(env.PI_CODING_AGENT_DIR, join(home, '.pi', 'agent')),
          'extensions',
          'cota-agent-status.ts',
        )
      : provider === 'codex'
        ? join(directory(env.CODEX_HOME, join(home, '.codex')), 'hooks.json')
        : join(directory(env.CLAUDE_CONFIG_DIR, join(home, '.claude')), 'settings.json')
  if (isWindows && /["%\r\n]/.test(loader))
    throw new Error('Hooks 路径包含 Windows 命令无法安全处理的字符。')
  return {
    config,
    loader,
    command: isWindows ? `node "${loader}" ${provider}` : `/bin/sh ${quote(loader)} ${provider}`,
  }
}

function eventNames(provider: AgentProvider, version?: string) {
  const names = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Stop',
  ]
  const minor = /^0\.(\d+)\./.exec(version || '')
  if (provider === 'claude')
    names.push(
      'StopFailure',
      'Notification',
      'SessionEnd',
      'PostToolUseFailure',
      'SubagentStart',
      'SubagentStop',
    )
  else {
    if (minor && Number(minor[1]) >= 145) names.push('SubagentStart', 'SubagentStop')
    if (minor && Number(minor[1]) >= 159) names.push('Interrupt')
  }
  return names
}

async function contents(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`拒绝修改非普通文件：${path}`)
    if (stat.size > 1024 * 1024) throw new Error(`配置文件过大：${path}`)
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

function configuration(raw: string | undefined) {
  const config: unknown = raw === undefined ? {} : JSON.parse(raw)
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks)))
    throw new Error('Hooks 配置格式无效；请先修复原文件。')
  const hooks = (config.hooks || {}) as Record<string, unknown>
  for (const groups of Object.values(hooks)) {
    if (
      !Array.isArray(groups) ||
      groups.some(
        (group) =>
          !object(group) ||
          !Array.isArray(group.hooks) ||
          group.hooks.some((hook: unknown) => !object(hook)),
      )
    )
      throw new Error('Hooks 配置格式无效；不会覆盖现有内容。')
  }
  return { config, hooks }
}

export async function inspectAgentHook(
  provider: AgentProvider,
  env: Record<string, string>,
  version?: string,
): Promise<AgentHookStatus> {
  const status: AgentHookStatus = {
    provider,
    state: 'missing',
    paths: [],
    detail: '尚未安装 Cota 集成。',
  }
  try {
    const { config, loader, command } = hookFiles(provider, env)
    status.paths = provider === 'pi' ? [config] : [config, loader]
    if (provider === 'codex') {
      const trustConfig = join(dirname(config), 'config.toml')
      status.paths.push(trustConfig)
      await contents(trustConfig)
    }
    const raw = await contents(config)
    if (provider === 'pi') {
      status.state =
        raw === undefined
          ? 'missing'
          : !raw.includes('cota-managed-agent-hook:')
            ? 'conflict'
            : raw === extension
              ? 'installed'
              : 'outdated'
    } else {
      const { hooks } = configuration(raw)
      const own = (name: string) =>
        (hooks[name] as { hooks: Record<string, unknown>[] }[] | undefined)
          ?.flatMap((group) => group.hooks)
          .filter((hook) => hook.command === command) || []
      const present = eventNames(provider, version).some((name) => own(name).length > 0)
      const script = await contents(loader)
      if (script !== undefined && !script.includes('cota-managed-agent-hook:'))
        status.state = 'conflict'
      else if (
        eventNames(provider, version).every((name) =>
          own(name).some((hook) => hook.type === 'command' && hook.timeout === 2),
        ) &&
        script === launcher
      )
        status.state = 'installed'
      else status.state = present ? 'outdated' : 'missing'
    }
    status.detail = {
      installed:
        provider === 'codex'
          ? '文件已安装；检测不读取信任状态。如需审核信任，请在 Codex /hooks 中处理，仍需 CLI / 企业策略允许 Hooks。'
          : '文件已安装；是否实际加载以新终端的原生事件为准。',
      missing: '尚未安装 Cota 集成。',
      outdated: 'Cota 集成不完整或需要更新；不会自动修复。',
      conflict: '目标文件不属于 Cota；请手动处理，不会覆盖。',
      error: '',
    }[status.state]
  } catch (error) {
    status.state = 'error'
    status.detail = error instanceof Error ? error.message : String(error)
  }
  return status
}

// Compare before replace, optionally back up, and never follow a config-file symlink.
async function replaceFile(
  path: string,
  expected: string | undefined,
  next: string | undefined | (() => Promise<void>),
  { mode = 0o600, backup = true }: { mode?: number; backup?: boolean } = {},
) {
  if (expected === next) return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.cota-lock`
  const lock = await open(lockPath, 'wx', 0o600)
  const temporary = `${path}.cota-${randomUUID()}`
  try {
    if ((await contents(path)) !== expected)
      throw new Error('配置已被其他程序修改，请重新检测后重试。')
    if (expected !== undefined) {
      if (backup) {
        const file = await open(`${path}.cota-backup-${randomUUID()}`, 'wx', 0o600)
        try {
          await file.writeFile(expected)
        } finally {
          await file.close()
        }
      }
      mode = (await lstat(path)).mode & 0o777
    }
    if (typeof next === 'string') {
      const file = await open(temporary, 'wx', mode)
      try {
        await file.writeFile(next)
      } finally {
        await file.close()
      }
    }
    if ((await contents(path)) !== expected)
      throw new Error('配置已被其他程序修改，请重新检测后重试。')
    if (typeof next === 'function') await next()
    else if (next === undefined) await unlink(path)
    else await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
    await lock.close()
    await unlink(lockPath)
  }
}

// This is intentionally called only by the confirmed Settings install action, never startup/detection.
export async function installAgentHook(
  provider: AgentProvider,
  env: Record<string, string>,
  version?: string,
  executable?: string,
): Promise<AgentHookStatus> {
  if (!Object.hasOwn(AGENT_PROVIDERS, provider)) throw new Error('Agent 类型无效。')
  const status = await inspectAgentHook(provider, env, version)
  if (status.state === 'conflict' || status.state === 'error') throw new Error(status.detail)
  if (isWindows && provider !== 'pi') await findExecutable('node.exe', env)
  const { config, loader, command } = hookFiles(provider, env)
  const trustConfig = join(dirname(config), 'config.toml')
  const trustRaw = provider === 'codex' ? await contents(trustConfig) : undefined
  const codex =
    provider === 'codex' ? executable || (await findExecutable('codex', env)) : undefined
  const raw = await contents(config)
  if (provider === 'pi') {
    if (raw !== undefined && !raw.includes('cota-managed-agent-hook:'))
      throw new Error('目标扩展不属于 Cota。')
    await replaceFile(config, raw, extension)
  } else {
    const { config: data, hooks } = configuration(raw)
    const script = await contents(loader)
    if (script !== undefined && !script.includes('cota-managed-agent-hook:'))
      throw new Error('目标脚本不属于 Cota。')
    await replaceFile(loader, script, launcher, { mode: 0o700 })
    for (const name of eventNames(provider, version)) {
      const groups = (hooks[name] || []) as { hooks: Record<string, unknown>[] }[]
      // Preserve every user group and handler, including mixed groups containing an older Cota entry.
      hooks[name] = groups
        .map((group) => ({
          ...group,
          hooks: group.hooks.filter((hook) => hook.command !== command),
        }))
        .filter((group) => group.hooks.length)
      ;(hooks[name] as unknown[]).push({ hooks: [{ type: 'command', command, timeout: 2 }] })
    }
    const installed = `${JSON.stringify({ ...data, hooks }, null, 2)}\n`
    await replaceFile(config, raw, installed)
    if (codex) {
      try {
        await trustCodexHooks(codex, env, config, command, eventNames(provider, version), (write) =>
          replaceFile(trustConfig, trustRaw, async () => {
            if ((await contents(config)) !== installed || (await contents(loader)) !== launcher)
              throw new Error('Cota Hooks 已被其他程序修改。')
            await write()
          }),
        )
      } catch (error) {
        throw new Error(
          `Codex Hooks 文件已安装，但未确认信任成功。${error instanceof Error ? error.message : String(error)} 请点击“安装并信任”重试，或在 Codex /hooks 中审核。`,
        )
      }
    }
  }
  const installedStatus = await inspectAgentHook(provider, env, version)
  if (provider === 'codex' && installedStatus.state === 'installed')
    installedStatus.detail = '已安装并信任 Cota Hooks；请新建终端。仍需 CLI / 企业策略允许 Hooks。'
  return installedStatus
}

// Keep the shared loader: another provider or Cota Dev/release may still reference it.
export async function uninstallAgentHook(
  provider: AgentProvider,
  env: Record<string, string>,
): Promise<AgentHookStatus> {
  if (!Object.hasOwn(AGENT_PROVIDERS, provider)) throw new Error('Agent 类型无效。')
  const { config, command } = hookFiles(provider, env)
  const raw = await contents(config)
  if (provider === 'pi') {
    if (raw !== undefined && !raw.includes('cota-managed-agent-hook:'))
      throw new Error('目标扩展不属于 Cota。')
    await replaceFile(config, raw, undefined, { backup: false })
  } else {
    const { config: data, hooks } = configuration(raw)
    let changed = false
    for (const [name, value] of Object.entries(hooks)) {
      const groups = value as { hooks: Record<string, unknown>[] }[]
      if (!groups.some((group) => group.hooks.some((hook) => hook.command === command))) continue
      changed = true
      const remaining = groups.flatMap((group) => {
        const filtered = group.hooks.filter((hook) => hook.command !== command)
        if (filtered.length === group.hooks.length) return [group]
        return filtered.length ? [{ ...group, hooks: filtered }] : []
      })
      if (remaining.length) hooks[name] = remaining
      else delete hooks[name]
    }
    if (changed) {
      if (!Object.keys(hooks).length) delete data.hooks
      await replaceFile(config, raw, `${JSON.stringify(data, null, 2)}\n`, { backup: false })
    }
  }
  return inspectAgentHook(provider, env)
}
