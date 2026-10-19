import { useEffect, useMemo, useState } from 'react'
import { useWorkspace, type ProjectWorkspace } from '../store'

export function useProjectBranches(workspaces: ProjectWorkspace[]) {
  const projects = useWorkspace((state) => state.projects)
  const records = useWorkspace((state) => state.worktreeRecords)
  const paths = useMemo(
    () => [
      ...new Set([
        ...projects,
        ...records.map((record) => record.projectPath),
        ...workspaces.map((workspace) => workspace.projectPath),
      ]),
    ],
    [projects, records, workspaces],
  )
  const [branches, setBranches] = useState<Record<string, string | null>>({})
  useEffect(() => {
    if (!paths.length) return
    let disposed = false
    let pending = false
    async function refresh() {
      if (pending || document.hidden) return
      pending = true
      try {
        const entries = await Promise.all(
          paths.map(async (path) => {
            await useWorkspace.getState().refreshWorktrees(path).catch(console.error)
            try {
              const result = await window.desktop.projectBranch(path)
              return result.ok ? ([path, result.value] as const) : undefined
            } catch {
              return undefined
            }
          }),
        )
        if (!disposed)
          setBranches((previous) => ({
            ...previous,
            ...Object.fromEntries(entries.filter((entry) => entry !== undefined)),
          }))
      } finally {
        pending = false
      }
    }
    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [paths])
  return branches
}
