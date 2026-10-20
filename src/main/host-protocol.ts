import { Socket } from 'node:net'
import type {
  AttachTerminal,
  AgentUpdate,
  CreateTerminal,
  Preferences,
  TerminalAttachment,
  TerminalBinding,
  TerminalEvent,
  TerminalSession,
  WorkspaceTarget,
} from '../shared/contracts'

export const HOST_PROTOCOL = 6

export type ResolvedTerminalCreate = CreateTerminal & TerminalBinding
export interface ResolvedTerminalAttach extends AttachTerminal, TerminalBinding {}
export const MAX_FRAME = 64 * 1024 * 1024

export interface HostMethods {
  hello: { args: [token: string, version: number]; value: void }
  list: { args: []; value: TerminalSession[] }
  create: { args: [ResolvedTerminalCreate, Preferences]; value: void }
  attach: { args: [ResolvedTerminalAttach]; value: TerminalAttachment }
  detach: { args: [string, string]; value: void }
  write: { args: [string, string]; value: void }
  resize: { args: [string, number, number]; value: void }
  setScrollback: { args: [number]; value: void }
  readAgent: { args: [string, string, number]; value: void }
  acknowledge: { args: [string, string, number]; value: void }
  close: { args: [string]; value: void }
  needsCloseConfirmation: { args: [string]; value: boolean }
  closeProject: { args: [string]; value: void }
  closeWorkspace: { args: [WorkspaceTarget]; value: void }
  hasLive: { args: []; value: boolean }
  shutdown: { args: []; value: void }
}

export type HostMessage =
  | { type: 'request'; id: number; method: keyof HostMethods; args: unknown[] }
  | { type: 'response'; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: 'event'; event: TerminalEvent }
  | { type: 'agent'; event: AgentUpdate }

export function sendMessage(socket: Socket, value: HostMessage): void {
  const frame = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(frame) > MAX_FRAME) throw new Error('终端快照过大，无法传输。')
  if (socket.destroyed || socket.writableLength > 2 * 1024 * 1024) {
    socket.destroy()
    throw new Error('终端连接已断开或读取过慢。')
  }
  socket.write(frame)
}

export function readMessages(socket: Socket, receive: (value: HostMessage) => void): void {
  let chunks: Buffer[] = []
  let size = 0
  socket.on('data', (chunk: Buffer) => {
    let start = 0
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      const part = chunk.subarray(start, end)
      size += part.length
      if (size > MAX_FRAME) return socket.destroy()
      chunks.push(part)
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
        if (!value || typeof value !== 'object' || !('type' in value))
          throw new Error('协议消息无效。')
        receive(value as HostMessage)
      } catch {
        socket.destroy()
        return
      }
      chunks = []
      size = 0
      start = end + 1
    }
    const part = chunk.subarray(start)
    if (part.length) chunks.push(part)
    size += part.length
    if (size > MAX_FRAME) socket.destroy()
  })
}
