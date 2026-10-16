// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { useWorkspace } from '../src/renderer/src/store'
import type { Preferences, Result } from '../src/shared/contracts'

vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))

let root: Root
let container: HTMLDivElement
let trigger: HTMLButtonElement
let savePreferences: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  savePreferences = vi.fn(async (preferences: Preferences) => ({ ok: true, value: preferences }))
  Object.assign(window, { desktop: { onShortcut: () => () => {}, savePreferences } })
  useWorkspace.setState(
    { ...useWorkspace.getInitialState(), ready: true, bootstrap: async () => {} },
    true,
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
  trigger = container.querySelector<HTMLButtonElement>('.nav-settings-button')!
  await act(async () => {
    trigger.focus()
    trigger.click()
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  vi.unstubAllGlobals()
})

async function escape() {
  await act(async () => {
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

async function submit() {
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('settings dialog', () => {
  it('renders in a portal and restores focus to settings on Escape', async () => {
    const dialog = document.querySelector('[role="dialog"]')!
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      document.querySelector('.settings-title')!.id,
    )
    expect(document.querySelector('.dialog-close-button button')).toBeNull()
    await escape()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('dismisses on an outside press when not saving', async () => {
    await act(async () => {
      const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
      overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useWorkspace.getState().settingsOpen).toBe(false)
  })

  it('blocks Escape, outside press and close while saving, then allows retry after failure', async () => {
    let finish!: (result: Result<Preferences>) => void
    savePreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await submit()
    expect(savePreferences).toHaveBeenCalledExactlyOnceWith({ shellPath: null, scrollback: 5000 })
    expect(document.querySelector<HTMLButtonElement>('.settings-submit-button')!.disabled).toBe(
      true,
    )
    await escape()
    await act(async () => {
      const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
      overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      document.querySelector<HTMLButtonElement>('.dialog-close-button')!.click()
    })
    expect(useWorkspace.getState().settingsOpen).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => finish({ ok: false, error: '保存失败' }))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('保存失败')
    expect(document.querySelector<HTMLButtonElement>('.settings-submit-button')!.disabled).toBe(
      false,
    )
    await submit()
    expect(savePreferences).toHaveBeenCalledTimes(2)
    expect(useWorkspace.getState().settingsOpen).toBe(false)
  })
})
