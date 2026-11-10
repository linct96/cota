import { useEffect, useMemo, useRef } from 'react'
import {
  branchViewKey,
  retainGitBranches,
  useGitBranchesStore,
} from '../../../state/git-branches-store'
import { useWorkspace } from '../../../state/workspace'
import type { ProjectWorkspace } from '../../../state/workspace'

export function useProjectBranches(workspaces: ProjectWorkspace[]) {
  const projects = useWorkspace((state) => state.projects)
  const paths = useMemo(
    () => [...new Set([...projects, ...workspaces.map((workspace) => workspace.projectPath)])],
    [projects, workspaces],
  )
  const views = useGitBranchesStore((state) => state.workspaces)
  const subscriptions = useRef(new Map<string, () => void>())
  useEffect(() => {
    const currentPaths = new Set(paths)
    for (const [path, release] of subscriptions.current) {
      if (!currentPaths.has(path)) {
        release()
        subscriptions.current.delete(path)
      }
    }
    for (const projectPath of paths) {
      if (!subscriptions.current.has(projectPath))
        subscriptions.current.set(projectPath, retainGitBranches({ projectPath }))
    }
  }, [paths])
  useEffect(() => {
    const releases = subscriptions.current
    return () => {
      for (const release of releases.values()) release()
      releases.clear()
    }
  }, [])
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
