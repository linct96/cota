import { event, mocks } from './ipc.fixture'
import { describe, expect, it, vi } from 'vitest'

describe('Agent Hooks IPC installation, trust and removal', () => {
  it('detects one Agent and allows another install during an uninstall confirmation', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    expect(await mocks.handlers.get('agent:hooks-detect')!(event, 'pi')).toMatchObject({
      ok: true,
      value: [{ provider: 'pi' }],
    })
    expect(await mocks.handlers.get('agent:hooks-detect')!(event, '__proto__')).toMatchObject({
      ok: false,
    })
    mocks.contents.send.mockClear()
    const uninstall = mocks.handlers.get('agent:hooks-uninstall')!(event, 'codex')
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith('app:confirm', expect.anything()),
    )
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: true,
      value: { provider: 'pi', state: 'installed' },
    })
    const request = mocks.contents.send.mock.calls.find(
      ([channel]) => channel === 'app:confirm',
    )![1]
    await mocks.handlers.get('app:confirm-response')!(event, request.id, false)
    expect(await uninstall).toMatchObject({ ok: true, value: null })
  })

  it('detects Hooks without installing them', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('agent:hooks-detect')!(event)).toMatchObject({ ok: true })
    expect(mocks.installHook).not.toHaveBeenCalled()
  })

  it.each(['untrusted', 'invalid provider'] as const)(
    'rejects an install from %s',
    async (reason) => {
      await mocks.handlers.get('app:bootstrap')!(event)
      const sender = reason === 'untrusted' ? { ...event, senderFrame: {} } : event
      const provider = reason === 'invalid provider' ? '__proto__' : 'codex'
      expect(await mocks.handlers.get('agent:hooks-install')!(sender, provider)).toMatchObject({
        ok: false,
      })
      expect(mocks.installHook).not.toHaveBeenCalled()
    },
  )

  it('installs Codex Hooks without confirmation or implicit trust', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.contents.send.mockClear()
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'codex')).toMatchObject({
      ok: true,
      value: { provider: 'codex', state: 'installed' },
    })
    expect(mocks.contents.send.mock.calls.some(([channel]) => channel === 'app:confirm')).toBe(
      false,
    )
    expect(mocks.installHook).toHaveBeenCalledExactlyOnceWith(
      'codex',
      { HOME: '/tmp/cota-hook-fixture' },
      '0.159.0',
    )
    expect(mocks.trustHook).not.toHaveBeenCalled()
  })

  it.each([
    ['untrusted', 'codex', '拒绝未授权的窗口请求。'],
    ['unsupported provider', 'claude', '仅 Codex'],
    ['uninstalled Hooks', 'codex', '请先安装或更新'],
  ] as const)('rejects trust for %s', async (reason, provider, error) => {
    await mocks.handlers.get('app:bootstrap')!(event)
    const sender = reason === 'untrusted' ? { ...event, senderFrame: {} } : event
    expect(await mocks.handlers.get('agent:hooks-trust')!(sender, provider)).toMatchObject({
      ok: false,
      error: reason === 'untrusted' ? error : expect.stringContaining(error),
    })
    expect(mocks.trustHook).not.toHaveBeenCalled()
  })

  it('trusts installed Codex Hooks without prompting or reinstalling', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.inspectHook.mockResolvedValueOnce({
      provider: 'codex',
      state: 'installed',
      paths: ['/tmp/cota-hook-fixture/.codex/hooks.json'],
      detail: 'installed',
    })
    mocks.contents.send.mockClear()
    expect(await mocks.handlers.get('agent:hooks-trust')!(event, 'codex')).toMatchObject({
      ok: true,
      value: { provider: 'codex', state: 'installed' },
    })
    expect(mocks.contents.send.mock.calls.some(([channel]) => channel === 'app:confirm')).toBe(
      false,
    )
    expect(mocks.trustHook).toHaveBeenCalledExactlyOnceWith(
      'codex',
      { HOME: '/tmp/cota-hook-fixture' },
      '0.159.0',
      '/tmp/codex-fixture',
    )
    expect(mocks.installHook).not.toHaveBeenCalled()
  })

  it('rejects trust when Codex cannot be found without installing Hooks', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.detectAgents.mockResolvedValueOnce([{ provider: 'codex', error: 'missing' }])
    expect(await mocks.handlers.get('agent:hooks-trust')!(event, 'codex')).toMatchObject({
      ok: false,
      error: expect.stringContaining('找不到 Codex'),
    })
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(mocks.trustHook).not.toHaveBeenCalled()
  })

  it('keeps Hooks available through same-document and subframe navigation', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.detectAgents.mockClear()
    mocks.contents.send.mockClear()
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: true })
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: false, isSameDocument: false })
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: true,
      value: { provider: 'pi', state: 'installed' },
    })
    expect(mocks.detectAgents).not.toHaveBeenCalled()
    expect(mocks.contents.send.mock.calls.some(([channel]) => channel === 'app:confirm')).toBe(
      false,
    )
    expect(mocks.installHook).toHaveBeenCalledOnce()
    expect(mocks.uninstallHook).not.toHaveBeenCalled()
  })

  it.each(['untrusted', 'invalid provider'] as const)(
    'rejects an uninstall from %s',
    async (reason) => {
      await mocks.handlers.get('app:bootstrap')!(event)
      const sender = reason === 'untrusted' ? { ...event, senderFrame: {} } : event
      const provider = reason === 'invalid provider' ? '__proto__' : 'pi'
      const result = await mocks.handlers.get('agent:hooks-uninstall')!(sender, provider)
      expect(result).toMatchObject({ ok: false })
      if (reason === 'untrusted') expect(result).toMatchObject({ error: '拒绝未授权的窗口请求。' })
      expect(mocks.uninstallHook).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['codex', false],
    ['codex', true],
    ['pi', false],
    ['pi', true],
    ['claude', false],
    ['claude', true],
  ] as const)(
    'requires confirmation to uninstall %s when confirmed=%s',
    async (provider, confirmed) => {
      await mocks.handlers.get('app:bootstrap')!(event)
      mocks.detectAgents.mockClear()
      mocks.contents.send.mockClear()
      const pending = mocks.handlers.get('agent:hooks-uninstall')!(event, provider)
      let answered = false
      try {
        await vi.waitFor(() =>
          expect(mocks.contents.send).toHaveBeenCalledWith(
            'app:confirm',
            expect.objectContaining({ title: expect.stringContaining('卸载') }),
          ),
        )
        expect(mocks.uninstallHook).not.toHaveBeenCalled()
        expect(mocks.detectAgents).not.toHaveBeenCalled()
        expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, provider)).toMatchObject({
          ok: false,
          error: expect.stringContaining('无法显示卸载确认'),
        })
        const request = mocks.contents.send.mock.calls.find(
          ([channel]) => channel === 'app:confirm',
        )![1]
        expect(request.description).toBe('不会退出正在运行的 Agent；重启 Agent 后停止状态同步。')
        expect(request.confirmLabel).toBe('卸载')
        expect(
          await mocks.handlers.get('app:confirm-response')!(event, request.id, confirmed),
        ).toMatchObject({ ok: true })
        answered = true
        expect(await pending).toMatchObject(
          confirmed ? { ok: true, value: { state: 'missing' } } : { ok: true, value: null },
        )
        expect(mocks.uninstallHook).toHaveBeenCalledTimes(confirmed ? 1 : 0)
        expect(mocks.installHook).not.toHaveBeenCalled()
      } finally {
        if (!answered)
          mocks.rendererEvents.get('did-start-navigation')!({
            isMainFrame: true,
            isSameDocument: false,
          })
        await pending
      }
    },
  )

  it('rejects Hooks operations after the renderer navigates away', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: true,
      value: { provider: 'pi', state: 'installed' },
    })
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false })
    try {
      expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
        ok: false,
        error: expect.stringContaining('当前无法安装'),
      })
      expect(mocks.installHook).toHaveBeenCalledOnce()
      expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, 'pi')).toMatchObject({
        ok: false,
        error: expect.stringContaining('无法显示卸载确认'),
      })
      expect(mocks.uninstallHook).not.toHaveBeenCalled()
    } finally {
      await mocks.handlers.get('app:bootstrap')!(event)
    }
  })
})
