import type { Socket } from 'node:net'
import { normalizeHook } from './normalize'
import { eventConnection, lifecycleEvent } from './event-client'

let size = 0
const chunks: Buffer[] = []
let socket: Socket | undefined
let finished = false
let sent = false
let sessionId: string | undefined
const [provider, hookName] = (process.env.COTA_AGENT_PROVIDER || '').split(':')
const hookProvider =
  provider === 'claude' || provider === 'codex' || provider === 'agy' ? provider : undefined
const finish = () => {
  if (finished) return
  finished = true
  clearTimeout(timer)
  clearTimeout(inputTimer)
  process.stdin.destroy()
  socket?.destroy()
  // Empty output cannot approve, deny, rewrite, or continue an Agent operation.
  process.stdout.write('{}')
}
const timer = setTimeout(finish, 1500)
const inputTimer = setTimeout(() => send({ type: 'integration-unavailable' }), 1000)
const send = (metadata: NonNullable<ReturnType<typeof normalizeHook>>) => {
  if (finished || sent) return
  sent = true
  clearTimeout(inputTimer)
  process.stdin.destroy()
  const { type, turnId, ...details } = metadata
  const event = lifecycleEvent(
    type,
    turnId,
    details,
    sessionId && hookProvider ? { provider: hookProvider, sessionId } : undefined,
  )
  if (!event || !(socket = eventConnection())) {
    finish()
    return
  }
  socket.once('error', finish)
  socket.once('close', finish)
  socket.end(`${JSON.stringify(event)}\n`)
}
process.stdin.on('error', finish)
process.stdin.on('data', (chunk: Buffer) => {
  size += chunk.length
  if (size > 1024 * 1024) {
    chunks.length = 0
    process.stdin.pause()
    send({ type: 'integration-unavailable' })
  } else chunks.push(chunk)
})
process.stdin.on('end', () => {
  if (finished || sent) return
  try {
    if (!hookProvider) {
      finish()
      return
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
    const sessionKey = hookProvider === 'agy' ? 'conversationId' : 'session_id'
    if (input && typeof input === 'object' && Object.hasOwn(input, sessionKey)) {
      const value = (input as Record<string, unknown>)[sessionKey]
      if (typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)) sessionId = value
    }
    const event = normalizeHook(hookProvider, input, hookName)
    chunks.length = 0
    if (event) send(event)
    else finish()
  } catch {
    chunks.length = 0
    send({ type: 'integration-unavailable' })
  }
})
