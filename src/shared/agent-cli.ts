import type { AgentAvailability, AgentProvider } from './contracts'

export const AGENT_CLI_PACKAGES: Record<AgentProvider, string> = {
  pi: '@earendil-works/pi-coding-agent',
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
}
export interface AgentCliStatus extends AgentAvailability {
  latestVersion?: string
  updateAvailable?: boolean
  updateError?: string
  installing?: boolean
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
  return a[4]!.startsWith('-') && !b[4]!.startsWith('-')
}
