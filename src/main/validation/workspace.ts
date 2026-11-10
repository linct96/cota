import { MAX_TERMINALS } from '../../shared/contracts'
import type {
  ProjectWorkspace,
  RemoveWorkspace,
  WorkspaceLayout,
  WorkspaceTarget,
  WorktreeRecord,
} from '../../shared/contracts'
import { terminalPaneIds } from '../../shared/terminal-layout'
import type { TerminalLayout, TerminalPane } from '../../shared/terminal-layout'
import { absolutePath } from './paths'
import { agentProvider, terminalId } from './terminal'

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

export function workspaceLayout(
  input: unknown,
  projects: string[],
  records: WorktreeRecord[] = [],
): WorkspaceLayout {
  if (!input || typeof input !== 'object') throw new Error('工作区布局无效。')
  const layout = input as Record<keyof WorkspaceLayout, unknown>
  if (
    !Array.isArray(layout.workspaces) ||
    layout.workspaces.length > 1000 ||
    !Array.isArray(layout.tabs) ||
    layout.tabs.length > MAX_TERMINALS
  )
    throw new Error('工作区布局大小无效。')
  const text = (inputValue: unknown) => {
    if (typeof inputValue !== 'string' || !inputValue.trim() || inputValue.length > 1024)
      throw new Error('工作区或终端名称无效（上限 1024 字符）。')
    return inputValue.trim()
  }
  const workspaces = layout.workspaces.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('布局包含未打开的项目。')
    const entry = value as Record<string, unknown>
    const projectPath = absolutePath(entry.projectPath)
    if (!projects.includes(projectPath)) throw new Error('布局包含未打开的项目。')
    const workspace = {
      id: terminalId(entry.id),
      projectPath,
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
  const tabs = layout.tabs.map((value: unknown) => {
    const target = workspaceTarget(value)
    const entry = value as Record<string, unknown>
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
  let terminalLayouts: TerminalLayout[] | undefined
  if (layout.terminalLayouts !== undefined) {
    if (!Array.isArray(layout.terminalLayouts) || layout.terminalLayouts.length > MAX_TERMINALS)
      throw new Error('终端拆分布局大小无效。')
    const seen = new Set<string>()
    let count = 0
    const parsePane = (inputValue: unknown, depth: number): TerminalPane => {
      if (
        !inputValue ||
        typeof inputValue !== 'object' ||
        depth > MAX_TERMINALS ||
        ++count > MAX_TERMINALS * 2
      )
        throw new Error('终端拆分布局大小无效。')
      const node = inputValue as Record<string, unknown>
      const id = terminalId(node.id)
      if (seen.has(id)) throw new Error('终端拆分标识重复。')
      seen.add(id)
      if (node.type === 'terminal' && tabs.some((tab) => tab.id === id))
        return { type: 'terminal', id }
      if (
        node.type !== 'split' ||
        tabs.some((tab) => tab.id === id) ||
        (node.direction !== 'horizontal' && node.direction !== 'vertical') ||
        typeof node.ratio !== 'number' ||
        !Number.isFinite(node.ratio) ||
        node.ratio <= 0 ||
        node.ratio >= 1 ||
        !Array.isArray(node.children) ||
        node.children.length !== 2
      )
        throw new Error('终端拆分节点无效。')
      return {
        type: 'split',
        id,
        direction: node.direction,
        ratio: node.ratio,
        children: [parsePane(node.children[0], depth + 1), parsePane(node.children[1], depth + 1)],
      }
    }
    const groupIds = new Set<string>()
    terminalLayouts = layout.terminalLayouts.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('终端拆分标签无效。')
      const entry = value as Record<string, unknown>
      const id = terminalId(entry.id)
      if (groupIds.has(id)) throw new Error('终端拆分标签重复。')
      groupIds.add(id)
      const root = parsePane(entry.root, 0)
      const ids = terminalPaneIds(root)
      const owners = new Set(
        ids.map((candidateId) => tabs.find((tab) => tab.id === candidateId)!.workspaceId),
      )
      if (owners.size !== 1) throw new Error('终端拆分不能跨工作区。')
      const activePaneId = terminalId(entry.activePaneId)
      if (!ids.includes(activePaneId) || (tabs.some((tab) => tab.id === id) && !ids.includes(id)))
        throw new Error('终端拆分标签或焦点无效。')
      return { id, root, activePaneId }
    })
  }
  const selectedWorkspaces: Record<string, string> = {}
  const activeTabs: Record<string, string> = {}
  if (
    !layout.selectedWorkspaces ||
    typeof layout.selectedWorkspaces !== 'object' ||
    !layout.activeTabs ||
    typeof layout.activeTabs !== 'object'
  )
    throw new Error('布局选择状态无效。')
  const selected = layout.selectedWorkspaces as Record<string, unknown>
  const active = layout.activeTabs as Record<string, unknown>
  for (const workspace of workspaces) {
    if (selected[workspace.projectPath] === workspace.id)
      selectedWorkspaces[workspace.projectPath] = workspace.id
    const id = active[workspace.id]
    if (
      typeof id === 'string' &&
      tabs.some((tab) => tab.id === id && tab.workspaceId === workspace.id)
    )
      activeTabs[workspace.id] = id
  }
  if (
    layout.selectedProject !== undefined &&
    (typeof layout.selectedProject !== 'string' ||
      !workspaces.some((entry) => entry.projectPath === layout.selectedProject))
  )
    throw new Error('选中的项目不存在。')
  return {
    workspaces,
    tabs,
    ...(terminalLayouts !== undefined ? { terminalLayouts } : {}),
    selectedProject: layout.selectedProject,
    selectedWorkspaces,
    activeTabs,
  }
}
