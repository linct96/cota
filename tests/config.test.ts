import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConfigStore } from '../src/main/config'
import { DEFAULT_CONFIG } from '../src/shared/contracts'
import type { NotificationSound } from '../src/shared/notification-sounds'
import { readNotificationSound } from '../src/main/notification-sound'
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
    for (const audio of [Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
      const path = join(root, 'invalid.wav')
      await writeFile(path, audio)
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
