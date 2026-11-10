import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { AGENT_PROVIDERS, unwrap } from '../../../../../shared/contracts'
import type { AgentProvider } from '../../../../../shared/contracts'
import { AGENT_CLI_INSTALL_SCROLLBACK } from '../../../../../shared/agent-cli'
import type { AgentCliInstallEvent, AgentCliInstallRun } from '../../../../../shared/agent-cli'
import { useWorkspace } from '@/state/workspace'
import { StableCellFitAddon } from '@/features/terminal/lib/terminal-stable-cell-fit-addon'
import {
  installTerminalAppearance,
  terminalAppearanceOptions,
} from '@/features/terminal/lib/terminal-appearance'
import { installTerminalInput } from '@/features/terminal/lib/terminal-input'
import { installTerminalScroll } from '@/features/terminal/lib/terminal-scroll'
import { installTerminalWheel } from '@/features/terminal/lib/terminal-wheel'
import { observeDocumentTheme } from '@/lib/theme'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

function AgentCliInstallTerminal({
  provider,
  setRun,
  setError,
}: {
  provider: AgentProvider
  setRun: (run: AgentCliInstallRun) => void
  setError: (error: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = host.current!
    const terminal = new Terminal({
      ...terminalAppearanceOptions(useWorkspace.getState().preferences.terminalAppearance),
      scrollback: AGENT_CLI_INSTALL_SCROLLBACK,
      cursorInactiveStyle: 'none',
      disableStdin: true,
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    const scrolling = installTerminalScroll(terminal)
    const wheel = installTerminalWheel(terminal)
    let disposed = false
    let connected = false
    let current: AgentCliInstallRun | undefined
    let revision = 0
    const queued: AgentCliInstallEvent[] = []
    const attachmentId = crypto.randomUUID()
    const detach = () => {
      void window.desktop.detachAgentCliInstallTerminal(provider, attachmentId).catch(() => {})
    }
    const report = (cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
    }
    const live = () => connected && !disposed && current?.status === 'running'
    const write = (data: string, encoding?: 'utf8' | 'binary') => {
      if (live())
        void window.desktop
          .writeAgentCliInstallTerminal(current!.id, data, encoding)
          .then(unwrap)
          .catch(report)
    }
    const input = installTerminalInput(terminal, {
      platform: window.desktop.platform,
      canSend: live,
      getShortcuts: () => useWorkspace.getState().preferences.shortcuts,
      write,
      onShortcut: (action) => {
        if (action === 'copy' && terminal.hasSelection())
          void window.desktop.writeClipboard(terminal.getSelection()).then(unwrap).catch(report)
        else if (action === 'paste')
          void window.desktop
            .readClipboard()
            .then(unwrap)
            .then((text) => {
              if (live()) terminal.paste(text)
            })
            .catch(report)
        else if (action === 'select-all') terminal.selectAll()
        else if (action === 'clear') terminal.clear()
        else if (action === 'new-line') write('\x1b\r')
        else if (action === 'scroll-up') terminal.scrollPages(-1)
        else if (action === 'scroll-down') terminal.scrollPages(1)
        else if (action === 'scroll-top') terminal.scrollToTop()
        else if (action === 'scroll-bottom') terminal.scrollToBottom()
      },
    })
    const resize = terminal.onResize(({ cols, rows }) => {
      if (connected && current)
        void window.desktop
          .resizeAgentCliInstallTerminal(current.id, cols, rows)
          .then(unwrap)
          .catch(report)
    })
    const fitTerminal = () => {
      if (container.clientWidth && container.clientHeight) scrolling.preserve(() => fit.fit())
    }
    const appearance = installTerminalAppearance(terminal, container, fitTerminal)
    const updateAppearance = () => {
      appearance.update(useWorkspace.getState().preferences.terminalAppearance)
      fitTerminal()
    }
    const stopAppearance = useWorkspace.subscribe((state, previous) => {
      if (state.preferences.terminalAppearance !== previous.preferences.terminalAppearance)
        updateAppearance()
    })
    const stopTheme = observeDocumentTheme(updateAppearance)
    const observer = new ResizeObserver(fitTerminal)
    observer.observe(container)
    const apply = (event: AgentCliInstallEvent) => {
      if (event.run.id !== current?.id) return
      if (current.status !== event.run.status || current.error !== event.run.error)
        setRun(event.run)
      current = event.run
      terminal.options.disableStdin = current.status !== 'running'
      if (event.data !== undefined && event.revision > revision) {
        revision = event.revision
        const length = event.data.length
        terminal.write(event.data, () => {
          if (!disposed)
            void window.desktop
              .acknowledgeAgentCliInstallTerminal(provider, attachmentId, length)
              .then(unwrap)
              .catch(report)
        })
      }
    }
    const unsubscribe = window.desktop.onAgentCliInstall((event) => {
      if (
        disposed ||
        event.run.provider !== provider ||
        (event.data !== undefined && event.attachmentId !== attachmentId)
      )
        return
      if (connected) apply(event)
      else queued.push(event)
    })
    const onFocus = () => window.desktop.setTerminalInputFocused(true)
    const onBlur = () => window.desktop.setTerminalInputFocused(false)
    terminal.textarea!.addEventListener('focus', onFocus)
    terminal.textarea!.addEventListener('blur', onBlur)
    updateAppearance()
    void window.desktop
      .readAgentCliInstallTerminal(provider, attachmentId)
      .then(unwrap)
      .then((snapshot) => {
        if (disposed) {
          detach()
          return
        }
        if (!snapshot) throw new Error('暂无更新终端。')
        current = snapshot.run
        revision = snapshot.revision
        setRun(current)
        terminal.resize(snapshot.cols, snapshot.rows)
        terminal.write(snapshot.output, () => {
          if (disposed) return
          connected = true
          terminal.options.disableStdin = current!.status !== 'running'
          for (const event of queued.splice(0)) apply(event)
          fitTerminal()
        })
      })
      .catch(report)
    return () => {
      disposed = true
      if (container.contains(document.activeElement)) onBlur()
      terminal.textarea!.removeEventListener('focus', onFocus)
      terminal.textarea!.removeEventListener('blur', onBlur)
      unsubscribe()
      detach()
      observer.disconnect()
      stopAppearance()
      stopTheme()
      appearance.dispose()
      input.dispose()
      resize.dispose()
      wheel.dispose()
      scrolling.dispose()
      terminal.dispose()
    }
  }, [provider, setRun, setError])

  return (
    <div
      ref={host}
      className="agent-cli-install-terminal terminal-screen size-full overflow-hidden"
    />
  )
}

export function AgentCliInstallDialog({
  provider,
  open,
  onClose,
  onOpenChangeComplete,
}: {
  provider: AgentProvider
  open: boolean
  onClose: () => void
  onOpenChangeComplete: (open: boolean) => void
}) {
  const [run, setRun] = useState<AgentCliInstallRun>()
  const [error, setError] = useState<string>()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent
        className="agent-cli-install-dialog grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader className="agent-cli-install-header">
          <DialogTitle className="agent-cli-install-title">
            {AGENT_PROVIDERS[provider].name} 更新进度
          </DialogTitle>
          <DialogDescription className="agent-cli-install-description">
            关闭弹窗不会中断更新。
          </DialogDescription>
        </DialogHeader>
        <section
          className="agent-cli-install-terminal-region terminal-screen-container h-[55vh] min-h-0 overflow-hidden rounded-md border"
          aria-label={`${AGENT_PROVIDERS[provider].name} 更新终端`}
        >
          <AgentCliInstallTerminal provider={provider} setRun={setRun} setError={setError} />
        </section>
        <DialogFooter className="agent-cli-install-footer items-center sm:justify-between">
          <output className="agent-cli-install-status min-w-0 break-words" aria-live="polite">
            {error ||
              run?.error ||
              (run?.status === 'succeeded'
                ? '更新完成'
                : run?.status === 'failed'
                  ? '更新失败'
                  : run?.status === 'not-installed'
                    ? '未安装'
                    : '更新中…')}
          </output>
          <Button className="agent-cli-install-close" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
