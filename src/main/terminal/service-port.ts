import { createServer } from 'node:net'

// shortcut: the listener must close before the child binds; applications must fail visibly on a bind race.
export async function claimServicePort(requested: number | 'auto') {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port: requested === 'auto' ? 0 : requested, host: '0.0.0.0' }, () => {
      server.removeListener('error', reject)
      resolve()
    })
  }).catch((error) => {
    throw new Error(
      `服务端口${requested === 'auto' ? '' : ` ${requested}`}不可用：${String(error)}`,
    )
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('无法分配服务端口。')
  }
  return {
    port: address.port,
    release: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
