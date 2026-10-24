import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { worktreeSetupSchema } from '../shared/worktree-setup'
import { pruneTerminalLayouts } from '../shared/terminal-layout'
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type Preferences,
  type WorktreeRecord,
  type ProjectWorkspace,
} from '../shared/contracts'
import {
  absolutePath,
  preferences,
  workspaceLayout,
  worktreeRecords,
  worktreeNameHistory,
} from './validation'

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
      if (data.version !== 2 || !Array.isArray(data.recentProjects))
        throw new Error('不支持的配置版本或项目列表（仅支持 V2，不自动迁移旧配置）')
      const next: AppConfig = {
        version: 2,
        recentProjects: [...new Set(data.recentProjects.map(absolutePath))].slice(0, 20),
        preferences: preferences(data.preferences),
        worktreeRecords: worktreeRecords(data.worktreeRecords),
      }
      if (data.worktreeSetups !== undefined) {
        if (
          !data.worktreeSetups ||
          typeof data.worktreeSetups !== 'object' ||
          Array.isArray(data.worktreeSetups) ||
          Object.keys(data.worktreeSetups).length > 1000
        )
          throw new Error('Worktree 初始化配置无效。')
        next.worktreeSetups = Object.fromEntries(
          Object.entries(data.worktreeSetups).map(([path, value]) => [
            absolutePath(path),
            worktreeSetupSchema.parse(value),
          ]),
        )
      }
      if (data.worktreeNameHistory !== undefined)
        next.worktreeNameHistory = worktreeNameHistory(data.worktreeNameHistory)
      if (data.layout !== undefined)
        next.layout = workspaceLayout(data.layout, next.recentProjects, next.worktreeRecords)
      this.config = next
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
      if (!config.recentProjects.includes(path))
        config.recentProjects = [...config.recentProjects, path].slice(-20)
      if (config.layout) {
        this.removeLayoutWorkspaces(
          config,
          (entry) => !config.recentProjects.includes(entry.projectPath),
        )
        config.layout = workspaceLayout(
          config.layout,
          config.recentProjects,
          config.worktreeRecords,
        )
      }
    })
  }

  forget(path: string): Promise<void> {
    return this.update((config) => {
      config.recentProjects = config.recentProjects.filter((entry) => entry !== path)
      if (config.layout) {
        this.removeLayoutWorkspaces(config, (entry) => entry.projectPath === path)
        config.layout = workspaceLayout(
          config.layout,
          config.recentProjects,
          config.worktreeRecords,
        )
      }
    })
  }

  savePreferences(value: Preferences): Promise<void> {
    return this.update((config) => {
      config.preferences = value
    })
  }

  saveWorktreeSetup(projectPath: string, value: unknown): Promise<void> {
    const path = absolutePath(projectPath)
    const definition = worktreeSetupSchema.parse(value)
    return this.update((config) => {
      if (!config.recentProjects.includes(path)) throw new Error('请先打开项目目录。')
      const definitions = { ...config.worktreeSetups }
      if (!definition.command && !definition.copyFiles.length) delete definitions[path]
      else definitions[path] = definition
      config.worktreeSetups = definitions
    })
  }

  saveLayout(value: unknown): Promise<void> {
    return this.update((config) => {
      const next = workspaceLayout(value, config.recentProjects, config.worktreeRecords)
      for (const workspace of next.workspaces) {
        const existing = config.layout?.workspaces.find((entry) => entry.id === workspace.id)
        if (
          existing &&
          (workspace.kind !== existing.kind ||
            workspace.projectPath !== existing.projectPath ||
            workspace.worktreeId !== existing.worktreeId)
        )
          throw new Error('不能通过布局保存更改工作区目录绑定。')
        if (workspace.kind === 'git-worktree' && !existing)
          throw new Error('请通过 Main 创建或重新关联 Git 工作区。')
      }
      // Only explicit Main lifecycle operations may remove a persisted Git workspace.
      const retained =
        config.layout?.workspaces.filter(
          (entry) =>
            entry.kind === 'git-worktree' && !next.workspaces.some((item) => item.id === entry.id),
        ) || []
      next.workspaces.push(...retained)
      config.layout = workspaceLayout(next, config.recentProjects, config.worktreeRecords)
    })
  }

  registerWorktree(record: WorktreeRecord, workspace?: ProjectWorkspace): Promise<void> {
    return this.update((config) => {
      const existing = config.worktreeRecords.find((entry) => entry.id === record.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(record))
        throw new Error('Worktree 登记身份冲突。')
      config.worktreeRecords = worktreeRecords(
        existing ? config.worktreeRecords : [...config.worktreeRecords, record],
      )
      this.rememberWorktreeName(config, record.repoId, basename(record.path))
      if (workspace) {
        const layout = config.layout || {
          workspaces: [],
          tabs: [],
          selectedWorkspaces: {},
          activeTabs: {},
        }
        if (!layout.workspaces.some((entry) => entry.id === workspace.id))
          layout.workspaces.push(workspace)
        layout.selectedProject = workspace.projectPath
        layout.selectedWorkspaces[workspace.projectPath] = workspace.id
        config.layout = workspaceLayout(layout, config.recentProjects, config.worktreeRecords)
      }
    })
  }

  closeWorkspace(id: string): Promise<void> {
    return this.update((config) => this.removeLayoutWorkspaces(config, (entry) => entry.id === id))
  }

  reserveWorktreeName(repoId: string, name: string): Promise<void> {
    return this.update((config) => this.rememberWorktreeName(config, repoId, name))
  }

  private rememberWorktreeName(config: AppConfig, repoId: string, name: string): void {
    const history = config.worktreeNameHistory || {}
    config.worktreeNameHistory = worktreeNameHistory({
      ...history,
      [repoId]: [...(Object.hasOwn(history, repoId) ? history[repoId]! : []), name],
    })
  }

  forgetWorktree(id: string): Promise<void> {
    return this.update((config) => {
      const record = config.worktreeRecords.find((entry) => entry.id === id)
      if (record) this.rememberWorktreeName(config, record.repoId, basename(record.path))
      this.removeLayoutWorkspaces(
        config,
        (entry) => entry.kind === 'git-worktree' && entry.worktreeId === id,
      )
      config.worktreeRecords = config.worktreeRecords.filter((entry) => entry.id !== id)
    })
  }

  private removeLayoutWorkspaces(
    config: AppConfig,
    remove: (entry: ProjectWorkspace) => boolean,
  ): void {
    const layout = config.layout
    if (!layout) return
    const removed = new Set(layout.workspaces.filter(remove).map((entry) => entry.id))
    layout.workspaces = layout.workspaces.filter((entry) => !removed.has(entry.id))
    layout.tabs = layout.tabs.filter((entry) => !removed.has(entry.workspaceId))
    if (layout.terminalLayouts)
      layout.terminalLayouts = pruneTerminalLayouts(
        layout.terminalLayouts,
        new Set(layout.tabs.map((tab) => tab.id)),
      )
    layout.selectedWorkspaces = Object.fromEntries(
      Object.entries(layout.selectedWorkspaces).filter(([, id]) => !removed.has(id)),
    )
    layout.activeTabs = Object.fromEntries(
      Object.entries(layout.activeTabs).filter(([id]) => !removed.has(id)),
    )
    if (!layout.workspaces.some((entry) => entry.projectPath === layout.selectedProject))
      layout.selectedProject = undefined
  }

  assertWritable(): void {
    if (this.loadError) throw new Error(this.loadError)
  }

  async flush(): Promise<void> {
    await this.queue
  }

  private update(change: (config: AppConfig) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      this.assertWritable()
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
