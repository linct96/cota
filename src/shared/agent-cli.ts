import { z } from 'zod'
import { AGENT_PROVIDERS } from './contracts'
import type { AgentAvailability, AgentProvider } from './contracts'

export const AGENT_CLI_PACKAGES: Record<AgentProvider, string> = {
  pi: '@earendil-works/pi-coding-agent',
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
}
export const AGENT_CLI_INSTALL_METHOD_LABELS = {
  brew: 'Homebrew',
  npm: 'npm',
  scoop: 'Scoop',
  unknown: '其他来源',
} as const

export interface AgentCliStatus extends AgentAvailability {
  installMethod?: keyof typeof AGENT_CLI_INSTALL_METHOD_LABELS
  latestVersion?: string
  updateAvailable?: boolean
  updateError?: string
  installing?: boolean
}
const agentCliStatusSchema = z
  .object({
    provider: z.enum(['pi', 'codex', 'claude']),
    executable: z
      .string()
      .max(32768)
      .refine((value) => /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value) && !value.includes('\0'))
      .optional(),
    version: z.string().max(100).optional(),
    error: z.string().max(8000).optional(),
    installMethod: z
      .enum(['brew', 'npm', 'scoop', 'native', 'unknown'])
      .transform((method) => (method === 'native' ? 'unknown' : method))
      .optional(),
    latestVersion: z.string().max(100).optional(),
    updateAvailable: z.boolean().optional(),
    updateError: z.string().max(8000).optional(),
  })
  .transform((entry) => {
    const definition = AGENT_PROVIDERS[entry.provider]
    // Older caches treated a missing CLI as a detection error.
    if (
      !entry.executable &&
      (entry.error ===
        `找不到 ${definition.command}。请安装其命令行工具，并检查登录 Shell 的 PATH。` ||
        entry.error === `${definition.name} CLI 已不存在，启动失败。请在设置中重新安装或检测。`)
    )
      delete entry.error
    return entry
  })

export const agentCliCacheSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  pathEnv: z
    .string()
    .max(131072)
    .refine((value) => !value.includes('\0')),
  entries: z
    .array(agentCliStatusSchema)
    .length(3)
    .refine((entries) => new Set(entries.map((entry) => entry.provider)).size === 3),
})
export type AgentCliCache = z.infer<typeof agentCliCacheSchema>

export const AGENT_CLI_INSTALL_SCROLLBACK = 200

export interface AgentCliInstallRun {
  id: string
  provider: AgentProvider
  status: 'running' | 'succeeded' | 'failed' | 'not-installed'
  error?: string
}

export interface AgentCliInstallEvent {
  run: AgentCliInstallRun
  revision: number
  attachmentId?: string
  data?: string
}

export interface AgentCliInstallTerminal {
  run: AgentCliInstallRun
  revision: number
  output: string
  cols: number
  rows: number
}

export interface AgentCliInstallResult {
  status: AgentCliStatus
  output: string
}

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(value)
  const a = parse(current),
    b = parse(latest)
  if (!a || !b) return false
  for (let index = 1; index <= 3; index++) {
    const difference = Number(b[index]) - Number(a[index])
    if (difference) return difference > 0
  }
  return a[4].startsWith('-') && !b[4].startsWith('-')
}
