import { useEffect, useRef, useState } from 'react'
import type { WorkspaceTarget } from '../../../shared/contracts'

export function useFileWatch(
  target: WorkspaceTarget,
  paths: string[],
  active: boolean,
  onChange: (paths: string[]) => void,
  restart = 0,
): string | undefined {
  const changed = useRef(onChange)
  changed.current = onChange
  const [error, setError] = useState<string>()
  const pathKey = JSON.stringify([...new Set(paths)].sort())
  useEffect(() => {
    setError(undefined)
    const watched: string[] = JSON.parse(pathKey)
    if (!active || !watched.length) return
    // Read again after registration so changes between the initial read and watch are not lost.
    return window.desktop.watchFiles(target, watched, (event) => {
      if (event.kind === 'unavailable') {
        setError(event.error)
        changed.current(watched)
      } else {
        setError(undefined)
        changed.current(event.kind === 'ready' ? watched : event.paths)
      }
    })
  }, [target.projectPath, target.workspaceId, pathKey, active, restart])
  return error
}
