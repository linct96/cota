import { useEffect } from 'react'
import { toast } from 'sonner'
import { useRouter } from '@tanstack/react-router'
import { useWorkspace } from '@/state/workspace'
import { useFileExplorer } from '@/state/file-explorer-store'
import { useSourceControl } from '@/state/source-control-store'
import { useAgentClis } from '@/state/agent-cli-store'

export function useAppRuntime() {
  const router = useRouter()
  const workspaces = useWorkspace((state) => state.workspaces)
  useEffect(() => {
    const stopAgents = window.desktop.onAgent((event) =>
      useWorkspace.getState().receiveAgent(event),
    )
    const stopAgentClis = window.desktop.onAgentClis((cache) =>
      useAgentClis.getState().receive(cache),
    )
    void useAgentClis.getState().load()
    const bootstrapped = useWorkspace.getState().bootstrap()
    const stopAgentFocus = window.desktop.onAgentFocus((target) => {
      void bootstrapped
        .then(async () => {
          const state = useWorkspace.getState()
          const tab = state.tabs.find(
            (entry) => entry.id === target.terminalId && entry.agent?.launchId === target.launchId,
          )
          if (!tab || !(await state.selectProject(tab.projectPath, tab.workspaceId))) return
          useWorkspace.getState().selectTab(tab.id)
          await router.navigate({ to: '/' })
        })
        .catch((error) => {
          const message = '无法定位 Agent 通知目标。'
          console.warn(message, error)
          toast.warning(message, { id: `app-warning:${message}` })
        })
    })
    const stopShortcuts = window.desktop.onShortcut((shortcut) => {
      if (useWorkspace.getState().removingWorkspace || useWorkspace.getState().creatingWorktree)
        return
      if (shortcut === 'settings') {
        void router.navigate({ to: '/settings' })
      } else if (router.state.location.pathname === '/') {
        useWorkspace.getState().shortcut(shortcut)
      }
    })
    return () => {
      stopAgents()
      stopAgentClis()
      stopAgentFocus()
      stopShortcuts()
    }
  }, [router])
  useEffect(() => {
    const current = useSourceControl.getState()
    const ids = new Set(workspaces.map((workspace) => workspace.id))
    if (Object.keys(current.sessions).some((id) => !ids.has(id))) {
      useSourceControl.setState({
        sessions: Object.fromEntries(
          Object.entries(current.sessions).filter(([id]) => ids.has(id)),
        ),
      })
    }
    const explorer = useFileExplorer.getState()
    if (Object.keys(explorer.sessions).some((id) => !ids.has(id))) {
      useFileExplorer.setState({
        sessions: Object.fromEntries(
          Object.entries(explorer.sessions).filter(([id]) => ids.has(id)),
        ),
      })
    }
  }, [workspaces])
}
