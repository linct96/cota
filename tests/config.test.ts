import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConfigStore } from '../src/main/settings/config-store'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import type { NotificationSound } from '../src/shared/notification-sounds'
import { readNotificationSound } from '../src/main/settings/notification-sound'
import { preferences } from '../src/main/validation'
import { preferredWorkspaceOpener } from '../src/shared/open-with'

let root: string
let file: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cota-config-'))
  file = join(root, 'config.json')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('local JSON configuration', () => {
  it('starts with defaults and persists preferences and recent projects before a layout is saved', async () => {
    const store = new ConfigStore(file)
    expect((await store.load()).config).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.preferences.fileExplorer.followSymlinks).toBe(true)
    expect(DEFAULT_CONFIG.preferences.fileIconTheme).toBe('default')
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, fileIconTheme: undefined }).fileIconTheme,
    ).toBe('default')
    for (const fileIconTheme of [null, false, 1, 'invalid', {}, []]) {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, fileIconTheme })).toThrow(
        '文件图标主题选项无效',
      )
    }
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, fileExplorer: undefined }).fileExplorer
        .followSymlinks,
    ).toBe(true)
    expect(
      preferences({
        ...DEFAULT_CONFIG.preferences,
        fileExplorer: { showIgnored: true, followSymlinks: false },
      }).fileExplorer.followSymlinks,
    ).toBe(false)
    await store.remember('/tmp/中文 项目')
    await store.savePreferences({
      ...DEFAULT_CONFIG.preferences,
      shellName: '我的 Bash',
      shellPath: '/bin/bash',
      scrollback: 1000,
      preventSleep: true,
    })
    const restored = await new ConfigStore(file).load()
    expect(restored.config).toEqual({
      version: 2,
      worktreeRecords: [],
      recentProjects: ['/tmp/中文 项目'],
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        shellName: '我的 Bash',
        shellPath: '/bin/bash',
        scrollback: 1000,
        preventSleep: true,
      },
    })
    const quickCommands = [
      {
        id: 'dev',
        name: '开发服务',
        command: 'pnpm dev\npnpm build',
        scope: { type: 'project' as const, projectPath: '/tmp/中文 项目' },
      },
      { id: 'status', name: '状态', command: 'git status', scope: { type: 'global' as const } },
    ]
    await store.savePreferences({ ...store.snapshot().preferences, quickCommands })
    expect((await new ConfigStore(file).load()).config.preferences.quickCommands).toEqual(
      quickCommands,
    )
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await store.savePreferences({ ...store.snapshot().preferences, shellName: null })
    expect((await new ConfigStore(file).load()).config.preferences).toMatchObject({
      shellName: null,
      shellPath: '/bin/bash',
    })
    for (const terminalGpuAcceleration of ['on', 'off', 'auto'] as const) {
      await store.savePreferences({ ...store.snapshot().preferences, terminalGpuAcceleration })
      expect((await new ConfigStore(file).load()).config.preferences.terminalGpuAcceleration).toBe(
        terminalGpuAcceleration,
      )
    }
    for (const fileIconTheme of ['material', 'default'] as const) {
      await store.savePreferences(preferences({ ...store.snapshot().preferences, fileIconTheme }))
      expect((await new ConfigStore(file).load()).config.preferences.fileIconTheme).toBe(
        fileIconTheme,
      )
    }
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, reusePreviewTabs: undefined }).reusePreviewTabs,
    ).toBe(true)
    for (const reusePreviewTabs of [false, true]) {
      await store.savePreferences(
        preferences({ ...store.snapshot().preferences, reusePreviewTabs }),
      )
      expect((await new ConfigStore(file).load()).config.preferences.reusePreviewTabs).toBe(
        reusePreviewTabs,
      )
    }
    for (const reusePreviewTabs of [null, 0, 'false', [], {}]) {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, reusePreviewTabs })).toThrow(
        '预览标签复用选项无效',
      )
    }
    expect(
      preferences({ ...DEFAULT_CONFIG.preferences, confirmCloseRunningTerminal: undefined })
        .confirmCloseRunningTerminal,
    ).toBe(true)
    for (const confirmCloseRunningTerminal of [false, true]) {
      await store.savePreferences(
        preferences({ ...store.snapshot().preferences, confirmCloseRunningTerminal }),
      )
      expect(
        (await new ConfigStore(file).load()).config.preferences.confirmCloseRunningTerminal,
      ).toBe(confirmCloseRunningTerminal)
    }
    for (const confirmCloseRunningTerminal of [null, 0, 'false', [], {}]) {
      expect(() =>
        preferences({ ...DEFAULT_CONFIG.preferences, confirmCloseRunningTerminal }),
      ).toThrow('终端关闭确认选项无效')
    }
    for (const notificationsEnabled of [false, true]) {
      await store.savePreferences(
        preferences({ ...store.snapshot().preferences, notificationsEnabled }),
      )
      expect((await new ConfigStore(file).load()).config.preferences.notificationsEnabled).toBe(
        notificationsEnabled,
      )
    }
    for (const notificationsEnabled of [null, 0, 'false']) {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, notificationsEnabled })).toThrow(
        '通知开关选项无效',
      )
    }
    for (const turnCompleteNotification of ['never', 'unfocused', 'always'] as const) {
      await store.savePreferences(
        preferences({ ...store.snapshot().preferences, turnCompleteNotification }),
      )
      expect((await new ConfigStore(file).load()).config.preferences.turnCompleteNotification).toBe(
        turnCompleteNotification,
      )
    }
    for (const turnCompleteNotification of [null, false, 1, 'invalid', {}, []]) {
      expect(() =>
        preferences({ ...DEFAULT_CONFIG.preferences, turnCompleteNotification }),
      ).toThrow('轮次完成通知选项无效')
    }
    const customSound = { path: join(root, '提示音 sound.MP3') }
    const audio = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00')
    await writeFile(customSound.path, audio)
    const source = `data:audio/mpeg;base64,${audio.toString('base64')}`
    expect(await readNotificationSound(customSound)).toBe(source)
    expect(await readNotificationSound('system')).toBeUndefined()
    expect(await readNotificationSound('none')).toBeUndefined()
    await expect(readNotificationSound({ path: join(root, 'missing.mp3') })).rejects.toThrow(
      '重新选择',
    )
    await expect(readNotificationSound({ path: join(root, 'sound.txt') })).rejects.toThrow(
      '音频文件',
    )
    for (const invalidAudio of [Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
      const path = join(root, 'invalid.wav')
      await writeFile(path, invalidAudio)
      await expect(readNotificationSound({ path })).rejects.toThrow('不能为空，且不能超过 5 MB')
    }
    for (const notificationSound of ['system', 'none', customSound] satisfies NotificationSound[]) {
      await store.savePreferences(
        preferences({ ...store.snapshot().preferences, notificationSound }),
      )
      expect((await new ConfigStore(file).load()).config.preferences.notificationSound).toEqual(
        notificationSound,
      )
    }
    for (const notificationSound of [
      null,
      false,
      1,
      'custom',
      'invalid',
      '/tmp/sound.mp3',
      {},
      [],
      { path: '/tmp/a.txt' },
    ]) {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, notificationSound })).toThrow(
        '通知提示音选项无效',
      )
    }
    for (const path of ['relative.mp3', 'https://example.com/a.mp3', '/tmp/a\0.mp3'])
      expect(() =>
        preferences({ ...DEFAULT_CONFIG.preferences, notificationSound: { path } }),
      ).toThrow()
    for (const oldSound of [
      'two-tone',
      'bong',
      'thump',
      'blip',
      'sonar',
      'blop',
      'ding',
      'clack',
      'beep',
    ]) {
      const oldConfig = {
        ...store.snapshot(),
        preferences: { ...store.snapshot().preferences, notificationSound: oldSound },
      }
      await writeFile(file, JSON.stringify(oldConfig))
      const migrated = await new ConfigStore(file).load()
      expect(migrated.warning).toBeUndefined()
      expect(migrated.config.preferences.notificationSound).toBe('system')
      expect(migrated.config.recentProjects).toEqual(store.snapshot().recentProjects)
    }
    const legacy = JSON.parse(await readFile(file, 'utf8'))
    delete legacy.preferences.terminalGpuAcceleration
    delete legacy.preferences.quickCommands
    delete legacy.preferences.preventSleep
    delete legacy.preferences.reusePreviewTabs
    delete legacy.preferences.confirmCloseRunningTerminal
    delete legacy.preferences.notificationsEnabled
    delete legacy.preferences.turnCompleteNotification
    delete legacy.preferences.notificationSound
    delete legacy.preferences.fileIconTheme
    await writeFile(file, JSON.stringify(legacy))
    expect((await new ConfigStore(file).load()).config.preferences.terminalGpuAcceleration).toBe(
      'auto',
    )
    expect((await new ConfigStore(file).load()).config.preferences.quickCommands).toEqual([])
    expect((await new ConfigStore(file).load()).config.preferences.preventSleep).toBe(true)
    expect((await new ConfigStore(file).load()).config.preferences.reusePreviewTabs).toBe(true)
    expect(
      (await new ConfigStore(file).load()).config.preferences.confirmCloseRunningTerminal,
    ).toBe(true)
    expect((await new ConfigStore(file).load()).config.preferences.fileIconTheme).toBe('default')
    expect((await new ConfigStore(file).load()).config.preferences.notificationsEnabled).toBe(true)
    expect((await new ConfigStore(file).load()).config.preferences.notificationSound).toBe('system')
    expect((await new ConfigStore(file).load()).config.preferences.turnCompleteNotification).toBe(
      'unfocused',
    )
  })
  it('persists custom and empty open-with lists', async () => {
    const store = new ConfigStore(file)
    await store.load()
    const custom = [
      { id: 'editor', name: 'Editor', command: '/opt/editor', arguments: '--folder {path}' },
    ]
    for (const openWith of [custom, []]) {
      await store.savePreferences({
        ...store.snapshot().preferences,
        openWith,
        preferredOpenerId: 'editor',
      })
      const restored = (await new ConfigStore(file).load()).config.preferences
      expect(restored.openWith).toEqual(openWith)
      expect(restored.preferredOpenerId).toBe('editor')
      expect(
        preferredWorkspaceOpener({
          preferences: restored,
          workspaceOpeners: openWith,
        })?.id,
      ).toBe(openWith.length ? 'editor' : undefined)
    }
    for (const preferredOpenerId of ['', '../editor', 12, null]) {
      expect(() => preferences({ ...DEFAULT_CONFIG.preferences, preferredOpenerId })).toThrow(
        '默认打开方式标识无效',
      )
    }
  })
  it('persists project grouping with exclusive membership, independent collapse state and non-destructive removal', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await store.remember('/tmp/first')
    await store.remember('/tmp/second')
    const first = await store.changeProjectGrouping({ type: 'create', name: ' 公司项目 ' })
    const firstId = first.groups[0].id
    expect(first.groups[0]).toMatchObject({ name: '公司项目', projects: [], collapsed: false })
    const second = await store.changeProjectGrouping({
      type: 'create',
      name: '个人项目',
      projectPath: '/tmp/second',
    })
    const secondId = second.groups[1].id
    expect(second.groups[1]).toMatchObject({
      name: '个人项目',
      projects: ['/tmp/second'],
      collapsed: false,
    })
    const workspace = {
      id: randomUUID(),
      projectPath: '/tmp/first',
      name: '工作区',
      kind: 'local' as const,
    }
    const tab = {
      id: randomUUID(),
      projectPath: '/tmp/first',
      workspaceId: workspace.id,
      title: 'Agent',
    }
    await store.saveLayout({
      workspaces: [workspace],
      tabs: [tab],
      selectedProject: '/tmp/first',
      selectedWorkspaces: { '/tmp/first': workspace.id },
      activeTabs: { [workspace.id]: tab.id },
    })
    const layout = store.snapshot().layout
    await store.changeProjectGrouping({ type: 'move', projectPath: '/tmp/first', groupId: firstId })
    await store.changeProjectGrouping({
      type: 'move',
      projectPath: '/tmp/first',
      groupId: secondId,
    })
    await Promise.all([
      store.changeProjectGrouping({ type: 'rename', id: secondId, name: '工具' }),
      store.changeProjectGrouping({ type: 'collapse', id: secondId, collapsed: true }),
    ])
    const restored = (await new ConfigStore(file).load()).config
    expect(restored.projectGrouping).toEqual({
      groups: [
        { id: firstId, name: '公司项目', projects: [], collapsed: false },
        { id: secondId, name: '工具', projects: ['/tmp/second', '/tmp/first'], collapsed: true },
      ],
    })
    await store.changeProjectGrouping({ type: 'move', projectPath: '/tmp/first', groupId: null })
    expect(store.snapshot().projectGrouping).toMatchObject({
      groups: [{ projects: [] }, { projects: ['/tmp/second'] }],
    })
    await store.changeProjectGrouping({
      type: 'move',
      projectPath: '/tmp/first',
      groupId: secondId,
    })
    await store.changeProjectGrouping({ type: 'remove', id: secondId })
    expect(store.snapshot()).toMatchObject({
      recentProjects: ['/tmp/first', '/tmp/second'],
      layout,
      worktreeRecords: [],
    })
    expect(store.snapshot().projectGrouping?.groups.map((group) => group.id)).toEqual([firstId])
    expect((await new ConfigStore(file).load()).config.projectGrouping).toEqual(
      store.snapshot().projectGrouping,
    )
  })

  it('rejects invalid project grouping changes without replacing persisted data', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await store.remember('/tmp/project')
    const grouping = await store.changeProjectGrouping({ type: 'create', name: '项目' })
    const id = grouping.groups[0].id
    const before = await readFile(file, 'utf8')
    for (const change of [
      { type: 'create', name: ' ' },
      { type: 'create', name: '未分组' },
      { type: 'create', name: '项目' },
      { type: 'rename', id, name: 'a'.repeat(81) },
      { type: 'create', name: '新分组', projectPath: '/tmp/missing' },
      { type: 'move', projectPath: '/tmp/missing', groupId: id },
      { type: 'move', projectPath: '../project', groupId: id },
      { type: 'move', projectPath: '/tmp/project', groupId: randomUUID() },
      { type: 'remove', id: randomUUID() },
      { type: 'collapse', id, collapsed: 'yes' },
    ]) {
      await expect(store.changeProjectGrouping(change)).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(before)
      expect(store.snapshot().projectGrouping).toEqual(grouping)
    }
    const invalid = {
      ...store.snapshot(),
      projectGrouping: {
        ...grouping,
        groups: [grouping.groups[0], { ...grouping.groups[0], id: randomUUID() }],
      },
    }
    await writeFile(file, JSON.stringify(invalid))
    const blocked = new ConfigStore(file)
    expect((await blocked.load()).warning).toContain('原文件已保留')
    await expect(blocked.changeProjectGrouping({ type: 'create', name: '新分组' })).rejects.toThrow(
      '原文件已保留',
    )
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(invalid)
  })

  it('prunes project grouping on removal, recent-project eviction and reload while keeping empty groups', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await store.remember('/tmp/old')
    await store.remember('/tmp/removed')
    const grouping = await store.changeProjectGrouping({ type: 'create', name: '保留分组' })
    const id = grouping.groups[0].id
    await store.changeProjectGrouping({ type: 'move', projectPath: '/tmp/old', groupId: id })
    await store.changeProjectGrouping({ type: 'move', projectPath: '/tmp/removed', groupId: id })
    await store.forget('/tmp/removed')
    expect(store.snapshot().projectGrouping?.groups[0].projects).toEqual(['/tmp/old'])
    for (let index = 0; index < 20; index++) await store.remember(`/tmp/new-${index}`)
    expect(store.snapshot().projectGrouping?.groups[0]).toMatchObject({ id, projects: [] })
    const saved = store.snapshot()
    saved.projectGrouping!.groups[0].projects = ['/tmp/old']
    await writeFile(file, JSON.stringify(saved))
    expect((await new ConfigStore(file).load()).config.projectGrouping?.groups[0].projects).toEqual(
      [],
    )
    delete saved.projectGrouping
    await writeFile(file, JSON.stringify(saved))
    const legacy = await new ConfigStore(file).load()
    expect(legacy.warning).toBeUndefined()
    expect(legacy.config.projectGrouping).toBeUndefined()
  })

  it('serializes concurrent writes and keeps the last 20 additions in insertion order without reordering existing projects', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await Promise.all(Array.from({ length: 22 }, (_, i) => store.remember(`/tmp/p${i}`)))
    await store.remember('/tmp/p5')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    const expected = Array.from({ length: 20 }, (_, i) => `/tmp/p${i + 2}`)
    expect(saved.recentProjects).toEqual(expected)
    expect((await new ConfigStore(file).load()).config.recentProjects).toEqual(expected)
  })
  it.each([
    '{broken',
    '{"version":1,"recentProjects":[]}',
    '{"version":2,"recentProjects":[],"worktreeRecords":[],"preferences":{"shellPath":null,"scrollback":5000}}',
  ])('preserves invalid configuration without overwriting it: %s', async (text) => {
    await writeFile(file, text)
    const store = new ConfigStore(file)
    expect((await store.load()).warning).toContain('原文件已保留')
    await expect(store.remember('/tmp/project')).rejects.toThrow('原文件已保留')
    expect(await readFile(file, 'utf8')).toBe(text)
  })
  it('persists removal even for missing directories and allows adding them again', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await store.remember('/missing/中文 项目')
    await store.remember('/tmp/other')
    await store.forget('/missing/中文 项目')
    expect((await new ConfigStore(file).load()).config.recentProjects).toEqual(['/tmp/other'])
    await store.remember('/missing/中文 项目')
    expect(store.snapshot().recentProjects).toEqual(['/tmp/other', '/missing/中文 项目'])
  })
  it('persists layout atomically, prunes deleted projects, and rejects invalid owners without replacing valid data', async () => {
    const store = new ConfigStore(file)
    await store.load()
    const path = '/tmp/project'
    await store.remember(path)
    const workspace = {
      id: randomUUID(),
      projectPath: path,
      name: '中文 workspace',
      kind: 'local' as const,
    }
    const tab = { id: randomUUID(), projectPath: path, workspaceId: workspace.id, title: 'Agent' }
    const sibling = { ...tab, id: randomUUID(), title: 'Shell' }
    const split = {
      type: 'split' as const,
      id: randomUUID(),
      direction: 'horizontal' as const,
      ratio: 0.6,
      children: [
        { type: 'terminal' as const, id: tab.id },
        { type: 'terminal' as const, id: sibling.id },
      ],
    }
    const group = { id: tab.id, root: split, activePaneId: sibling.id }
    const layout = {
      workspaces: [workspace],
      tabs: [tab, sibling],
      terminalLayouts: [group],
      selectedProject: path,
      selectedWorkspaces: { [path]: workspace.id },
      activeTabs: { [workspace.id]: tab.id },
    }
    await store.saveLayout(layout)
    expect((await new ConfigStore(file).load()).config.layout).toEqual(layout)
    const before = await readFile(file, 'utf8')
    await expect(
      store.saveLayout({ ...layout, tabs: [{ ...tab, workspaceId: randomUUID() }] }),
    ).rejects.toThrow('所属工作区')
    await expect(
      store.saveLayout({ ...layout, workspaces: [workspace, workspace] }),
    ).rejects.toThrow('重复')
    await expect(
      store.saveLayout({ ...layout, workspaces: [{ ...workspace, projectPath: '/unknown' }] }),
    ).rejects.toThrow('未打开')
    for (const invalid of [
      { ...split, ratio: 0 },
      { ...split, ratio: 1 },
      { ...split, ratio: NaN },
      { ...split, direction: 'diagonal' },
      { ...split, children: [split.children[0]] },
      { ...split, children: [split.children[0], split.children[0]] },
      { ...split, children: [split.children[0], { type: 'terminal', id: randomUUID() }] },
    ])
      await expect(
        store.saveLayout({ ...layout, terminalLayouts: [{ ...group, root: invalid }] }),
      ).rejects.toThrow('拆分')
    await expect(store.saveLayout({ ...layout, terminalLayouts: [group, group] })).rejects.toThrow(
      '重复',
    )
    await expect(
      store.saveLayout({ ...layout, terminalLayouts: [{ ...group, activePaneId: randomUUID() }] }),
    ).rejects.toThrow('焦点')
    const other = { ...workspace, id: randomUUID() }
    await expect(
      store.saveLayout({
        ...layout,
        workspaces: [workspace, other],
        tabs: [tab, { ...sibling, workspaceId: other.id }],
      }),
    ).rejects.toThrow('跨工作区')
    expect(await readFile(file, 'utf8')).toBe(before)
    await store.forget(path)
    expect((await new ConfigStore(file).load()).config.layout).toEqual({
      workspaces: [],
      tabs: [],
      terminalLayouts: [],
      selectedWorkspaces: {},
      activeTabs: {},
    })
  })
  it('keeps persisted layout valid when a project falls outside the 20 most recent', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await store.remember('/tmp/first')
    const workspace = {
      id: randomUUID(),
      projectPath: '/tmp/first',
      name: '工作区 1',
      kind: 'local' as const,
    }
    await store.saveLayout({
      workspaces: [workspace],
      tabs: [],
      selectedProject: '/tmp/first',
      selectedWorkspaces: {},
      activeTabs: {},
    })
    for (let index = 0; index < 20; index++) await store.remember(`/tmp/project-${index}`)
    const restored = await new ConfigStore(file).load()
    expect(restored.warning).toBeUndefined()
    expect(restored.config.layout?.workspaces).toEqual([])
  })
  it('validates V2 worktree bindings and keeps registry ownership independent of layout writes', async () => {
    const store = new ConfigStore(file)
    await store.load()
    const path = '/tmp/project'
    await store.remember(path)
    const record = {
      id: randomUUID(),
      projectPath: path,
      repoCommonDir: '/tmp/project/.git',
      repoId: 'a'.repeat(24),
      path: '/tmp/managed/worktree',
      origin: 'created' as const,
      registeredAt: new Date().toISOString(),
    }
    await store.registerWorktree(record)
    const workspace = {
      id: randomUUID(),
      projectPath: path,
      name: 'Feature',
      kind: 'git-worktree' as const,
      worktreeId: record.id,
    }
    const layout = { workspaces: [workspace], tabs: [], selectedWorkspaces: {}, activeTabs: {} }
    await expect(store.saveLayout(layout)).rejects.toThrow('Main')
    await store.registerWorktree(record, workspace)
    await store.saveLayout(layout)
    await store.reserveWorktreeName(record.repoId, 'MERCURY')
    await store.reserveWorktreeName(record.repoId, 'mercury')
    expect(store.snapshot().worktreeNameHistory).toEqual({
      [record.repoId]: ['worktree', 'mercury'],
    })
    const before = await readFile(file, 'utf8')
    for (const name of ['', '.', '..', '../mars', 'mars\0venus'])
      await expect(store.reserveWorktreeName(record.repoId, name)).rejects.toThrow('名称历史')
    await expect(store.reserveWorktreeName('__proto__', 'mars')).rejects.toThrow('名称历史')
    for (const workspaces of [
      [{ ...workspace, worktreeId: randomUUID() }],
      [workspace, { ...workspace, id: randomUUID() }],
      [{ ...workspace, kind: 'local' }],
      [{ ...workspace, kind: undefined }],
    ])
      await expect(store.saveLayout({ ...layout, workspaces })).rejects.toThrow()
    for (const invalid of [
      { ...record, path: 'relative' },
      { ...record, id: randomUUID(), path: '/tmp/a/../b' },
      { ...record, id: randomUUID() },
      { ...record, path: '/tmp/unique' },
      { ...record, id: randomUUID(), path: '/tmp/unique', origin: 'forged' },
    ])
      await expect(store.registerWorktree(invalid as typeof record)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(before)
    await store.saveLayout({ ...layout, worktreeRecords: [] })
    expect(store.snapshot().worktreeRecords).toEqual([record])
    const restored = await new ConfigStore(file).load()
    expect(restored.warning).toBeUndefined()
    expect(restored.config.layout?.workspaces).toEqual([workspace])
    expect(restored.config.worktreeNameHistory).toEqual({
      [record.repoId]: ['worktree', 'mercury'],
    })
  })
  it('does not partially load a malformed V2 registry or layout and preserves the original file', async () => {
    for (const data of [
      { ...DEFAULT_CONFIG, worktreeRecords: null },
      { ...DEFAULT_CONFIG, worktreeNameHistory: null },
      { ...DEFAULT_CONFIG, worktreeNameHistory: { invalid: ['mars'] } },
      { ...DEFAULT_CONFIG, worktreeNameHistory: { ['a'.repeat(24)]: ['../mars'] } },
      { ...DEFAULT_CONFIG, recentProjects: ['/tmp/p'], layout: { workspaces: [{}], tabs: [] } },
    ]) {
      const text = JSON.stringify(data)
      await writeFile(file, text)
      const store = new ConfigStore(file)
      expect((await store.load()).warning).toContain('原文件已保留')
      expect(store.snapshot()).toEqual(DEFAULT_CONFIG)
      await expect(store.saveLayout({})).rejects.toThrow('原文件已保留')
      expect(await readFile(file, 'utf8')).toBe(text)
    }
  })
})
