import { event, mocks } from './ipc.fixture'
import { describe, expect, it, vi } from 'vitest'

describe('Agent Hooks IPC installation, trust and removal', () => {
  it('installs and trusts explicitly, confirms removal and rejects stale renderer requests', async () => {
    await mocks.handlers.get('app:bootstrap')!(event)
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('agent:hooks-detect')!(event)).toMatchObject({ ok: true })
    expect(mocks.installHook).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('agent:hooks-install')!({ ...event, senderFrame: {} }, 'codex'),
    ).toMatchObject({ ok: false })
    expect(await mocks.handlers.get('agent:hooks-install')!(event, '__proto__')).toMatchObject({
      ok: false,
    })
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
    expect(
      await mocks.handlers.get('agent:hooks-trust')!({ ...event, senderFrame: {} }, 'codex'),
    ).toMatchObject({ ok: false, error: '拒绝未授权的窗口请求。' })
    expect(await mocks.handlers.get('agent:hooks-trust')!(event, 'claude')).toMatchObject({
      ok: false,
      error: expect.stringContaining('仅 Codex'),
    })
    expect(await mocks.handlers.get('agent:hooks-trust')!(event, 'codex')).toMatchObject({
      ok: false,
      error: expect.stringContaining('请先安装或更新'),
    })
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
    expect(mocks.installHook).toHaveBeenCalledOnce()
    mocks.detectAgents.mockResolvedValueOnce([{ provider: 'codex', error: 'missing' }])
    expect(await mocks.handlers.get('agent:hooks-trust')!(event, 'codex')).toMatchObject({
      ok: false,
      error: expect.stringContaining('找不到 Codex'),
    })
    expect(mocks.installHook).toHaveBeenCalledOnce()
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
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    expect(mocks.uninstallHook).not.toHaveBeenCalled()
    expect(
      await mocks.handlers.get('agent:hooks-uninstall')!({ ...event, senderFrame: {} }, 'pi'),
    ).toMatchObject({ ok: false, error: '拒绝未授权的窗口请求。' })
    expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, '__proto__')).toMatchObject({
      ok: false,
    })
    for (const provider of ['codex', 'pi', 'claude'] as const) {
      for (const confirmed of [false, true]) {
        mocks.contents.send.mockClear()
        mocks.uninstallHook.mockClear()
        const pending = mocks.handlers.get('agent:hooks-uninstall')!(event, provider)
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
        await mocks.handlers.get('app:confirm-response')!(event, request.id, confirmed)
        expect(await pending).toMatchObject(
          confirmed ? { ok: true, value: { state: 'missing' } } : { ok: true, value: null },
        )
        expect(mocks.uninstallHook).toHaveBeenCalledTimes(confirmed ? 1 : 0)
      }
    }
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    mocks.rendererEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false })
    expect(await mocks.handlers.get('agent:hooks-install')!(event, 'pi')).toMatchObject({
      ok: false,
      error: expect.stringContaining('当前无法安装'),
    })
    expect(mocks.installHook).toHaveBeenCalledTimes(2)
    expect(await mocks.handlers.get('agent:hooks-uninstall')!(event, 'pi')).toMatchObject({
      ok: false,
      error: expect.stringContaining('无法显示卸载确认'),
    })
    expect(mocks.uninstallHook).toHaveBeenCalledOnce()
    await mocks.handlers.get('app:bootstrap')!(event)
  })
})
