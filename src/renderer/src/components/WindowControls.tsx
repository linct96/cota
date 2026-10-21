import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { unwrap } from '../../../shared/contracts'
import { Button } from './ui/button'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    let receivedChange = false
    const unsubscribe = window.desktop.onWindowMaximized((value) => {
      receivedChange = true
      setMaximized(value)
    })
    void window.desktop
      .isWindowMaximized()
      .then(unwrap)
      .then((value) => {
        // A native state change takes precedence over the initial asynchronous snapshot.
        if (active && !receivedChange) setMaximized(value)
      })
      .catch((error: unknown) => {
        if (active) console.error('无法读取窗口状态', error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <fieldset className="window-controls min-w-0 border-0 p-0" aria-label="窗口控制">
      <Button
        className="window-minimize-button"
        variant="window-control"
        size="window-control"
        aria-label="最小化"
        title="最小化"
        onClick={() => window.desktop.minimizeWindow()}
      >
        <Minus className="window-minimize-icon" aria-hidden="true" />
      </Button>
      <Button
        className="window-maximize-button"
        variant="window-control"
        size="window-control"
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
        onClick={() => window.desktop.toggleMaximizeWindow()}
      >
        {maximized ? (
          <Copy className="window-restore-icon" aria-hidden="true" />
        ) : (
          <Square className="window-maximize-icon" aria-hidden="true" />
        )}
      </Button>
      <Button
        className="window-close-button"
        variant="window-control"
        size="window-control"
        data-window-action="close"
        aria-label="关闭窗口"
        title="关闭窗口"
        onClick={() => window.desktop.closeWindow()}
      >
        <X className="window-close-icon" aria-hidden="true" />
      </Button>
    </fieldset>
  )
}
