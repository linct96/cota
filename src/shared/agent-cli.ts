import { z } from 'zod'
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
  native: '原生安装',
  unknown: '未知来源',
} as const

export interface AgentCliStatus extends AgentAvailability {
  installMethod?: keyof typeof AGENT_CLI_INSTALL_METHOD_LABELS
  latestVersion?: string
  updateAvailable?: boolean
  updateError?: string
  installing?: boolean
}
const agentCliStatusSchema = z.object({
  provider: z.enum(['pi', 'codex', 'claude']),
  executable: z
    .string()
    .max(32768)
    .refine((value) => /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value) && !value.includes('\0'))
    .optional(),
  version: z.string().max(100).optional(),
  error: z.string().max(8000).optional(),
  installMethod: z.enum(['brew', 'npm', 'scoop', 'native', 'unknown']).optional(),
  latestVersion: z.string().max(100).optional(),
  updateAvailable: z.boolean().optional(),
  updateError: z.string().max(8000).optional(),
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
  return a[4]!.startsWith('-') && !b[4]!.startsWith('-')
}
