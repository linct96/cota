import type { Terminal } from '@xterm/xterm'
import { expect, it, vi } from 'vitest'
import { StableCellFitAddon } from '../src/renderer/src/lib/terminal-stable-cell-fit-addon'

it('fits from stable device cells regardless of the previous grid, respecting padding and scrollbars', () => {
  const charWidth = 8.4287109375
  const parent = { style: { width: '444px', height: '796px' } }
  const view = {
    devicePixelRatio: 2,
    getComputedStyle: (element: { style: object }) => element.style,
  }
  let measured = true
  const terminal = {
    cols: 52,
    rows: 49,
    element: {
      parentElement: parent,
      ownerDocument: { defaultView: view },
      style: { paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px' },
    },
    options: { scrollback: 5000, scrollbar: { width: 6, showScrollbar: true } },
    get dimensions() {
      return measured
        ? {
            device: {
              cell: {
                width: charWidth * view.devicePixelRatio,
                height: 16 * view.devicePixelRatio,
              },
            },
            css: { cell: { width: Math.round(charWidth * this.cols) / this.cols, height: 16 } },
          }
        : undefined
    },
    resize: vi.fn(),
  }
  const addon = new StableCellFitAddon()
  expect(addon.proposeDimensions()).toBeUndefined()
  addon.activate(terminal as unknown as Terminal)

  for (const dpr of [1, 2]) {
    view.devicePixelRatio = dpr
    for (const cols of [52, 75, 51, 80, 120]) {
      terminal.cols = cols
      expect(addon.proposeDimensions()).toEqual({ cols: 51, rows: 49 })
    }
  }
  addon.fit()
  expect(terminal.resize).toHaveBeenCalledWith(51, 49)

  terminal.options.scrollbar.showScrollbar = false
  expect(addon.proposeDimensions()?.cols).toBe(52)
  terminal.options.scrollbar.showScrollbar = true
  terminal.options.scrollback = 0
  expect(addon.proposeDimensions()?.cols).toBe(52)

  terminal.options.scrollback = 5000
  terminal.element.style.paddingLeft = '4px'
  terminal.element.style.paddingRight = '4px'
  terminal.element.style.paddingTop = '8px'
  terminal.element.style.paddingBottom = '8px'
  expect(addon.proposeDimensions()).toEqual({ cols: 51, rows: 48 })

  measured = false
  expect(addon.proposeDimensions()).toBeUndefined()
})
