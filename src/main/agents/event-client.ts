import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import type {
  AgentEventType,
  AgentLifecycleEvent,
  AgentProvider,
  ManagedAgentEvent,
} from '../../shared/contracts'

export function lifecycleEvent(
  type: AgentEventType,
  turnId?: string,
  details: Pick<
    AgentLifecycleEvent,
    'agentId' | 'requestId' | 'toolName' | 'requestDone' | 'waitingFor' | 'backgroundTasks'
  > = {},
  identity?: { provider: AgentProvider; sessionId: string },
): ManagedAgentEvent | undefined {
  const { COTA_AGENT_TOKEN: token, COTA_AGENT_TERMINAL: terminalId } = process.env
  if (
    !token ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !terminalId ||
    process.env.COTA_AGENT_MANAGED !== '1' ||
    !identity?.sessionId ||
    !['pi', 'codex', 'claude'].includes(identity.provider)
  )
    return
  return {
    token,
    terminalId,
    managed: true,
    processId: process.pid,
    sessionId: identity.sessionId,
    provider: identity.provider,
    eventId: randomUUID(),
    timestamp: Date.now(),
    type,
    ...(turnId ? { turnId } : {}),
    ...details,
  }
}

export function eventConnection(): Socket | undefined {
  const path = process.env.COTA_AGENT_SOCKET
  if (!path) return
  const socket = connect(path)
  socket.on('error', () => socket.destroy())
  return socket
}
