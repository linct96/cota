import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  MAX_TERMINALS,
  type Preferences,
  type RemoveWorkspace,
  type WorkspaceTarget,
  type WorkspaceLayout,
} from '../shared/contracts'

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
  const { shellPath, scrollback } = value as Partial<Preferences>
  if (shellPath !== null) absolutePath(shellPath)
  if (!Number.isInteger(scrollback) || scrollback! < 1000 || scrollback! > 20000) {
    throw new Error('Scrollback 必须是 1,000–20,000 之间的整数。')
  }
  return { shellPath: shellPath as string | null, scrollback: scrollback! }
}

export function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new Error('终端标识无效。')
  }
  return value
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

export function workspaceLayout(value: unknown, projects: string[]): WorkspaceLayout {
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
    return { id: terminalId(entry.id), projectPath: entry.projectPath, name: text(entry.name) }
  })
  if (new Set(workspaces.map((entry) => entry.id)).size !== workspaces.length)
    throw new Error('工作区标识重复。')
  const tabs = layout.tabs.map((entry) => {
    const target = workspaceTarget(entry)
    if (
      !workspaces.some(
        (workspace) =>
          workspace.id === target.workspaceId && workspace.projectPath === target.projectPath,
      )
    )
      throw new Error('终端所属工作区不存在。')
    return { ...target, id: terminalId(entry.id), title: text(entry.title) }
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
