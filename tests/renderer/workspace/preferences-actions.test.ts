import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../src/shared/contracts'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import { useWorkspace } from '../../../src/renderer/src/state/workspace'
import { WebglAddon } from '@xterm/addon-webgl'
import { createTerminalRenderer } from '../../../src/renderer/src/features/terminal/lib/terminal-renderer'

describe('Workspace preferences', () => {
  it('updates preferences with the saved result only after success', async () => {
    const terminal = { loadAddon: vi.fn(), refresh: vi.fn(), rows: 24 }
    const fit = { fit: vi.fn() }
    const renderer = createTerminalRenderer(terminal, fit)
    renderer.update(useWorkspace.getState().preferences.terminalGpuAcceleration, false)
    expect(terminal.loadAddon).not.toHaveBeenCalled()
    const value = {
      ...DEFAULT_CONFIG.preferences,
      shellPath: '/bin/bash',
      scrollback: 1000,
      terminalGpuAcceleration: 'on' as const,
    }
    const saved = { ...value, scrollback: 2000 }
    let finish!: (result: Result<typeof value>) => void
    vi.mocked(api.savePreferences).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const saving = useWorkspace.getState().savePreferences(value)
    expect(api.savePreferences).toHaveBeenCalledExactlyOnceWith(value)
    expect(useWorkspace.getState().preferences).toEqual(DEFAULT_CONFIG.preferences)
    finish({ ok: true, value: saved })
    await saving
    expect(useWorkspace.getState().preferences).toEqual(saved)
    renderer.update(useWorkspace.getState().preferences.terminalGpuAcceleration, true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    const first = vi.mocked(WebglAddon).mock.instances.at(-1)!
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    renderer.update('on', false)
    expect(vi.mocked(first).dispose.mock.calls).toHaveLength(1)
    expect(vi.mocked(first.onContextLoss).mock.results[0].value.dispose).toHaveBeenCalledOnce()

    renderer.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    const automatic = vi.mocked(WebglAddon).mock.instances.at(-1)!
    vi.mocked(automatic.onContextLoss).mock.calls[0][0]()
    expect(vi.mocked(automatic).dispose.mock.calls).toHaveLength(1)
    expect(terminal.refresh).toHaveBeenLastCalledWith(0, 23)
    renderer.update('auto', false)
    renderer.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    const other = createTerminalRenderer(terminal, fit)
    other.update('auto', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    other.dispose()

    terminal.loadAddon.mockImplementationOnce(() => {
      throw new Error('WebGL2 not supported')
    })
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    expect(vi.mocked(vi.mocked(WebglAddon).mock.instances.at(-1)!).dispose.mock.calls).toHaveLength(
      1,
    )
    renderer.update('on', false)
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    renderer.update('off', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(3)
    renderer.update('on', true)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(4)
    const last = vi.mocked(WebglAddon).mock.instances.at(-1)!
    renderer.dispose()
    renderer.update('on', true)
    expect(vi.mocked(last).dispose.mock.calls).toHaveLength(1)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(4)
  })

  it('preserves preferences after a failed save, allowing retry', async () => {
    const value = {
      ...DEFAULT_CONFIG.preferences,
      shellPath: '/bin/bash',
      scrollback: 1000,
      terminalGpuAcceleration: 'off' as const,
      preferredOpenerId: 'zed',
    }
    const before = useWorkspace.getState().preferences
    vi.mocked(api.savePreferences).mockResolvedValueOnce({ ok: false, error: '保存失败' })
    await expect(useWorkspace.getState().savePreferences(value)).rejects.toThrow('保存失败')
    expect(useWorkspace.getState().preferences).toEqual(before)
    await useWorkspace.getState().savePreferences(value)
    expect(useWorkspace.getState().preferences).toEqual(value)
  })
})
