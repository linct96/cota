import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConfigStore } from '../src/main/config'
import { DEFAULT_CONFIG } from '../src/shared/contracts'

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
    await store.remember('/tmp/中文 项目')
    await store.savePreferences({
      ...DEFAULT_CONFIG.preferences,
      shellPath: '/bin/bash',
      scrollback: 1000,
    })
    const restored = await new ConfigStore(file).load()
    expect(restored.config).toEqual({
      version: 2,
      worktreeRecords: [],
      recentProjects: ['/tmp/中文 项目'],
      preferences: { ...DEFAULT_CONFIG.preferences, shellPath: '/bin/bash', scrollback: 1000 },
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
  it('persists custom and empty open-with lists', async () => {
    const store = new ConfigStore(file)
    await store.load()
    const custom = [
      { id: 'editor', name: 'Editor', command: '/opt/editor', arguments: '--folder {path}' },
    ]
    for (const openWith of [custom, []]) {
      await store.savePreferences({ ...store.snapshot().preferences, openWith })
      expect((await new ConfigStore(file).load()).config.preferences.openWith).toEqual(openWith)
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
    const layout = {
      workspaces: [workspace],
      tabs: [tab],
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
    expect(await readFile(file, 'utf8')).toBe(before)
    await store.forget(path)
    expect((await new ConfigStore(file).load()).config.layout).toEqual({
      workspaces: [],
      tabs: [],
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
