import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '../lib/terminal-stable-cell-fit-addon'
import { unwrap, type TerminalEvent } from '../../../shared/contracts'
import { useWorkspace, type TerminalTab } from '../store'
import { createTerminalRenderer } from '../lib/terminal-renderer'
import { installTerminalInput } from '../lib/terminal-input'
import { installTerminalScroll } from '../lib/terminal-scroll'
import { installTerminalWheel } from '../lib/terminal-wheel'

export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const readingOffset = useRef<number | undefined>(undefined)
  const instance = useRef<{
    terminal: Terminal
    fit: Pick<StableCellFitAddon, 'fit'>
    renderer: ReturnType<typeof createTerminalRenderer>
  } | null>(null)
  const gpuAcceleration = useWorkspace((state) => state.preferences.terminalGpuAcceleration)
  const scrollback = useWorkspace((state) => state.preferences.scrollback)
  const focusVersion = useWorkspace((state) => state.focusVersion)
  const id = tab.id
  const projectPath = tab.projectPath
  const workspaceId = tab.workspaceId
  const kind = tab.kind
  const provider = tab.provider
  const launchId = tab.launchId
  const status = tab.closingStatus ?? tab.status

  useEffect(() => {
    const container = host.current
    const tokens = getComputedStyle(document.documentElement)
    const background = tokens.getPropertyValue('--surface-canvas').trim()
    const foreground = tokens.getPropertyValue('--foreground').trim()
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      lineHeight: 1.25,
      scrollback: useWorkspace.getState().preferences.scrollback,
      scrollbar: { width: 6 },
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
      vtExtensions: { kittyKeyboard: true },
      allowTransparency: false,
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current!)
    const scrolling = installTerminalScroll(terminal)
    const wheel = installTerminalWheel(terminal)
    const viewportFit = { fit: () => scrolling.preserve(() => fit.fit()) }
    const renderer = createTerminalRenderer(terminal, viewportFit)
    instance.current = { terminal, fit: viewportFit, renderer }
    let disposed = false
    let connected = false
    let closing = false
    let restoreFocus = false
    const attachmentId = crypto.randomUUID()
    const pending: TerminalEvent[] = []
    terminal.options.disableStdin = true
    const live = () =>
      connected &&
      !disposed &&
      !closing &&
      useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'running'
    const fitAndResize = () => {
      if (!host.current?.clientWidth || !host.current.clientHeight) return
      viewportFit.fit()
    }
    const resize = terminal.onResize(({ cols, rows }) => {
      if (live())
        void window.desktop.resizeTerminal(id, cols, rows).then(unwrap).catch(console.error)
    })
    const input = installTerminalInput(terminal, {
      platform: window.desktop.platform,
      canSend: live,
      write: (value, encoding) => {
        void window.desktop.writeTerminal(id, value, encoding).then(unwrap).catch(console.error)
      },
    })
    const apply = (event: TerminalEvent) => {
      if (event.type === 'closing') {
        closing = event.closing
        const element = host.current
        if (closing) restoreFocus = !!element?.contains(document.activeElement)
        if (element) element.inert = closing
        terminal.options.disableStdin =
          closing ||
          useWorkspace.getState().tabs.find((item) => item.id === id)?.status !== 'running'
        if (closing) terminal.blur()
        else {
          for (const queued of pending.splice(0)) apply(queued)
          if (restoreFocus && element?.clientWidth && document.activeElement === document.body)
            terminal.focus()
        }
        return
      }
      // Keep shutdown output queued until failure; successful close disposes the view.
      if (closing) {
        pending.push(event)
        return
      }
      if (event.type === 'data') {
        terminal.write(event.data, () => {
          if (!disposed) window.desktop.acknowledge(id, attachmentId, event.data.length)
        })
      } else {
        terminal.options.disableStdin = true
        useWorkspace.getState().updateTab(
          id,
          event.type === 'exit'
            ? {
                status: 'exited',
                exitCode: event.exitCode,
              }
            : { status: 'error', error: event.error },
        )
      }
    }
    const unsubscribe = window.desktop.onTerminal((event) => {
      if (event.id !== id || event.attachmentId !== attachmentId || disposed) return
      if (connected) apply(event)
      else pending.push(event)
    })
    const observer = new ResizeObserver(fitAndResize)
    observer.observe(host.current!)
    fitAndResize()
    void (async () => {
      if (useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'starting')
        unwrap(
          await window.desktop.createTerminal({
            id,
            projectPath,
            workspaceId,
            ...(kind === 'agent'
              ? { kind, provider: provider!, launchId: launchId! }
              : { kind: 'shell' as const }),
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        )
      if (disposed) return
      const attached = unwrap(
        await window.desktop.attachTerminal({ id, projectPath, workspaceId, attachmentId }),
      )
      if (disposed) {
        void window.desktop.detachTerminal(id, attachmentId).catch(() => {})
        return
      }
      scrolling.preserve(() => terminal.resize(attached.cols, attached.rows))
      await new Promise<void>((resolve) => terminal.write(attached.snapshot, resolve))
      if (disposed) return
      scrolling.restore(readingOffset.current)
      connected = true
      terminal.options.disableStdin = attached.exited
      useWorkspace.getState().updateTab(id, {
        status: attached.exited ? 'exited' : 'running',
        exitCode: attached.exitCode,
        agent: attached.agent,
        agentRevision: attached.agentRevision,
        cwd: attached.cwd,
        error: undefined,
      })
      for (const event of pending.splice(0)) apply(event)
      fitAndResize()
      if (live()) await window.desktop.resizeTerminal(id, terminal.cols, terminal.rows).then(unwrap)
    })().catch((error: unknown) => {
      if (disposed) return
      terminal.options.disableStdin = true
      useWorkspace.getState().updateTab(id, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => {
      disposed = true
      readingOffset.current = scrolling.offset
      input.dispose()
      wheel.dispose()
      scrolling.dispose()
      if (container) container.inert = false
      observer.disconnect()
      unsubscribe()
      void window.desktop.detachTerminal(id, attachmentId).catch(() => {})
      resize.dispose()
      renderer.dispose()
      terminal.dispose()
      instance.current = null
    }
  }, [id, projectPath, workspaceId, kind, provider, launchId])

  useEffect(() => {
    instance.current?.renderer.update(gpuAcceleration, active)
  }, [gpuAcceleration, active, id, projectPath, workspaceId, kind, provider, launchId])

  useEffect(() => {
    if (instance.current) instance.current.terminal.options.scrollback = scrollback
  }, [scrollback])
  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      const current = instance.current
      if (!current || !host.current?.clientWidth) return
      current.fit.fit()
      // Keep focus on tab buttons for repeated arrow-key navigation.
      if (document.activeElement?.getAttribute('role') !== 'tab') current.terminal.focus()
      if (
        !current.terminal.options.disableStdin &&
        useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'running'
      ) {
        void window.desktop
          .resizeTerminal(id, current.terminal.cols, current.terminal.rows)
          .then(unwrap)
          .catch(console.error)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, id, focusVersion])

  return (
    <section
      id={`terminal-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${tab.id}`}
      aria-label={tab.title}
      tabIndex={0}
      hidden={!active}
      style={{ display: active ? 'flex' : 'none' }}
      className="terminal-view col-start-1 row-start-1 size-full min-h-0 min-w-0 flex-col"
    >
      {tab.error && !tab.closingStatus && (
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
      <div className="terminal-screen-container relative min-h-0 flex-1 overflow-hidden pt-1.5 pl-1.5">
        <div ref={host} className="terminal-screen size-full overflow-hidden" />
      </div>
    </section>
  )
}
