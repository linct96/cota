import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '../lib/terminal-stable-cell-fit-addon'
import { unwrap, type TerminalEvent } from '../../../shared/contracts'
import { useWorkspace, type TerminalTab } from '../store'
import { createTerminalRenderer } from '../lib/terminal-renderer'
import { installTerminalInput } from '../lib/terminal-input'
import { installTerminalScroll } from '../lib/terminal-scroll'
import { installTerminalWheel } from '../lib/terminal-wheel'
import { shortenPath } from '../lib/utils'
import { installTerminalAppearance, terminalAppearanceOptions } from '../lib/terminal-appearance'
import { observeDocumentTheme } from '../lib/theme'

export function TerminalView({
  tab,
  active,
  focused = active,
}: {
  tab: TerminalTab
  active: boolean
  focused?: boolean
}) {
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
  const focusPane = () => {
    const state = useWorkspace.getState()
    if (active && !state.removingWorkspace && state.activeTabs[workspaceId] !== id)
      state.selectTab(id)
  }

  useEffect(() => {
    const container = host.current
    const terminal = new Terminal({
      cursorInactiveStyle: 'none',
      scrollback: useWorkspace.getState().preferences.scrollback,
      scrollbar: { width: 6 },
      scrollSensitivity: 1.15,
      fastScrollSensitivity: 5,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      allowProposedApi: false,
      vtExtensions: { kittyKeyboard: true },
      ...terminalAppearanceOptions(useWorkspace.getState().preferences.terminalAppearance),
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current!)
    const scrolling = installTerminalScroll(terminal)
    const wheel = installTerminalWheel(terminal)
    const viewportFit = { fit: () => scrolling.preserve(() => fit.fit()) }
    const renderer = createTerminalRenderer(terminal, viewportFit)
    const appearance = installTerminalAppearance(terminal, container!, () => {
      const settings = useWorkspace.getState().preferences
      renderer.update('off', false)
      renderer.update(settings.terminalGpuAcceleration, !!container?.clientWidth)
      fitAndResize()
    })
    const updateAppearance = () => {
      appearance.update(useWorkspace.getState().preferences.terminalAppearance)
      fitAndResize()
    }
    const stopAppearance = useWorkspace.subscribe((state, previous) => {
      if (state.preferences.terminalAppearance !== previous.preferences.terminalAppearance)
        updateAppearance()
    })
    const stopTheme = observeDocumentTheme(updateAppearance)
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
    const textarea = terminal.textarea!
    const onInputFocus = () => window.desktop.setTerminalInputFocused(true)
    const onInputBlur = () => window.desktop.setTerminalInputFocused(false)
    textarea.addEventListener('focus', onInputFocus)
    textarea.addEventListener('blur', onInputBlur)
    const input = installTerminalInput(terminal, {
      platform: window.desktop.platform,
      canSend: live,
      getShortcuts: () => useWorkspace.getState().preferences.shortcuts,
      onShortcut: (action) => {
        if (action === 'copy') {
          if (terminal.hasSelection())
            void window.desktop
              .writeClipboard(terminal.getSelection())
              .then(unwrap)
              .catch(console.error)
        } else if (action === 'paste') {
          void window.desktop
            .readClipboard()
            .then(unwrap)
            .then((text) => {
              if (live()) terminal.paste(text)
            })
            .catch(console.error)
        } else if (action === 'select-all') terminal.selectAll()
        else if (action === 'clear') terminal.clear()
        else if (action === 'new-line' && live())
          void window.desktop.writeTerminal(id, '\x1b\r').then(unwrap).catch(console.error)
        else if (action === 'scroll-up') terminal.scrollPages(-1)
        else if (action === 'scroll-down') terminal.scrollPages(1)
        else if (action === 'scroll-top') terminal.scrollToTop()
        else if (action === 'scroll-bottom') terminal.scrollToBottom()
      },
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
      } else if (event.type === 'activity') {
        useWorkspace.getState().updateTab(id, { shellActivity: event.activity })
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
    const showMouse = () => container?.classList.remove('terminal-mouse-hidden')
    const hideMouse = (event: KeyboardEvent) => {
      if (
        useWorkspace.getState().preferences.terminalAppearance.mouseHideWhileTyping &&
        !event.metaKey &&
        !event.ctrlKey &&
        !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
      )
        container?.classList.add('terminal-mouse-hidden')
    }
    container?.addEventListener('keydown', hideMouse)
    container?.addEventListener('pointermove', showMouse)
    container?.addEventListener('pointerleave', showMouse)
    container?.addEventListener('blur', showMouse, true)
    observer.observe(host.current!)
    updateAppearance()
    void (async () => {
      if (useWorkspace.getState().tabs.find((item) => item.id === id)?.status === 'starting')
        unwrap(
          await window.desktop.createTerminal({
            id,
            projectPath,
            workspaceId,
            service: useWorkspace.getState().tabs.find((item) => item.id === id)?.service,
            startupCommand: useWorkspace.getState().tabs.find((item) => item.id === id)
              ?.startupCommand,
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
        startupCommand: undefined,
        service: attached.service,
        shellActivity: attached.shellActivity,
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
      if (document.activeElement === textarea) onInputBlur()
      textarea.removeEventListener('focus', onInputFocus)
      textarea.removeEventListener('blur', onInputBlur)
      input.dispose()
      wheel.dispose()
      scrolling.dispose()
      if (container) container.inert = false
      observer.disconnect()
      container?.removeEventListener('keydown', hideMouse)
      container?.removeEventListener('pointermove', showMouse)
      container?.removeEventListener('pointerleave', showMouse)
      container?.removeEventListener('blur', showMouse, true)
      stopAppearance()
      stopTheme()
      appearance.dispose()
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
    if (!focused) return
    const frame = requestAnimationFrame(() => {
      const current = instance.current
      if (!current || !host.current?.clientWidth) return
      current.fit.fit()
      // Preserve keyboard tab navigation without blocking pointer selection.
      if (!document.activeElement?.matches('[role="tab"]:focus-visible')) current.terminal.focus()
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
  }, [focused, id, focusVersion])

  return (
    <section
      aria-label={shortenPath(tab.cwd || tab.projectPath)}
      onPointerDownCapture={focusPane}
      onFocusCapture={focusPane}
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
        <output className="terminal-exited-status shrink-0 pb-2 text-app-muted-foreground">
          Exited · 退出码 {tab.exitCode ?? '未知'} · 请新建终端继续。
        </output>
      )}
      <div className="terminal-screen-container relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className="terminal-screen size-full overflow-hidden" />
      </div>
    </section>
  )
}
