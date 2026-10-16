import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { unwrap } from '../../../shared/contracts'
import { useWorkspace, type TerminalTab } from '../store'

export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null)
  const scrollback = useWorkspace((state) => state.preferences.scrollback)
  const settingsOpen = useWorkspace((state) => state.settingsOpen)
  const focusVersion = useWorkspace((state) => state.focusVersion)
  const id = tab.id
  const projectPath = tab.projectPath
  const status = tab.closingStatus ?? tab.status

  useEffect(() => {
    const tokens = getComputedStyle(document.documentElement)
    const background = tokens.getPropertyValue('--surface-canvas').trim()
    const foreground = tokens.getPropertyValue('--foreground').trim()
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      scrollback: useWorkspace.getState().preferences.scrollback,
      scrollSensitivity: 1.15,
      fastScrollSensitivity: 5,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      minimumContrastRatio: 4.5,
      theme: {
        background,
        foreground,
        cursor: foreground,
        cursorAccent: background,
        overviewRulerBorder: 'transparent',
        selectionBackground: tokens.getPropertyValue('--terminal-selection').trim(),
        selectionInactiveBackground: tokens
          .getPropertyValue('--terminal-selection-inactive')
          .trim(),
        scrollbarSliderBackground: tokens.getPropertyValue('--scrollbar-thumb').trim(),
        scrollbarSliderHoverBackground: tokens.getPropertyValue('--scrollbar-thumb-hover').trim(),
        scrollbarSliderActiveBackground: tokens.getPropertyValue('--scrollbar-thumb-active').trim(),
        black: foreground,
        red: tokens.getPropertyValue('--destructive').trim(),
        green: '#15803d',
        yellow: '#b45309',
        blue: '#1d4ed8',
        magenta: '#86198f',
        cyan: '#0e7490',
        white: '#e4e4e7',
        brightBlack: tokens.getPropertyValue('--muted-foreground').trim(),
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#fafafa',
      },
      allowProposedApi: false,
      allowTransparency: false,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current!)
    instance.current = { terminal, fit }
    let disposed = false
    const report = (error: unknown) => {
      if (!disposed) useWorkspace.getState().report(error)
    }
    const live = () =>
      useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'running'
    const fitAndResize = () => {
      if (!host.current?.clientWidth || !host.current.clientHeight) return
      fit.fit()
    }
    const resize = terminal.onResize(({ cols, rows }) => {
      if (live()) void window.desktop.resizeTerminal(id, cols, rows).then(unwrap).catch(report)
    })
    const data = terminal.onData((value) => {
      if (live()) void window.desktop.writeTerminal(id, value).then(unwrap).catch(report)
    })
    terminal.attachCustomKeyEventHandler(
      (event) => !(event.metaKey && ['c', 'v'].includes(event.key.toLowerCase())),
    )
    const unsubscribe = window.desktop.onTerminal((event) => {
      if (event.id !== id || disposed) return
      if (event.type === 'data') {
        terminal.write(event.data, () => {
          window.desktop.acknowledge(id, event.data.length)
        })
      } else {
        terminal.options.disableStdin = true
        useWorkspace.getState().updateTab(id, { status: 'exited', exitCode: event.exitCode })
      }
    })
    const observer = new ResizeObserver(fitAndResize)
    observer.observe(host.current!)
    fitAndResize()
    void window.desktop
      .createTerminal({ id, projectPath, cols: terminal.cols, rows: terminal.rows })
      .then(unwrap)
      .then(() => {
        if (disposed) return
        if (useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'starting') {
          useWorkspace.getState().updateTab(id, { status: 'running' })
        }
        fitAndResize()
        // Always send the latest size, even if fitting did not change xterm's dimensions.
        if (live())
          void window.desktop
            .resizeTerminal(id, terminal.cols, terminal.rows)
            .then(unwrap)
            .catch(report)
      })
      .catch((error: unknown) => {
        if (disposed) return
        terminal.options.disableStdin = true
        useWorkspace.getState().updateTab(id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe()
      data.dispose()
      resize.dispose()
      terminal.dispose()
      instance.current = null
    }
  }, [id, projectPath])

  useEffect(() => {
    if (instance.current) instance.current.terminal.options.scrollback = scrollback
  }, [scrollback])
  useEffect(() => {
    if (!active || settingsOpen) return
    const frame = requestAnimationFrame(() => {
      const current = instance.current
      if (!current || !host.current?.clientWidth) return
      current.fit.fit()
      // Keep focus on tab buttons for repeated arrow-key navigation.
      if (document.activeElement?.getAttribute('role') !== 'tab') current.terminal.focus()
      if (useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'running') {
        void window.desktop
          .resizeTerminal(id, current.terminal.cols, current.terminal.rows)
          .then(unwrap)
          .catch((error) => useWorkspace.getState().report(error))
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, settingsOpen, id, focusVersion])

  return (
    <section
      id={`terminal-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${tab.id}`}
      aria-label={tab.title}
      tabIndex={0}
      hidden={!active}
      style={{ display: active ? 'flex' : 'none' }}
      className="terminal-view col-start-1 row-start-1 size-full min-h-0 min-w-0 flex-col p-3"
    >
      {status === 'error' && (
        <p
          role="alert"
          className="terminal-error-banner mb-2 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {tab.error}
        </p>
      )}
      {status === 'exited' && (
        <output className="terminal-exited-status shrink-0 pb-2 text-muted-foreground">
          Exited · 退出码 {tab.exitCode ?? '未知'} · 请新建终端继续。
        </output>
      )}
      <div className="terminal-screen-container relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className="terminal-screen size-full overflow-hidden" />
        {status === 'starting' && (
          <output className="terminal-starting-status pointer-events-none absolute inset-0 text-muted-foreground">
            正在创建 Shell…
          </output>
        )}
      </div>
    </section>
  )
}
