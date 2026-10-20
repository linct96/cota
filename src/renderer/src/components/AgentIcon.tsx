import { ClaudeCode, OpenAI, Pi } from '@lobehub/icons'
import { Bot } from 'lucide-react'
import type { AgentProvider } from '../../../shared/contracts'

export interface AgentIconProps {
  provider?: AgentProvider
  size?: number
  className?: string
}

export function AgentIcon({ provider, size = 14, className }: AgentIconProps) {
  switch (provider) {
    case 'claude':
      return <ClaudeCode size={size} className={className} />
    case 'codex':
      return <OpenAI size={size} className={className} />
    case 'pi':
      return <Pi size={size} className={className} />
    default:
      return <Bot size={size} className={className} />
  }
}
