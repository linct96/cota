import { useEffect, useMemo, useState } from 'react'
import type { ProjectWorkspace } from '../store'

export function useProjectBranches(workspaces: ProjectWorkspace[]) {
  const paths = useMemo(
    () => [...new Set(workspaces.map((workspace) => workspace.projectPath))],
    [workspaces],
  )
  const [branches, setBranches] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!paths.length) return
    let disposed = false
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const entries = await Promise.all(
          paths.map(async (path) => {
            try {
              const result = await window.desktop.projectBranch(path)
              return [path, result.ok ? result.value : null] as const
            } catch {
              return [path, null] as const
            }
          }),
        )
        if (!disposed) setBranches(Object.fromEntries(entries))
      } finally {
        pending = false
      }
    }
    void refresh()
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5000)
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [paths])

  return branches
}
