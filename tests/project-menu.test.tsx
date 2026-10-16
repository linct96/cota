// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { useWorkspace } from '../src/renderer/src/store'

vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))

let root: Root
let container: HTMLDivElement
let removeProject: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  removeProject = vi.fn().mockResolvedValue({ ok: true, value: false })
  Object.assign(window, { desktop: { onShortcut: () => () => {}, removeProject } })
  useWorkspace.setState(
    {
      ...useWorkspace.getInitialState(),
      ready: true,
      projects: ['/tmp/project'],
      selectedProject: '/tmp/project',
      bootstrap: async () => {},
    },
    true,
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  vi.unstubAllGlobals()
})

async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('.project-menu-trigger')!
  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await vi.waitFor(() => {
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
  })
  return trigger
}

describe('project menu', () => {
  it('opens in a portal with keyboard focus and returns focus on Escape', async () => {
    const trigger = await openMenu()
    const menu = document.querySelector('[role="menu"]')!
    expect(menu).not.toBeNull()
    expect(container.contains(menu)).toBe(false)
    expect(menu.getAttribute('data-align')).toBe('end')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses on an outside pointer press', async () => {
    const trigger = await openMenu()
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(removeProject).not.toHaveBeenCalled()
  })

  it.each([false, true])('preserves deletion behavior when confirmed=%s', async (confirmed) => {
    removeProject.mockResolvedValueOnce({ ok: true, value: confirmed })
    const trigger = await openMenu()
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(removeProject).toHaveBeenCalledExactlyOnceWith('/tmp/project')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(useWorkspace.getState().projects).toEqual(confirmed ? [] : ['/tmp/project'])
    if (!confirmed) expect(document.activeElement).toBe(trigger)
  })
})
