import { createServer, type Socket } from 'node:net'
import { chmod, unlink } from 'node:fs/promises'
import type { AgentSessionManager } from './agent-session-manager'

export async function startAgentEventServer(
  path: string,
  manager: AgentSessionManager,
  receive = (value: unknown, channel: object): Promise<boolean> =>
    Promise.resolve(manager.receive(value, channel)),
  authenticatedManaged = (_value: unknown): boolean => false,
) {
  let queued = 0
  const sockets = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    if (sockets.size >= 64) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    let buffer = Buffer.alloc(0)
    let processing = Promise.resolve()
    let pending = 0
    let rateStart = Date.now(),
      rate = 0
    const authTimer = setTimeout(() => socket.destroy(), 2000)
    socket.on('error', () => socket.destroy())
    socket.on('end', () => {
      if (buffer.length) socket.destroy()
      else void processing.finally(() => socket.end())
    })
    socket.on('close', () => {
      clearTimeout(authTimer)
      sockets.delete(socket)
      manager.disconnect(socket)
    })
    socket.on('data', (chunk: Buffer) => {
      let start = 0
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        if (buffer.length + end - start > 4096) {
          socket.destroy()
          return
        }
        buffer = Buffer.concat([buffer, chunk.subarray(start, end)])
        const now = Date.now()
        if (now - rateStart >= 1000) {
          rateStart = now
          rate = 0
        }
        if (++rate > 100) {
          socket.destroy()
          return
        }
        try {
          const value: unknown = JSON.parse(buffer.toString('utf8'))
          if (authenticatedManaged(value)) clearTimeout(authTimer)
          if (++pending > 8 || queued >= 64) {
            socket.destroy()
            return
          }
          queued++
          processing = processing
            .then(async () => {
              if (!(await receive(value, socket))) {
                socket.destroy()
                return
              }
              clearTimeout(authTimer)
              if (socket.destroyed) manager.disconnect(socket)
              else if ((value as { provider: string }).provider !== 'pi') socket.end()
            })
            .catch(() => socket.destroy())
            .then(() => {
              pending--
              queued--
            })
        } catch {
          socket.destroy()
          return
        }
        buffer = Buffer.alloc(0)
        start = end + 1
      }
      if (buffer.length + chunk.length - start > 4096) {
        socket.destroy()
        return
      }
      buffer = Buffer.concat([buffer, chunk.subarray(start)])
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  try {
    await chmod(path, 0o600)
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  }
  const expiry = setInterval(() => manager.expire(), 30_000)
  expiry.unref()
  return {
    async stop() {
      clearInterval(expiry)
      manager.disable()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
  }
}
