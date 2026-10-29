import { useEffect, useEffectEvent } from 'react'
import type { WorkspaceTarget } from '../../../shared/contracts'

export function useSourceControlWatch(
  target: WorkspaceTarget,
  active: boolean,
  refresh: () => void,
) {
  const reloadCurrent = useEffectEvent(refresh)
  const { projectPath, workspaceId } = target
  useEffect(() => {
    if (!active) return
    let stopWatch: (() => void) | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let disposed = false
    const reload = () => {
      if (!disposed && !document.hidden) reloadCurrent()
    }
    const stop = () => {
      generation++
      stopWatch?.()
      stopWatch = undefined
      clearInterval(poll)
      clearTimeout(retry)
    }
    const connect = () => {
      stop()
      if (disposed || document.hidden) return
      const token = generation
      poll = setInterval(reload, 5000)
      stopWatch = window.desktop.watchGit({ projectPath, workspaceId }, (event) => {
        if (disposed || token !== generation) return
        if (event === 'change') {
          reload()
          return
        }
        clearInterval(poll)
        clearTimeout(retry)
        if (event === 'ready') poll = setInterval(connect, 60_000)
        else {
          poll = setInterval(reload, 5000)
          retry = setTimeout(connect, 60_000)
        }
        reload()
      })
    }
    connect()
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', connect)
    return () => {
      disposed = true
      stop()
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', connect)
    }
  }, [active, projectPath, workspaceId])
}
