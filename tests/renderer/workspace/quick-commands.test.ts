import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, MAX_TERMINALS } from '../../../src/shared/contracts'
import { useWorkspace } from '../../../src/renderer/src/state/workspace'

import { managedWorktree, scanFor } from './worktree.fixture'

async function quickCommandWorkspace() {
  await useWorkspace.getState().bootstrap()
  const value = managedWorktree()
  const local = {
    id: crypto.randomUUID(),
    projectPath: value.record.projectPath,
    name: '本地',
    kind: 'local' as const,
  }
  const scan = scanFor(value)
  useWorkspace.setState({
    projects: [value.record.projectPath],
    workspaces: [local, value.workspace],
    worktreeScans: { [value.record.projectPath]: scan },
    preferences: {
      ...DEFAULT_CONFIG.preferences,
      quickCommands: [
        {
          id: 'dev',
          name: '开发服务',
          command: 'pnpm dev',
          scope: { type: 'project', projectPath: value.record.projectPath },
        },
        { id: 'global', name: '全局', command: 'git status', scope: { type: 'global' } },
        {
          id: 'other',
          name: '其他项目',
          command: 'false',
          scope: { type: 'project', projectPath: '/tmp/other' },
        },
      ],
    },
  })
  return { value, local, scan }
}

const store = () => useWorkspace.getState()

describe('Workspace quick commands', () => {
  it('runs in the selected worktree without saving or replaying startup text', async () => {
    const { value } = await quickCommandWorkspace()
    store().runQuickCommand('dev', value.workspace.id)
    const tab = store().tabs.find((entry) => entry.workspaceId === value.workspace.id)!
    expect(tab).toMatchObject({
      workspaceId: value.workspace.id,
      cwd: value.record.path,
      title: '开发服务',
      startupCommand: 'pnpm dev',
      status: 'starting',
    })
    expect(store().activeTabs[value.workspace.id]).toBe(tab.id)
    expect(store().recentQuickCommands[value.workspace.id]).toBe('dev')
    expect(vi.mocked(api.saveLayout).mock.calls.at(-1)![0].tabs[0]).not.toHaveProperty(
      'startupCommand',
    )
    store().updateTab(tab.id, { status: 'running', startupCommand: undefined })
    await store().closeTab(tab.id)
    store().reopenTab()
    expect(store().tabs[0].id).not.toBe(tab.id)
    expect(store().tabs[0].startupCommand).toBeUndefined()
    expect(api.writeTerminal).not.toHaveBeenCalled()
  })

  it('runs a global command in the local workspace', async () => {
    const { local, value } = await quickCommandWorkspace()
    store().runQuickCommand('global', local.id)
    expect(store().tabs.find((entry) => entry.workspaceId === local.id)).toMatchObject({
      workspaceId: local.id,
      cwd: value.record.projectPath,
      startupCommand: 'git status',
    })
    expect(api.writeTerminal).not.toHaveBeenCalled()
  })

  it.each([
    ['other', '不属于当前项目'],
    ['deleted', '快捷命令不存在'],
  ])('rejects the %s command without creating a terminal', async (id, error) => {
    const { local } = await quickCommandWorkspace()
    expect(() => store().runQuickCommand(id, local.id)).toThrow(error)
    expect(store().tabs).toHaveLength(0)
    expect(api.writeTerminal).not.toHaveBeenCalled()
  })

  it('rejects commands for an unavailable worktree', async () => {
    const { value, scan } = await quickCommandWorkspace()
    scan.entries[0].status = 'missing'
    expect(() => store().runQuickCommand('dev', value.workspace.id)).toThrow('不可用')
    expect(store().tabs).toHaveLength(0)
  })

  it('rejects commands while their workspace is closing', async () => {
    const { local } = await quickCommandWorkspace()
    const before = store().tabs
    useWorkspace.setState({ removingWorkspace: local.id })
    expect(() => store().runQuickCommand('global', local.id)).toThrow('正在关闭')
    expect(store().tabs).toBe(before)
  })

  it('rejects commands when the terminal limit is reached', async () => {
    const { local } = await quickCommandWorkspace()
    store().runQuickCommand('global', local.id)
    const tab = store().tabs[0]
    useWorkspace.setState({
      tabs: Array.from({ length: MAX_TERMINALS }, () => ({ ...tab, id: crypto.randomUUID() })),
    })
    expect(() => store().runQuickCommand('global', local.id)).toThrow(
      `最多保留 ${MAX_TERMINALS} 个终端`,
    )
    expect(api.writeTerminal).not.toHaveBeenCalled()
  })

  it('reuses a running service only in its workspace and starts a new one after exit', async () => {
    const { value, local } = await quickCommandWorkspace()
    useWorkspace.setState({
      preferences: {
        ...store().preferences,
        quickCommands: store().preferences.quickCommands.map((entry) =>
          entry.id === 'dev'
            ? { ...entry, mode: 'service' as const, port: 'auto' as const }
            : entry,
        ),
      },
    })
    store().runQuickCommand('dev', value.workspace.id)
    const service = store().tabs[0]
    expect(service.service).toEqual({ commandId: 'dev', name: '开发服务' })
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().tabs).toHaveLength(1)
    store().updateTab(service.id, { status: 'running' })
    store().runQuickCommand('dev', local.id)
    expect(store().tabs).toHaveLength(2)
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().activeTabs[value.workspace.id]).toBe(service.id)
    expect(store().tabs).toHaveLength(2)
    store().updateTab(service.id, { status: 'exited' })
    store().runQuickCommand('dev', value.workspace.id)
    expect(store().tabs).toHaveLength(3)
    expect(store().tabs.at(-1)!.id).not.toBe(service.id)
  })
})
