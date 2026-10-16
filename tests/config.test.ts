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
    await store.savePreferences({ shellPath: '/bin/bash', scrollback: 1000 })
    const restored = await new ConfigStore(file).load()
    expect(restored.config).toEqual({
      version: 1,
      recentProjects: ['/tmp/中文 项目'],
      preferences: { shellPath: '/bin/bash', scrollback: 1000 },
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
  it('serializes concurrent writes, deduplicates and keeps the 20 most recent', async () => {
    const store = new ConfigStore(file)
    await store.load()
    await Promise.all(Array.from({ length: 22 }, (_, i) => store.remember(`/tmp/p${i}`)))
    await store.remember('/tmp/p5')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.recentProjects).toHaveLength(20)
    expect(saved.recentProjects[0]).toBe('/tmp/p5')
    expect(new Set(saved.recentProjects).size).toBe(20)
    expect(saved.recentProjects).not.toContain('/tmp/p0')
  })
  it.each([
    '{broken',
    '{"version":2,"recentProjects":[]}',
    '{"version":1,"recentProjects":[],"preferences":{"shellPath":null,"scrollback":0}}',
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
    expect(store.snapshot().recentProjects).toEqual(['/missing/中文 项目', '/tmp/other'])
  })
  it('persists layout atomically, prunes deleted projects, and rejects invalid owners without replacing valid data', async () => {
    const store = new ConfigStore(file)
    await store.load()
    const path = '/tmp/project'
    await store.remember(path)
    const workspace = { id: randomUUID(), projectPath: path, name: '中文 workspace' }
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
    const workspace = { id: randomUUID(), projectPath: '/tmp/first', name: '工作区 1' }
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
  it('does not expose mutable internal state', async () => {
    const store = new ConfigStore(file)
    const value = await store.load()
    value.config.preferences.scrollback = 1
    expect(store.snapshot().preferences.scrollback).toBe(5000)
  })
})
