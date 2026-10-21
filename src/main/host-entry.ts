import { startHost } from './host-server'

const directory = process.env.COTA_HOST_DIRECTORY
const token = process.env.COTA_HOST_TOKEN
delete process.env.COTA_HOST_DIRECTORY
delete process.env.COTA_HOST_TOKEN
if (!directory || !token) throw new Error('Terminal Host 缺少启动凭据。')

// Native ConPTY workers can retain event-loop handles after their terminal exits.
// Only this dedicated process exits; in-process Host consumers keep their own lifecycle.
void startHost(directory, token, () => process.exit(0))
  .then(({ manager, stop }) => {
    let stopping = false
    const shutdown = () => {
      if (stopping) return
      stopping = true
      void manager
        .shutdown()
        .then(stop)
        .catch((error) => {
          stopping = false
          console.error('Terminal Host 清理失败：', error)
        })
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  })
  .catch((error) => {
    console.error('Terminal Host 启动失败：', error)
    process.exitCode = 1
  })
