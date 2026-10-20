import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import type { AgentEventType } from '../../shared/contracts'
import { eventConnection, lifecycleEvent } from './event-client'

// Structural API keeps the bundled adapter independent of Pi's installation and module graph.
interface PiEvents {
  on(
    event: string,
    handler: (event: { aborted?: boolean; outcome?: 'completed' | 'aborted' | 'error' }) => void,
  ): void
}

export default function cotaLifecycle(pi: PiEvents): void {
  const guard = Symbol.for('cota.pi.lifecycle')
  const globals = globalThis as typeof globalThis & { [guard]?: boolean }
  if (globals[guard]) return
  globals[guard] = true
  const identity = { provider: 'pi' as const, sessionId: randomUUID() }
  let socket: Socket | undefined
  let turnId: string | undefined
  let promptDepth = 0
  let outcome: 'completed' | 'aborted' | 'error' | undefined
  const send = (type: AgentEventType, turn = turnId) => {
    const event = lifecycleEvent(type, turn, {}, identity)
    if (!event || !socket || socket.destroyed) return
    if (socket.writableLength > 16 * 1024) {
      socket.destroy()
      return
    }
    socket.write(`${JSON.stringify(event)}\n`)
  }
  pi.on('session_start', () => {
    if (socket) return
    socket = eventConnection()
    send('session-started')
  })
  pi.on('agent_start', () => {
    outcome = undefined
    turnId = randomUUID()
    send('turn-started')
  })
  pi.on('ui_prompt_start', () => {
    promptDepth++
    send('attention-required')
  })
  pi.on('ui_prompt_end', () => {
    promptDepth = Math.max(0, promptDepth - 1)
    if (!promptDepth) send(turnId ? 'turn-active' : 'activity-unknown')
  })
  pi.on('agent_before_settle', (event) => {
    outcome = event.outcome
  })
  pi.on('agent_settled', (event) => {
    send(
      event.aborted || outcome === 'aborted'
        ? 'turn-interrupted'
        : outcome === 'completed'
          ? 'turn-completed'
          : outcome === 'error'
            ? 'turn-failed'
            : 'activity-unknown',
    )
    turnId = undefined
  })
  pi.on('session_shutdown', () => {
    send('session-ended')
    socket?.end()
    socket = undefined
    delete globals[guard]
  })
}
