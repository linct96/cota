import { createServer, type Socket } from 'node:net'
import { chmod, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { TerminalManager } from './terminals'
import {
  HOST_PROTOCOL,
  readMessages,
  sendMessage,
  type HostMessage,
  type HostMethods,
  type ResolvedTerminalCreate,
  type ResolvedTerminalAttach,
} from './host-protocol'
import { absolutePath, terminalId } from './validation'
import type { AttachTerminal, Preferences, WorkspaceTarget } from '../shared/contracts'

export async function startHost(directory: string, token: string) {
  const clients = new Map<Socket, Map<string, string>>()
  const manager = new TerminalManager((event) => {
    for (const [socket, attachments] of clients) {
      if (attachments.get(event.id) !== event.attachmentId) continue
      try {
        sendMessage(socket, { type: 'event', event })
      } catch {
        socket.destroy()
      }
    }
  })
  const socketPath = join(directory, 'host.sock')
  const server = createServer((socket) => {
    const attachments = new Map<string, string>()
    clients.set(socket, attachments)
    let authenticated = false
    const authTimer = setTimeout(() => socket.destroy(), 5000)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      clearTimeout(authTimer)
      for (const [id, attachmentId] of attachments) manager.detach(id, attachmentId)
      clients.delete(socket)
    })
    const dispatch = async (method: keyof HostMethods, args: unknown[]) => {
      switch (method) {
        case 'list':
          return manager.list()
        case 'create':
          return manager.create(args[0] as ResolvedTerminalCreate, args[1] as Preferences)
        case 'attach': {
          const value = await manager.attach(args[0] as ResolvedTerminalAttach)
          const attachmentId = terminalId((args[0] as AttachTerminal).attachmentId)
          if (socket.destroyed) manager.detach(value.id, attachmentId)
          else attachments.set(value.id, attachmentId)
          return value
        }
        case 'detach': {
          const id = terminalId(args[0]),
            attachmentId = terminalId(args[1])
          if (attachments.get(id) === attachmentId) {
            manager.detach(id, attachmentId)
            attachments.delete(id)
          }
          return
        }
        case 'write':
          return manager.write(terminalId(args[0]), args[1])
        case 'resize':
          return manager.resize(terminalId(args[0]), args[1] as number, args[2] as number)
        case 'setScrollback':
          return manager.setScrollback(args[0])
        case 'acknowledge':
          return manager.acknowledge(terminalId(args[0]), terminalId(args[1]), args[2])
        case 'close':
          return manager.close(terminalId(args[0]))
        case 'needsCloseConfirmation':
          return manager.needsCloseConfirmation(terminalId(args[0]))
        case 'closeProject':
          return manager.closeProject(absolutePath(args[0]))
        case 'closeWorkspace':
          return manager.closeWorkspace(args[0] as WorkspaceTarget)
        case 'hasLive':
          return manager.hasLive()
        case 'shutdown':
          return manager.shutdown()
        default:
          throw new Error('未知的终端 Host 操作。')
      }
    }
    readMessages(socket, (message: HostMessage) => {
      if (
        message.type !== 'request' ||
        !Number.isSafeInteger(message.id) ||
        !Array.isArray(message.args)
      ) {
        socket.destroy()
        return
      }
      const request = message
      void (async () => {
        try {
          let value: unknown
          if (!authenticated) {
            const candidate = request.args[0]
            if (
              request.method !== 'hello' ||
              request.args[1] !== HOST_PROTOCOL ||
              typeof candidate !== 'string' ||
              Buffer.byteLength(candidate) !== Buffer.byteLength(token) ||
              !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
            ) {
              socket.destroy()
              return
            }
            authenticated = true
            clearTimeout(authTimer)
          } else value = await dispatch(request.method, request.args)
          sendMessage(socket, { type: 'response', id: request.id, ok: true, value })
          if (request.method === 'shutdown') void stop()
        } catch (error) {
          if (
            request.method === 'attach' &&
            request.args[0] &&
            typeof request.args[0] === 'object'
          ) {
            const options = request.args[0] as AttachTerminal
            if (attachments.get(options.id) === options.attachmentId) {
              manager.detach(options.id, options.attachmentId)
              attachments.delete(options.id)
            }
          }
          try {
            sendMessage(socket, {
              type: 'response',
              id: request.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          } catch {
            socket.destroy()
          }
        }
      })()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  await chmod(socketPath, 0o600)
  async function stop() {
    for (const socket of clients.keys()) socket.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  return { manager, stop }
}
