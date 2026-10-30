import { FitAddon, type ITerminalDimensions } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

export class StableCellFitAddon extends FitAddon {
  private terminal: Terminal | undefined

  override activate(terminal: Terminal): void {
    this.terminal = terminal
    super.activate(terminal)
  }

  override proposeDimensions(): ITerminalDimensions | undefined {
    const terminal = this.terminal
    const element = terminal?.element
    const parent = element?.parentElement
    const dimensions = terminal?.dimensions
    if (!terminal || !element || !parent || !dimensions) return undefined

    const view = element.ownerDocument.defaultView
    if (!view) return super.proposeDimensions()

    // CSS 单元格尺寸受当前行列数的画布取整影响，设备像素尺寸不依赖当前网格。
    const dpr = view.devicePixelRatio || 1
    const cellWidth = dimensions.device.cell.width / dpr || dimensions.css.cell.width
    const cellHeight = dimensions.device.cell.height / dpr || dimensions.css.cell.height
    if (cellWidth <= 0 || cellHeight <= 0) return undefined

    const parentStyle = view.getComputedStyle(parent)
    const style = view.getComputedStyle(element)
    const width = Math.max(0, Number.parseInt(parentStyle.width, 10) || 0)
    const height = Math.max(0, Number.parseInt(parentStyle.height, 10) || 0)
    const paddingX =
      (Number.parseInt(style.paddingLeft, 10) || 0) +
      (Number.parseInt(style.paddingRight, 10) || 0) +
      (Number.parseInt(parentStyle.paddingLeft, 10) || 0) +
      (Number.parseInt(parentStyle.paddingRight, 10) || 0)
    const paddingY =
      (Number.parseInt(style.paddingTop, 10) || 0) +
      (Number.parseInt(style.paddingBottom, 10) || 0) +
      (Number.parseInt(parentStyle.paddingTop, 10) || 0) +
      (Number.parseInt(parentStyle.paddingBottom, 10) || 0)
    const scrollbarWidth =
      terminal.options.scrollback === 0 || terminal.options.scrollbar?.showScrollbar === false
        ? 0
        : (terminal.options.scrollbar?.width ?? 14)

    return {
      cols: Math.max(2, Math.floor((width - paddingX - scrollbarWidth) / cellWidth)),
      rows: Math.max(1, Math.floor((height - paddingY) / cellHeight)),
    }
  }
}
