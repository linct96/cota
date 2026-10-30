import type * as pty from 'node-pty'
import type { Terminal } from '@xterm/headless'
import type { SerializeAddon } from '@xterm/addon-serialize'
import type {
  TerminalSession,
  TerminalLaunch,
  Preferences,
  ManagedAgentEvent,
} from '../../shared/contracts'
import type { AgentProcessRow } from '../agents/runtime/process-observation'
import type { createTerminalKeyboardState } from '../../shared/terminal-keyboard-state'

export interface Session extends TerminalSession {
  launch: TerminalLaunch
  shellActivityToken?: string
  child?: pty.IPty
  processStarted?: Promise<string | undefined>
  shell?: string
  managed?: {
    token: string
    settings: Preferences
    cliCache?: import('../../shared/agent-cli').AgentCliCache
    run?: {
      owner: AgentProcessRow
      process?: AgentProcessRow
      provider: ManagedAgentEvent['provider']
      token?: string
      ready?: Promise<void>
      ended?: boolean
      eventStartedAt: number
    }
  }
  creation?: Promise<void>
  stoppingService?: Promise<void>
  screen: Terminal
  serializer: SerializeAddon
  keyboard: ReturnType<typeof createTerminalKeyboardState>
  pending: string[]
  timer?: ReturnType<typeof setTimeout>
  parsing: number
  inFlight: number
  attachmentId?: string
  paused: boolean
  closing?: Promise<void>
  subscriptions: pty.IDisposable[]
  attaching: Set<(error: Error) => void>
}
