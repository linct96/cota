import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import {
  MAX_TERMINALS,
  AGENT_PROVIDERS,
  type AgentProvider,
  type TerminalLaunch,
  type Preferences,
  type WorkspaceOpener,
  type RemoveWorkspace,
  type WorkspaceTarget,
  type WorkspaceLayout,
  type ProjectWorkspace,
  type WorktreeRecord,
  type CreateWorktreeInput,
} from '../shared/contracts'
import { parseArguments } from '../shared/open-with'
import {
  DEFAULT_TERMINAL_APPEARANCE,
  terminalAppearanceSchema,
} from '../shared/terminal-appearance'

export function absolutePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.includes('\0') ||
    value.length > 4096
  ) {
    throw new Error('请输入不带命令参数的可执行文件或目录绝对路径。')
  }
  return value
}

export async function projectDirectory(value: unknown): Promise<string> {
  const path = absolutePath(value)
  try {
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory')
    await access(canonical, constants.R_OK | constants.X_OK)
    return canonical
  } catch {
    throw new Error(`项目目录不可访问，可能已移动或删除：${path}`)
  }
}

export async function executable(value: unknown): Promise<string> {
  const path = absolutePath(value)
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a file')
    await access(path, constants.X_OK)
    return path
  } catch {
    throw new Error(`Shell 不存在或不可执行：${path}`)
  }
}

export function preferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('设置格式无效。')
  const {
    theme = 'system',
    terminalAppearance = DEFAULT_TERMINAL_APPEARANCE,
    shellName,
    shellPath,
    scrollback,
    openWith,
    terminalGpuAcceleration = 'auto',
    commitMessagePrompt = '',
  } = value as Partial<Preferences>
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') throw new Error('主题选项无效。')
  if (
    typeof commitMessagePrompt !== 'string' ||
    commitMessagePrompt.length > 4000 ||
    commitMessagePrompt.includes('\0')
  )
    throw new Error('提交信息提示词最多 4,000 字符，不能包含空字符。')
  if (
    terminalGpuAcceleration !== 'auto' &&
    terminalGpuAcceleration !== 'on' &&
    terminalGpuAcceleration !== 'off'
  ) {
    throw new Error('GPU 加速选项无效。')
  }
  if (
    shellName != null &&
    (typeof shellName !== 'string' || shellName.length > 80 || /[\0\r\n]/.test(shellName))
  ) {
    throw new Error('Shell 名称不能包含换行且最多 80 字符。')
  }
  if (shellPath !== null) absolutePath(shellPath)
  if (!Number.isInteger(scrollback) || scrollback! < 1000 || scrollback! > 20000) {
    throw new Error('Scrollback 必须是 1,000–20,000 之间的整数。')
  }
  return {
    theme,
    terminalAppearance: terminalAppearanceSchema.parse(terminalAppearance),
    terminalGpuAcceleration,
    commitMessagePrompt: commitMessagePrompt.trim(),
    shellName: shellPath === null ? null : shellName?.trim() || null,
    shellPath: shellPath as string | null,
    scrollback: scrollback!,
    openWith: workspaceOpeners(openWith),
  }
}

export function workspaceOpeners(value: unknown): WorkspaceOpener[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('打开方式最多配置 50 项。')
  const openers = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('打开方式格式无效。')
    const { id, name, command, arguments: args } = entry as Partial<WorkspaceOpener>
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('打开方式标识无效。')
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\0\r\n]/.test(name))
      throw new Error('请输入程序名称（上限 80 字符）。')
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 4096 ||
      /[\0\r\n]/.test(command) ||
      (!isAbsolute(command.trim()) && !/^[\w.+-]+$/.test(command.trim()))
    )
      throw new Error('启动命令需为命令名或可执行文件绝对路径，请将参数单独填写。')
    if (typeof args !== 'string' || args.length > 4096 || args.includes('\0'))
      throw new Error('启动参数无效（上限 4096 字符）。')
    parseArguments(args)
    return { id, name: name.trim(), command: command.trim(), arguments: args }
  })
  if (new Set(openers.map((entry) => entry.id)).size !== openers.length)
    throw new Error('打开方式标识重复。')
  return openers
}

export function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new Error('终端标识无效。')
  }
  return value
}

export function agentProvider(value: unknown): AgentProvider {
  if (typeof value !== 'string' || !Object.hasOwn(AGENT_PROVIDERS, value))
    throw new Error('不支持的 Agent 类型。')
  return value as AgentProvider
}

