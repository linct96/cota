import { api } from './workspace.fixture'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, MAX_TERMINALS } from '../../../src/shared/contracts'
import { useWorkspace } from '../../../src/renderer/src/state/workspace'

import { managedWorktree, scanFor } from './worktree.fixture'

describe('Workspace quick commands', () => {
  it('runs quick commands only in their scoped workspace and never saves or replays startup text', async () => {
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
    const store = () => useWorkspace.getState()
    store().runQuickCommand('dev', value.workspace.id)
    const tab = store().tabs[0]
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
    store().runQuickCommand('global', local.id)
    expect(store().tabs.at(-1)).toMatchObject({
      workspaceId: local.id,
      cwd: value.record.projectPath,
      startupCommand: 'git status',
    })
    const before = store().tabs
    expect(() => store().runQuickCommand('other', local.id)).toThrow('不属于当前项目')
    expect(() => store().runQuickCommand('deleted', local.id)).toThrow('快捷命令不存在')
    scan.entries[0].status = 'missing'
    expect(() => store().runQuickCommand('dev', value.workspace.id)).toThrow('不可用')
    useWorkspace.setState({ removingWorkspace: local.id })
    expect(() => store().runQuickCommand('global', local.id)).toThrow('正在关闭')
    expect(store().tabs).toBe(before)
    useWorkspace.setState({
      removingWorkspace: undefined,
      tabs: Array.from({ length: MAX_TERMINALS }, () => ({
        ...before[0],
        id: crypto.randomUUID(),
      })),
    })
    expect(() => store().runQuickCommand('global', local.id)).toThrow(
      `最多保留 ${MAX_TERMINALS} 个终端`,
    )
    expect(api.writeTerminal).not.toHaveBeenCalled()
    scan.entries[0].status = 'ready'
    useWorkspace.setState({
      tabs: [],
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
