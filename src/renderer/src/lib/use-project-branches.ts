import { useEffect, useMemo } from 'react'
import { retainGitBranches, branchViewKey, useGitBranchesStore } from './git-branches-store'
import { useWorkspace, type ProjectWorkspace } from '../store'

export function useProjectBranches(workspaces: ProjectWorkspace[]) {
  const projects = useWorkspace((state) => state.projects)
  const paths = useMemo(
    () => [...new Set([...projects, ...workspaces.map((workspace) => workspace.projectPath)])],
    [projects, workspaces],
  )
  const views = useGitBranchesStore((state) => state.workspaces)
  useEffect(() => {
    const releases = paths.map((projectPath) => retainGitBranches({ projectPath }))
    return () => {
      for (const release of releases) release()
    }
  }, [paths])
  const branches = useMemo(
    () =>
      Object.fromEntries(
        paths.map((projectPath) => [
          projectPath,
          views[branchViewKey({ projectPath })]?.currentBranch ?? null,
        ]),
      ),
    [paths, views],
  )
  useEffect(() => {
    if (!paths.length) return
    let pending = false
    async function refresh() {
      if (pending || document.hidden) return
      pending = true
      try {
        await Promise.all(
          paths.map((path) => useWorkspace.getState().refreshWorktrees(path).catch(console.error)),
        )
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
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [paths])
  return branches
}
