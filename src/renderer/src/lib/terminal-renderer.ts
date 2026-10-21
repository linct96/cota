import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { TerminalGpuAcceleration } from '../../../shared/contracts'

// A failed GPU must not be retried by every tab during this renderer session.
let autoFailed = false

export function createTerminalRenderer(
  terminal: Pick<Terminal, 'loadAddon' | 'refresh' | 'rows'>,
  fit: Pick<FitAddon, 'fit'>,
) {
  let addon: WebglAddon | undefined
  let contextLoss: { dispose(): void } | undefined
  let mode: TerminalGpuAcceleration = 'auto'
  let visible = false
  let failed = false
  let disposed = false

  function release() {
    contextLoss?.dispose()
    contextLoss = undefined
    const current = addon
    addon = undefined
    current?.dispose()
  }

  function redraw() {
    if (!visible || disposed) return
    fit.fit()
    terminal.refresh(0, terminal.rows - 1)
  }

  function fallback(cause: unknown) {
    failed = true
    autoFailed = true
    release()
    console.warn('终端 WebGL 不可用，已回退到 DOM 渲染。', cause)
    redraw()
  }

  return {
    update(nextMode: TerminalGpuAcceleration, nextVisible: boolean) {
      if (disposed) return
      if (mode !== nextMode) failed = false
      mode = nextMode
      visible = nextVisible
      if (!visible || mode === 'off' || failed || (mode === 'auto' && autoFailed)) {
        if (addon) {
          release()
          redraw()
        }
        return
      }
      if (addon) return
      try {
        addon = new WebglAddon()
        contextLoss = addon.onContextLoss(() => fallback('WebGL context lost'))
        terminal.loadAddon(addon)
      } catch (cause) {
        fallback(cause)
        return
      }
      redraw()
    },
    dispose() {
      disposed = true
      release()
    },
  }
}