export function terminalLaunch(value: unknown): TerminalLaunch {
  if (!value || typeof value !== 'object') throw new Error('终端启动参数无效。')
  const launch = value as Partial<TerminalLaunch>
  if (launch.kind === 'agent')
    return {
      kind: 'agent',
      provider: agentProvider(launch.provider),
      launchId: terminalId(launch.launchId),
    }
  if (
    (launch.kind === undefined || launch.kind === 'shell') &&
    launch.provider === undefined &&
    launch.launchId === undefined
  )
    return { kind: 'shell' }
  throw new Error('终端启动身份无效。')
}

export function workspaceTarget(value: unknown): WorkspaceTarget {
  if (!value || typeof value !== 'object') throw new Error('工作区参数无效。')
  const target = value as Partial<WorkspaceTarget>
  const projectPath = absolutePath(target.projectPath)
  return { projectPath, workspaceId: terminalId(target.workspaceId) }
}

export function workspaceRemoval(value: unknown): RemoveWorkspace {
  const target = workspaceTarget(value)
  const { removeProject } = value as Partial<RemoveWorkspace>
  if (typeof removeProject !== 'boolean') throw new Error('工作区删除参数无效。')
  return { ...target, removeProject }
}

export function createWorktreeInput(value: unknown): CreateWorktreeInput {
  if (!value || typeof value !== 'object') throw new Error('Worktree 参数无效。')
  const input = value as Partial<CreateWorktreeInput>
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\0\r\n]/.test(value))
      throw new Error('Worktree 名称、分支和基准引用不能为空，且不得超过 1024 字符。')
    return value
  }
  return {
    projectPath: absolutePath(input.projectPath),
    name: text(input.name).trim(),
    branchName: text(input.branchName),
    baseRef: text(input.baseRef),
  }
}

export function worktreeNameHistory(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Worktree 名称历史无效。')
  const entries = Object.entries(value)
  let total = 0
  if (entries.length > 10000) throw new Error('Worktree 名称历史过大。')
  return Object.fromEntries(
    entries.map(([repoId, names]) => {
      if (
        !/^[\da-f]{24}$/.test(repoId) ||
        !Array.isArray(names) ||
        names.some(
          (name: unknown) =>
            typeof name !== 'string' ||
            !name ||
            name.length > 4096 ||
            /[\0/]/.test(name) ||
            name === '.' ||
            name === '..',
        )
      )
        throw new Error('Worktree 名称历史无效。')
      const normalized = [...new Set((names as string[]).map((name) => name.toLowerCase()))]
      total += normalized.length
      if (total > 100000) throw new Error('Worktree 名称历史过大。')
      return [repoId, normalized]
    }),
  )
}

export function worktreeRecords(value: unknown): WorktreeRecord[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Worktree 登记列表无效。')
  const path = (value: unknown): string => {
    const result = absolutePath(value)
    if (normalize(result) !== result || result === '/') throw new Error('Worktree 登记路径无效。')
    return result
  }
  const optionalText = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !value || value.length > 1024 || /[\0\r\n]/.test(value))
      throw new Error('Worktree 登记引用无效。')
    return value
  }
  const records = value.map((entry: unknown): WorktreeRecord => {
    if (!entry || typeof entry !== 'object') throw new Error('Worktree 登记格式无效。')
    const data = entry as Partial<WorktreeRecord>
    if (
      (data.origin !== 'created' && data.origin !== 'linked') ||
      typeof data.repoId !== 'string' ||
      !/^[\da-f]{24}$/.test(data.repoId) ||
      typeof data.registeredAt !== 'string' ||
      !Number.isFinite(Date.parse(data.registeredAt))
    )
      throw new Error('Worktree 登记来源或仓库标识无效。')
    return {
      id: terminalId(data.id),
      projectPath: path(data.projectPath),
      repoCommonDir: path(data.repoCommonDir),
      repoId: data.repoId,
      path: path(data.path),
      origin: data.origin,
      initialBranch: optionalText(data.initialBranch),
      baseRef: optionalText(data.baseRef),
      registeredAt: data.registeredAt,
    }
  })
  if (
    new Set(records.map((entry) => entry.id)).size !== records.length ||
    new Set(records.map((entry) => entry.path)).size !== records.length
  )
    throw new Error('Worktree 登记标识或路径重复。')
  const repositories = new Map<string, string>()
  const repositoryIds = new Map<string, string>()
  for (const record of records) {
    if (
      (repositories.has(record.repoCommonDir) &&
        repositories.get(record.repoCommonDir) !== record.repoId) ||
      (repositoryIds.has(record.repoId) &&
        repositoryIds.get(record.repoId) !== record.repoCommonDir)
    )
      throw new Error('Worktree 仓库身份冲突。')
    repositories.set(record.repoCommonDir, record.repoId)
    repositoryIds.set(record.repoId, record.repoCommonDir)
  }
  return records
}

