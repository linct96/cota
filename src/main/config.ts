import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, type AppConfig, type Preferences } from '../shared/contracts'
import { absolutePath, preferences, workspaceLayout } from './validation'

export class ConfigStore {
  private config: AppConfig = structuredClone(DEFAULT_CONFIG)
  private queue: Promise<unknown> = Promise.resolve()
  private loadError?: string

  constructor(private readonly file: string) {}

  async load(): Promise<{ config: AppConfig; warning?: string }> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!value || typeof value !== 'object') throw new Error('配置不是对象')
      const data = value as Partial<AppConfig>
      if (data.version !== 1 || !Array.isArray(data.recentProjects))
        throw new Error('不支持的配置版本或项目列表')
      this.config = {
        version: 1,
        recentProjects: [...new Set(data.recentProjects.map(absolutePath))].slice(0, 20),
        preferences: preferences(data.preferences),
      }
      if (data.layout !== undefined)
        this.config.layout = workspaceLayout(data.layout, this.config.recentProjects)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadError = `无法读取配置，原文件已保留。请修复或移走 ${this.file} 后重启。${error instanceof Error ? error.message : ''}`
      }
    }
    return { config: this.snapshot(), warning: this.loadError }
  }

  snapshot(): AppConfig {
    return structuredClone(this.config)
  }

  remember(path: string): Promise<void> {
    return this.update((config) => {
      config.recentProjects = [
        path,
        ...config.recentProjects.filter((entry) => entry !== path),
      ].slice(0, 20)
      if (config.layout) {
        config.layout.workspaces = config.layout.workspaces.filter((entry) =>
          config.recentProjects.includes(entry.projectPath),
        )
        config.layout.tabs = config.layout.tabs.filter((entry) =>
          config.recentProjects.includes(entry.projectPath),
        )
        if (
          config.layout.selectedProject &&
          !config.recentProjects.includes(config.layout.selectedProject)
        )
          config.layout.selectedProject = undefined
        config.layout = workspaceLayout(config.layout, config.recentProjects)
      }
    })
  }

  forget(path: string): Promise<void> {
    return this.update((config) => {
      config.recentProjects = config.recentProjects.filter((entry) => entry !== path)
      if (config.layout) {
        config.layout.workspaces = config.layout.workspaces.filter(
          (entry) => entry.projectPath !== path,
        )
        config.layout.tabs = config.layout.tabs.filter((entry) => entry.projectPath !== path)
        if (config.layout.selectedProject === path) config.layout.selectedProject = undefined
        config.layout = workspaceLayout(config.layout, config.recentProjects)
      }
    })
  }

  savePreferences(value: Preferences): Promise<void> {
    return this.update((config) => {
      config.preferences = value
    })
  }

  saveLayout(value: unknown): Promise<void> {
    return this.update((config) => {
      config.layout = workspaceLayout(value, config.recentProjects)
    })
  }

  async flush(): Promise<void> {
    await this.queue
  }

  private update(change: (config: AppConfig) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.loadError) throw new Error(this.loadError)
      const next = this.snapshot()
      change(next)
      const temp = `${this.file}.${randomUUID()}.tmp`
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      try {
        await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
        await rename(temp, this.file)
        this.config = next
      } finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
