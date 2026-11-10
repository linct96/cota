import { useEffect, useEffectEvent, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '@/features/terminal/lib/terminal-stable-cell-fit-addon'
import { installTerminalPreviewInput } from '@/features/terminal/lib/terminal-preview-input'
import {
  installTerminalAppearance,
  terminalAppearanceOptions,
} from '@/features/terminal/lib/terminal-appearance'
import { observeDocumentTheme } from '@/lib/theme'
import { terminalAppearanceSchema } from '../../../../../../shared/terminal-appearance'
import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'

const PREVIEW_PROMPT = '\x1b[34m~/cota\x1b[0m \x1b[35mmain\x1b[0m \x1b[32m❯\x1b[0m '
const PREVIEW_OUTPUT = [
  `${PREVIEW_PROMPT}pnpm test`,
  '\x1b[1;32m PASS \x1b[0m src/terminal.test.ts',
  ' \x1b[32m✓\x1b[0m 中文与 English 混排',
  ' \x1b[32m✓\x1b[0m theme updated  \x1b[2m12ms\x1b[0m',
  ' \x1b[33m⚠ preview mode · 示例输出\x1b[0m',
  '',
  `${PREVIEW_PROMPT}git diff`,
  '\x1b[36m@@ -1,2 +1,2 @@\x1b[0m',
  '\x1b[31m-const fontSize = 13;\x1b[0m',
  '\x1b[32m+const fontSize = 14;\x1b[0m',
  '',
  '\x1b[2;3m// 字体连字与字符辨识\x1b[0m',
  '\x1b[34mconst\x1b[0m ready = a !== b && count >= 1;',
  '=> -> === !== <= >=  0O 1Il {} []',
  '',
  '标准 \x1b[30m██ \x1b[31m██ \x1b[32m██ \x1b[33m██ \x1b[34m██ \x1b[35m██ \x1b[36m██ \x1b[37m██\x1b[0m',
  '高亮 \x1b[90m██ \x1b[91m██ \x1b[92m██ \x1b[93m██ \x1b[94m██ \x1b[95m██ \x1b[96m██ \x1b[97m██\x1b[0m',
  '',
].join('\r\n')

export function TerminalAppearancePreview({ settings }: { settings: TerminalAppearance }) {
  const host = useRef<HTMLDivElement>(null)
  const currentSettings = useEffectEvent(() => settings)
  const apply = useRef<(value: TerminalAppearance) => void>(() => {})
  useEffect(() => {
    const container = host.current!
    const terminal = new Terminal({
      ...terminalAppearanceOptions(currentSettings()),
      cursorInactiveStyle: 'none',
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      scrollback: 1000,
      scrollbar: { width: 6 },
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminal.textarea?.setAttribute('aria-label', '终端交互预览')
    terminal.textarea?.setAttribute('aria-describedby', 'terminal-appearance-preview-help')
    terminal.attachCustomKeyEventHandler((event) => event.key !== 'Tab')
    const appearance = installTerminalAppearance(terminal, container, () => fit.fit())
    const update = (value = currentSettings()) => {
      if (!terminalAppearanceSchema.safeParse(value).success) return
      appearance.update(value)
      fit.fit()
    }
    apply.current = update
    update()
    terminal.write(PREVIEW_OUTPUT)
    const input = installTerminalPreviewInput(terminal, PREVIEW_PROMPT)
    const showMouse = () => container.classList.remove('terminal-mouse-hidden')
    const hideMouse = (event: KeyboardEvent) => {
      if (
        currentSettings().mouseHideWhileTyping &&
        !event.metaKey &&
        !event.ctrlKey &&
        !['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)
      )
        container.classList.add('terminal-mouse-hidden')
    }
    container.addEventListener('keydown', hideMouse)
    container.addEventListener('pointermove', showMouse)
    container.addEventListener('pointerleave', showMouse)
    container.addEventListener('blur', showMouse, true)
    const observer = new ResizeObserver(() => update())
    observer.observe(container)
    const stopTheme = observeDocumentTheme(() => update())
    return () => {
      apply.current = () => {}
      observer.disconnect()
      stopTheme()
      container.removeEventListener('keydown', hideMouse)
      container.removeEventListener('pointermove', showMouse)
      container.removeEventListener('pointerleave', showMouse)
      container.removeEventListener('blur', showMouse, true)
      input.dispose()
      appearance.dispose()
      terminal.dispose()
    }
  }, [])
  useEffect(() => apply.current(settings), [settings])
  return (
    <section
      className="terminal-appearance-preview flex flex-col gap-1.5"
      aria-label="终端外观预览：包含示例测试输出、Git Diff、中英文、粗体、斜体、弱化文字、字体连字、易混淆字符、ANSI 十六色和光标示例"
    >
      <div className="terminal-appearance-preview-frame h-52 overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-ring/50">
        <div ref={host} className="terminal-appearance-preview-screen terminal-screen h-full" />
      </div>
      <p
        id="terminal-appearance-preview-help"
        className="terminal-appearance-preview-help text-xs text-muted-foreground"
      >
        点击输入或拖动选择，使用方向键、Home / End 移动光标；Enter 清空输入，Tab
        离开预览。仅供预览，不会执行命令。
      </p>
    </section>
  )
}
