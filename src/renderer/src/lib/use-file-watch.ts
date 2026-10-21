import { useEffect, useEffectEvent, useState } from 'react'
import type { WorkspaceTarget } from '../../../shared/contracts'

export function useFileWatch(
  target: WorkspaceTarget,
  paths: string[],
  active: boolean,
  onChange: (paths: string[]) => void,
  restart = 0,
): string | undefined {
  const changed = useEffectEvent(onChange)
  const { projectPath, workspaceId } = target
  const [error, setError] = useState<string>()
  const pathKey = JSON.stringify([...new Set(paths)].sort())
  useEffect(() => {
    // Watch identity changes must clear errors from the previous subscription.
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
    const watched: string[] = JSON.parse(pathKey)
    if (!active || !watched.length) return
    // Read again after registration so changes between the initial read and watch are not lost.
    return window.desktop.watchFiles({ projectPath, workspaceId }, watched, (event) => {
      if (event.kind === 'unavailable') {
        setError(event.error)
        changed(watched)
      } else {
        setError(undefined)
        changed(event.kind === 'ready' ? watched : event.paths)
      }
    })
  }, [projectPath, workspaceId, pathKey, active, restart])
  return error
}
