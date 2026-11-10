import type { Terminal } from '@xterm/headless'
import type { IPty } from 'node-pty'

export function prepareFishStartupInput({
  screen,
  child,
  command,
  token,
  isLive,
  onError,
}: {
  screen: Terminal
  child: Pick<IPty, 'pid' | 'write'>
  command: string
  token: string
  isLive: () => boolean
  onError: (message: string) => void
}) {
  let ready = false
  let finished = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const marker = screen.parser.registerOscHandler(133, (data) => {
    if (data !== `A;Cota=${token};Shell=${child.pid}`) return false
    ready = true
    return true
  })
  const deadline = setTimeout(() => {
    dispose()
    if (isLive()) onError('Fish 未在 15 秒内进入输入状态，快捷命令未执行。')
  }, 15_000)

  function dispose() {
    finished = true
    clearTimeout(deadline)
    clearTimeout(settleTimer)
    marker.dispose()
  }

  return {
    notifyOutput() {
      if (finished || !ready || !screen.modes.bracketedPasteMode || settleTimer) return
      // Fish's prompt event precedes terminal queries; let their replies drain before submitting.
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        if (!isLive()) {
          dispose()
          return
        }
        if (!screen.modes.bracketedPasteMode) return
        dispose()
        try {
          child.write(`\x1b[200~${command.replace(/\n$/, '')}\x1b[201~\r`)
        } catch (error) {
          onError(`快捷命令提交失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }, 30)
    },
    dispose,
  }
}
