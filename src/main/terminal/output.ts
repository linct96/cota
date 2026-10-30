import type { TerminalEvent } from '../../shared/contracts'
import type { Session } from './session'

export function flow(session: Session): void {
  if (session.exited || !session.child) return
  if (!session.paused && (session.parsing >= 131072 || session.inFlight >= 131072)) {
    session.paused = true
    session.child.pause()
  } else if (session.paused && session.parsing < 65536 && session.inFlight < 65536) {
    session.paused = false
    session.child.resume()
  }
}
export function flush(session: Session, send: (event: TerminalEvent) => void): void {
  if (session.timer) clearTimeout(session.timer)
  session.timer = undefined
  const data = session.pending.join('')
  session.pending = []
  if (!data || !session.attachmentId) return
  send({ type: 'data', id: session.id, attachmentId: session.attachmentId, data })
}
