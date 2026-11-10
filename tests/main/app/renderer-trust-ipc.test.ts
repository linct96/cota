import { event, mocks } from './ipc.fixture'
import { describe, expect, it } from 'vitest'

describe('Renderer document trust', () => {
  it.each(['#/', '#/settings'])('accepts hash routes of the trusted document: %s', async (hash) => {
    mocks.contents.mainFrame.url = `http://localhost:5173/${hash}`
    expect(await mocks.handlers.get('app:bootstrap')!(event)).toMatchObject({ ok: true })
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it.each([
    'http://localhost:5173/other#/settings',
    'http://localhost:5173/?other=true#/settings',
    'http://localhost:5174/#/settings',
    'https://localhost:5173/#/settings',
    'http://untrusted.example/#/settings',
    'file:///tmp/index.html#/settings',
  ])('rejects other documents even with a settings hash: %s', async (url) => {
    mocks.contents.mainFrame.url = url
    expect(await mocks.handlers.get('app:bootstrap')!(event)).toEqual({
      ok: false,
      error: '拒绝未授权的窗口请求。',
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
