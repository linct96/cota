import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentCliCacheSchema } from '../../shared/agent-cli'
import type { AgentCliCache } from '../../shared/agent-cli'
import { worktreeSetupSchema } from '../../shared/worktree-setup'
import { pendingHostedReviewSchema } from '../../shared/code-hosting'
import type { PendingHostedReview } from '../../shared/code-hosting'
import { z } from 'zod'
import {
  projectGroupingChangeSchema,
  projectGroupingSchema,
  pruneProjectGrouping,
} from '../../shared/project-groups'
import type { ProjectGrouping } from '../../shared/project-groups'
import { pruneTerminalLayouts } from '../../shared/terminal-layout'
import { DEFAULT_CONFIG } from '../../shared/contracts'
import type {
  AppConfig,
  Preferences,
  ProjectWorkspace,
  WorktreeRecord,
} from '../../shared/contracts'
import {
  absolutePath,
  preferences,
  workspaceLayout,
  worktreeNameHistory,
  worktreeRecords,
} from '../validation'

export class ConfigStore {
  private config: AppConfig = structuredClone(DEFAULT_CONFIG)
  private queue: Promise<unknown> = Promise.resolve()
  private loadError?: string

  constructor(private readonly file: string) {}

  async load(): Promise<{ config: AppConfig; warning?: string }> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!value || typeof value !== 'object') throw new Error('配置不是对象')
      const data = value as Record<keyof AppConfig, unknown>
      if (data.version !== 2 || !Array.isArray(data.recentProjects))
        throw new Error('不支持的配置版本或项目列表（仅支持 V2，不自动迁移旧配置）')
      const next: AppConfig = {
        version: 2,
        recentProjects: [...new Set(data.recentProjects.map(absolutePath))].slice(0, 20),
        preferences: preferences(data.preferences),
        worktreeRecords: worktreeRecords(data.worktreeRecords),
      }
      if (data.projectGrouping !== undefined) {
        const grouping = projectGroupingSchema.parse(data.projectGrouping)
        for (const group of grouping.groups) group.projects = group.projects.map(absolutePath)
        next.projectGrouping = pruneProjectGrouping(
          projectGroupingSchema.parse(grouping),
          next.recentProjects,
        )
      }
      if (data.agentCliCache !== undefined) {
        const cache = agentCliCacheSchema.safeParse(data.agentCliCache)
        if (cache.success) next.agentCliCache = cache.data
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
          Object.entries(data.worktreeSetups).map(([path, inputValue]) => [
            absolutePath(path),
            worktreeSetupSchema.parse(inputValue),
          ]),
        )
      }
      if (data.codeHostingPendingCreates !== undefined)
        next.codeHostingPendingCreates = z
          .array(z.union([z.string().regex(/^[a-f0-9]{64}$/), pendingHostedReviewSchema]))
          .max(100)
          .parse(data.codeHostingPendingCreates)
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

  async changeProjectGrouping(value: unknown): Promise<ProjectGrouping> {
    const change = projectGroupingChangeSchema.parse(value)
    let saved!: ProjectGrouping
    await this.update((config) => {
      const grouping = config.projectGrouping || { groups: [] }
      if (change.type === 'create' || change.type === 'rename') {
        if (
          grouping.groups.some(
            (group) =>
              group.name === change.name && (change.type === 'create' || group.id !== change.id),
          )
        )
          throw new Error('已存在同名分组。')
      }
      if (change.type === 'create') {
        const path = change.projectPath ? absolutePath(change.projectPath) : undefined
        if (path && !config.recentProjects.includes(path)) throw new Error('请先添加项目。')
        if (path) {
          for (const entry of grouping.groups)
            entry.projects = entry.projects.filter((project) => project !== path)
        }
        grouping.groups.push({
          id: randomUUID(),
          name: change.name,
          projects: path ? [path] : [],
          collapsed: false,
        })
      } else if (change.type === 'move') {
        const group = grouping.groups.find((entry) => entry.id === change.groupId)
        if (change.groupId !== null && !group) throw new Error('分组不存在，请重新选择。')
        const path = absolutePath(change.projectPath)
        if (!config.recentProjects.includes(path)) throw new Error('请先添加项目。')
        for (const entry of grouping.groups)
          entry.projects = entry.projects.filter((project) => project !== path)
        if (group) {
          group.projects.push(path)
          group.collapsed = false
        }
      } else {
        const group = grouping.groups.find((entry) => entry.id === change.id)
        if (!group) throw new Error('分组不存在，请重新选择。')
        if (change.type === 'rename') group.name = change.name
        else if (change.type === 'collapse') group.collapsed = change.collapsed
        else grouping.groups = grouping.groups.filter((entry) => entry.id !== change.id)
      }
      config.projectGrouping = projectGroupingSchema.parse(grouping)
      saved = structuredClone(config.projectGrouping)
    })
    return saved
  }

  savePreferences(value: Preferences): Promise<void> {
    return this.update((config) => {
      config.preferences = value
    })
  }

  saveAgentClis(value: AgentCliCache): Promise<void> {
    const cache = agentCliCacheSchema.parse(value)
    return this.update((config) => {
      config.agentCliCache = cache
    })
  }

  saveCodeHostingPending(key: string, pending: PendingHostedReview | null): Promise<void> {
    return this.update((config) => {
      const entries = (config.codeHostingPendingCreates || []).filter(
        (entry) => (typeof entry === 'string' ? entry : entry.key) !== key,
      )
      if (pending) entries.push(pendingHostedReviewSchema.parse({ ...pending, key }))
      if (entries.length > 100) throw new Error('待确认的创建操作过多，请先核对已有 PR/MR。')
      config.codeHostingPendingCreates = entries
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
      [repoId]: [...(Object.hasOwn(history, repoId) ? history[repoId] : []), name],
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
      if (next.projectGrouping)
        next.projectGrouping = pruneProjectGrouping(next.projectGrouping, next.recentProjects)
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
