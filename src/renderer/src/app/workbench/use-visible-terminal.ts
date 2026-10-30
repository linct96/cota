import { useEffect } from 'react'
import { useWorkspace } from '@/state/workspace'

export function useVisibleTerminal(
  activeId: string | undefined,
  activeNavigation: string,
  showingDiff: boolean,
) {
  useEffect(() => {
    const updateVisible = () =>
      useWorkspace
        .getState()
        .setVisibleTerminal(
          activeNavigation === 'home' && !showingDiff && !document.hidden && document.hasFocus()
            ? activeId
            : undefined,
        )
    updateVisible()
    window.addEventListener('focus', updateVisible)
    window.addEventListener('blur', updateVisible)
    document.addEventListener('visibilitychange', updateVisible)
    return () => {
      window.removeEventListener('focus', updateVisible)
      window.removeEventListener('blur', updateVisible)
      document.removeEventListener('visibilitychange', updateVisible)
      useWorkspace.getState().setVisibleTerminal(undefined)
    }
  }, [activeId, activeNavigation, showingDiff])
}
