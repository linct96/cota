import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  it('starts with defaults and persists only preferences and recent projects', async () => {
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
  it('does not expose mutable internal state', async () => {
    const store = new ConfigStore(file)
    const value = await store.load()
    value.config.preferences.scrollback = 1
    expect(store.snapshot().preferences.scrollback).toBe(5000)
  })
})
