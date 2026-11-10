import { event, mocks, path } from './ipc.fixture'
import { describe, expect, it, vi } from 'vitest'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

describe('Workspace program launch IPC', () => {
  it('opens a known project in the system file manager without a saved program', async () => {
    const directory = await realpath(process.cwd())
    mocks.config.recentProjects = [directory]
    expect(
      await mocks.handlers.get('workspace:open-with')!(event, directory, 'system-file-manager'),
    ).toEqual({ ok: true })
    expect(mocks.openPath).toHaveBeenCalledExactlyOnceWith(directory)
    expect(mocks.openWorkspaceWith).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reports system file manager errors and allows retry', async () => {
    const directory = await realpath(process.cwd())
    mocks.config.recentProjects = [directory]
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.openPath.mockResolvedValueOnce('Unable to open directory')
    const pending = mocks.handlers.get('workspace:open-with')!(
      event,
      directory,
      'system-file-manager',
    )
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:confirm',
        expect.objectContaining({ description: 'Unable to open directory' }),
      ),
    )
    const request = mocks.contents.send.mock.calls.find(([name]) => name === 'app:confirm')![1]
    await mocks.handlers.get('app:confirm-response')!(event, request.id, false)
    expect(await pending).toEqual({ ok: false, error: 'Unable to open directory' })
    expect(
      await mocks.handlers.get('workspace:open-with')!(event, directory, 'system-file-manager'),
    ).toEqual({ ok: true })
  })

  it('uses only settings programs for known workspaces without touching terminal sessions', async () => {
    mocks.config.recentProjects = [path]
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'zed')).toEqual({
      ok: true,
    })
    expect(mocks.openWorkspaceWith).toHaveBeenCalledExactlyOnceWith(
      path,
      mocks.config.preferences.openWith[0],
    )
    const target = { projectPath: path, workspaceId: randomUUID() }
    mocks.withTerminalTarget.mockImplementationOnce((_target, action) => {
      try {
        return Promise.resolve(action({ cwd: '/tmp/managed-worktree' }))
      } catch (cause) {
        return Promise.reject(cause)
      }
    })
    expect(await mocks.handlers.get('workspace:open-with')!(event, target, 'zed')).toEqual({
      ok: true,
    })
    expect(mocks.withTerminalTarget).toHaveBeenCalledWith(target, expect.any(Function))
    expect(mocks.openWorkspaceWith).toHaveBeenLastCalledWith(
      '/tmp/managed-worktree',
      mocks.config.preferences.openWith[0],
    )
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'vscode')).toMatchObject({
      ok: false,
      error: '打开方式不存在，请检查设置。',
    })
    expect(mocks.openWorkspaceWith).toHaveBeenCalledTimes(2)
    mocks.listWorkspaceOpeners.mockReturnValueOnce(mocks.config.preferences.openWith)
    expect(await mocks.handlers.get('workspace:openers')!(event)).toEqual({
      ok: true,
      value: mocks.config.preferences.openWith,
    })
    expect(mocks.listWorkspaceOpeners).toHaveBeenCalledExactlyOnceWith(mocks.config.preferences)
    expect(
      await mocks.handlers.get('workspace:openers')!({ ...event, senderFrame: {} }),
    ).toMatchObject({ ok: false })
    expect(mocks.listWorkspaceOpeners).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('rejects untrusted frames, unknown projects, and arbitrary program definitions', async () => {
    const open = mocks.handlers.get('workspace:open-with')!
    expect(await open(event, path, 'zed')).toMatchObject({ ok: false })
    expect(await open(event, path, 'system-file-manager')).toMatchObject({ ok: false })
    mocks.config.recentProjects = [path]
    expect(await open({ ...event, senderFrame: {} }, path, 'system-file-manager')).toMatchObject({
      ok: false,
    })
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(await open({ ...event, senderFrame: {} }, path, 'zed')).toMatchObject({ ok: false })
    expect(await open(event, path, { command: '/bin/sh' })).toMatchObject({ ok: false })
    expect(await open(event, path, 'removed')).toMatchObject({ ok: false })
    expect(mocks.openWorkspaceWith).not.toHaveBeenCalled()

    const guide = mocks.handlers.get('agent:cli-install-guide')!
    expect(await guide({ ...event, senderFrame: {} }, 'pi')).toMatchObject({ ok: false })
    for (const value of ['__proto__', 'https://example.com', { provider: 'pi' }])
      expect(await guide(event, value)).toMatchObject({ ok: false })
    expect(mocks.openExternal).not.toHaveBeenCalled()
    for (const [provider, url] of [
      ['pi', 'https://pi.dev/docs/latest/quickstart#1-install-pi'],
      ['codex', 'https://github.com/openai/codex#installing-and-running-codex-cli'],
      ['claude', 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code'],
    ]) {
      expect(await guide(event, provider)).toMatchObject({ ok: true })
      expect(mocks.openExternal).toHaveBeenLastCalledWith(url)
    }
    mocks.openExternal.mockRejectedValueOnce(new Error('无法打开浏览器'))
    expect(await guide(event, 'pi')).toMatchObject({ ok: false, error: '无法打开浏览器' })
    expect(mocks.handlers.has('agent:cli-install')).toBe(false)
  })

  it('shows a launch failure through the existing confirmation channel and permits retry', async () => {
    mocks.config.recentProjects = [path]
    await mocks.handlers.get('app:bootstrap')!(event)
    mocks.openWorkspaceWith.mockRejectedValueOnce(new Error('command not found'))
    const pending = mocks.handlers.get('workspace:open-with')!(event, path, 'zed')
    await vi.waitFor(() =>
      expect(mocks.contents.send).toHaveBeenCalledWith(
        'app:confirm',
        expect.objectContaining({ description: 'command not found' }),
      ),
    )
    const request = mocks.contents.send.mock.calls.find(([name]) => name === 'app:confirm')![1]
    await mocks.handlers.get('app:confirm-response')!(event, request.id, false)
    expect(await pending).toEqual({ ok: false, error: 'command not found' })
    expect(await mocks.handlers.get('workspace:open-with')!(event, path, 'zed')).toEqual({
      ok: true,
    })
  })
})