export function workspaceLayout(
  value: unknown,
  projects: string[],
  records: WorktreeRecord[] = [],
): WorkspaceLayout {
  if (!value || typeof value !== 'object') throw new Error('工作区布局无效。')
  const layout = value as WorkspaceLayout
  if (
    !Array.isArray(layout.workspaces) ||
    layout.workspaces.length > 1000 ||
    !Array.isArray(layout.tabs) ||
    layout.tabs.length > MAX_TERMINALS
  )
    throw new Error('工作区布局大小无效。')
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024)
      throw new Error('工作区或终端名称无效（上限 1024 字符）。')
    return value.trim()
  }
  const workspaces = layout.workspaces.map((entry) => {
    if (!entry || !projects.includes(absolutePath(entry.projectPath)))
      throw new Error('布局包含未打开的项目。')
    const workspace = {
      id: terminalId(entry.id),
      projectPath: entry.projectPath,
      name: text(entry.name),
    }
    if (entry.kind === 'local' && entry.worktreeId === undefined)
      return { ...workspace, kind: 'local' } satisfies ProjectWorkspace
    if (
      entry.kind === 'git-worktree' &&
      records.some(
        (record) => record.id === entry.worktreeId && record.projectPath === entry.projectPath,
      )
    )
      return {
        ...workspace,
        kind: 'git-worktree',
        worktreeId: terminalId(entry.worktreeId),
      } satisfies ProjectWorkspace
    throw new Error('工作区类型或 Worktree 关联无效。')
  })
  if (new Set(workspaces.map((entry) => entry.id)).size !== workspaces.length)
    throw new Error('工作区标识重复。')
  const bindings = workspaces.flatMap((entry) =>
    entry.kind === 'git-worktree' ? [entry.worktreeId] : [],
  )
  if (new Set(bindings).size !== bindings.length)
    throw new Error('同一 Worktree 不能重复绑定工作区。')
  const tabs = layout.tabs.map((entry) => {
    const target = workspaceTarget(entry)
    if (
      !workspaces.some(
        (workspace) =>
          workspace.id === target.workspaceId && workspace.projectPath === target.projectPath,
      )
    )
      throw new Error('终端所属工作区不存在。')
    if (entry.kind !== undefined && entry.kind !== 'shell' && entry.kind !== 'agent')
      throw new Error('终端类型无效。')
    if (entry.kind !== 'agent' && entry.provider !== undefined)
      throw new Error('Shell 不能绑定 Agent。')
    return {
      ...target,
      id: terminalId(entry.id),
      title: text(entry.title),
      ...(entry.kind === 'agent'
        ? { kind: 'agent' as const, provider: agentProvider(entry.provider) }
        : {}),
    }
  })
  if (new Set(tabs.map((entry) => entry.id)).size !== tabs.length) throw new Error('终端标识重复。')
  const selectedWorkspaces: Record<string, string> = {}
  const activeTabs: Record<string, string> = {}
  if (
    !layout.selectedWorkspaces ||
    typeof layout.selectedWorkspaces !== 'object' ||
    !layout.activeTabs ||
    typeof layout.activeTabs !== 'object'
  )
    throw new Error('布局选择状态无效。')
  for (const workspace of workspaces) {
    if (layout.selectedWorkspaces[workspace.projectPath] === workspace.id)
      selectedWorkspaces[workspace.projectPath] = workspace.id
    const id = layout.activeTabs[workspace.id]
    if (tabs.some((tab) => tab.id === id && tab.workspaceId === workspace.id))
      activeTabs[workspace.id] = id
  }
  if (
    layout.selectedProject !== undefined &&
    !workspaces.some((entry) => entry.projectPath === layout.selectedProject)
  )
    throw new Error('选中的项目不存在。')
  return {
    workspaces,
    tabs,
    selectedProject: layout.selectedProject,
    selectedWorkspaces,
    activeTabs,
  }
}

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 1000 ||
    Number(rows) < 1 ||
    Number(rows) > 500
  ) {
    throw new Error('终端尺寸无效。')
  }
  return { cols: Number(cols), rows: Number(rows) }
}
