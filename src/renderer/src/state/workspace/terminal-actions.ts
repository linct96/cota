import { useSourceControl } from '../source-control-store'
import {
  mapTerminalPane,
  removeTerminalPanes,
  terminalPaneIds,
  type TerminalPane,
} from '../../../../shared/terminal-layout'
import {
  MAX_TERMINALS,
  AGENT_PROVIDERS,
  type AgentUpdate,
  unwrap,
} from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { WorkspaceState, TerminalTab } from './types'
import { currentWorkspace, terminalTabId } from './selectors'
import { activeWorkspaceTab, adjacentWorkspaceTab } from './tab-actions'

export const createTerminalActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<
    WorkspaceState,
    | 'runQuickCommand'
    | 'newTerminal'
    | 'splitTerminal'
    | 'resizeTerminalSplit'
    | 'updateTab'
    | 'closeTab'
    | 'closePane'
  >
> = (set, get) => {
  return {
    runQuickCommand(id, workspaceId) {
      const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
      const command = get().preferences.quickCommands.find((entry) => entry.id === id)
      if (
        !workspace ||
        !command ||
        (command.scope.type === 'project' && command.scope.projectPath !== workspace.projectPath)
      )
        throw new Error('快捷命令不存在或不属于当前项目。')
      if (command.mode === 'service') {
        const existing = get().tabs.find(
          (tab) =>
            tab.workspaceId === workspaceId &&
            tab.service?.commandId === id &&
            (tab.status === 'starting' || tab.status === 'running'),
        )
        if (existing) {
          get().selectTab(existing.id)
          return
        }
      }
      if (get().tabs.length >= MAX_TERMINALS)
        throw new Error(`最多保留 ${MAX_TERMINALS} 个终端，请先关闭一个标签。`)
      if (!get().newTerminal(undefined, workspaceId, command))
        throw new Error('当前工作区不可用或正在关闭，请稍后重试。')
      set((state) => ({ recentQuickCommands: { ...state.recentQuickCommands, [workspaceId]: id } }))
    },

    newTerminal(provider, targetId, command) {
      const { tabs, removingWorkspace } = get()
      if (removingWorkspace || (provider && (!Object.hasOwn(AGENT_PROVIDERS, provider) || command)))
        return
      const workspace = targetId
        ? get().workspaces.find((entry) => entry.id === targetId)
        : currentWorkspace(get())
      if (!workspace || get().creatingWorktree) return
      const selectedProject = workspace.projectPath
      const workspaceId = workspace.id
      const worktree =
        workspace.kind === 'git-worktree'
          ? get().worktreeScans[selectedProject]?.entries.find(
              (entry) => entry.record.id === workspace.worktreeId,
            )
          : undefined
      if (workspace.kind === 'git-worktree' && worktree?.status !== 'ready') {
        set({
          worktreeError:
            'Worktree 不可用，请在终端中修复后重新打开“编辑工作区”以刷新检查；不会回退到项目目录。',
        })
        return
      }
      if (tabs.length >= MAX_TERMINALS) {
        console.error(`最多保留 ${MAX_TERMINALS} 个终端，请先关闭一个标签。`)
        return
      }
      useSourceControl.getState().showTerminal(workspaceId)
      const id = crypto.randomUUID()
      const number =
        Math.max(
          0,
          ...tabs
            .filter((tab) => tab.workspaceId === workspaceId && tab.provider === provider)
            .map((tab) => Number(/(?:Terminal | · )(\d+)$/.exec(tab.title)?.[1] || 0)),
        ) + 1
      set((state) => ({
        tabs: [
          ...state.tabs,
          {
            id,
            projectPath: selectedProject,
            workspaceId,
            title:
              command?.name ||
              (provider ? `${AGENT_PROVIDERS[provider].name} · ${number}` : `Terminal ${number}`),
            ...(command ? { startupCommand: command.command } : {}),
            ...(command?.mode === 'service'
              ? { service: { commandId: command.id, name: command.name } }
              : {}),
            cwd: worktree?.record.path || selectedProject,
            ...(provider
              ? { kind: 'agent' as const, provider, launchId: crypto.randomUUID() }
              : {}),
            status: 'starting',
          },
        ],
        selectedProject,
        selectedWorkspaces: { ...state.selectedWorkspaces, [selectedProject]: workspaceId },
        activeTabs: { ...state.activeTabs, [workspaceId]: id },
        focusVersion: state.focusVersion + 1,
      }))
      return id
    },

    splitTerminal(id, direction = 'horizontal') {
      const tab = get().tabs.find((tab) => tab.id === id)
      if (
        !tab ||
        tab.closingStatus ||
        tab.status === 'starting' ||
        get().closingTerminalTabs.includes(terminalTabId(get(), id))
      )
        return
      const next = get().newTerminal(undefined, tab.workspaceId)
      if (!next) return
      const split: TerminalPane = {
        type: 'split',
        id: crypto.randomUUID(),
        direction,
        ratio: 0.5,
        children: [
          { type: 'terminal', id },
          { type: 'terminal', id: next },
        ],
      }
      set((state) => {
        const group = state.terminalLayouts.find((group) =>
          terminalPaneIds(group.root).includes(id),
        )
        return {
          terminalLayouts: group
            ? state.terminalLayouts.map((node) =>
                node === group
                  ? {
                      ...node,
                      root: mapTerminalPane(node.root, id, () => split),
                      activePaneId: next,
                    }
                  : node,
              )
            : [...state.terminalLayouts, { id, root: split, activePaneId: next }],
        }
      })
    },

    resizeTerminalSplit(id, ratio) {
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1 || get().removingWorkspace) return
      set((state) => ({
        terminalLayouts: state.terminalLayouts.map((group) => ({
          ...group,
          root: mapTerminalPane(group.root, id, (node) =>
            node.type === 'split' ? { ...node, ratio } : node,
          ),
        })),
      }))
    },

    updateTab(id, value) {
      const { agent, agentRevision, ...fields } = value
      const rest: Partial<TerminalTab> = agent
        ? fields
        : { ...fields, ...(agentRevision ? { agentRevision } : {}) }
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== id) return tab
          const currentRevision = tab.agentRevision ?? tab.agent?.revision ?? 0
          const incomingRevision = agent?.revision ?? value.agentRevision ?? 0
          if (incomingRevision && currentRevision >= incomingRevision) {
            const { agentRevision: _revision, ...other } = rest
            return { ...tab, ...other, status: tab.status, exitCode: tab.exitCode }
          }
          return {
            ...tab,
            ...rest,
            ...((fields.status && fields.status !== tab.status) ||
            (fields.error && fields.error !== tab.error)
              ? { errorRead: false }
              : {}),
            ...(fields.shellActivity && fields.shellActivity !== tab.shellActivity
              ? {
                  shellUnread:
                    fields.shellActivity === 'idle' &&
                    tab.shellActivity === 'running' &&
                    !tab.agent &&
                    !agent,
                }
              : {}),
            ...(value.agentRevision && !agent ? { agent: undefined } : {}),
          }
        }),
      }))
      if (agent) get().receiveAgent({ type: 'state', session: agent })
    },

    async closeTab(id) {
      if (get().removingWorkspace) return
      if (!id) {
        window.desktop.closeWindow()
        return
      }
      const group = get().terminalLayouts.find(
        (group) => group.id === id || terminalPaneIds(group.root).includes(id),
      )
      if (!group) return get().closePane(id)
      const panes = terminalPaneIds(group.root).map((paneId) =>
        get().tabs.find((tab) => tab.id === paneId),
      )
      if (
        get().closingTerminalTabs.includes(group.id) ||
        panes.some((tab) => !tab || tab.status === 'starting' || tab.closingStatus)
      )
        return
      const live = panes.filter((tab): tab is TerminalTab => !!tab)
      if (live.length === 1) return get().closePane(live[0].id)
      set((state) => ({ closingTerminalTabs: [...state.closingTerminalTabs, group.id] }))
      try {
        for (const tab of live) {
          await get().closePane(tab.id, false)
          if (get().tabs.some((pane) => pane.id === tab.id)) return
        }
        if (get().workspaces.some((workspace) => workspace.id === live[0].workspaceId))
          useSourceControl.getState().rememberClosedTab(live[0].workspaceId, {
            kind: 'terminal-group',
            layout: group,
            panes: live.map((tab) => ({
              id: tab.id,
              title: tab.title,
              provider: tab.kind === 'agent' ? tab.provider : undefined,
            })),
          })
      } finally {
        set((state) => ({
          closingTerminalTabs: state.closingTerminalTabs.filter((id) => id !== group.id),
        }))
      }
    },

    async closePane(id, remember = true) {
      if (get().removingWorkspace) return
      const tab = get().tabs.find((item) => item.id === id)
      if (!tab || tab.status === 'starting' || tab.closingStatus) return
      const group = get().terminalLayouts.find((group) => terminalPaneIds(group.root).includes(id))
      if (remember && group && get().closingTerminalTabs.includes(group.id)) return
      const tabKey = `terminal:${group?.id || id}`
      // Keep the pre-close presentation while exit events continue updating the actual status.
      get().updateTab(id, { closingStatus: tab.status })
      let removed = false
      let recovery = tab
      let position = 0
      let tabPosition = 0
      let removedFocusVersion = 0
      let wasActive = false
      let nextTab: string | undefined
      const agentUpdates: AgentUpdate[] = []
      const remove = () => {
        if (removed) return
        const current = get().tabs.find((item) => item.id === id)
        if (!current) return
        recovery = current
        position = get().tabs.indexOf(current)
        tabPosition = useSourceControl.getState().sessions[tab.workspaceId].tabOrder.indexOf(tabKey)
        wasActive =
          activeWorkspaceTab(get(), tab.workspaceId) === tabKey &&
          get().activeTabs[tab.workspaceId] === id
        const paneIds = group
          ? terminalPaneIds(group.root).filter(
              (paneId) =>
                paneId === id || get().tabs.some((tab) => tab.id === paneId && !tab.closingStatus),
            )
          : []
        const paneIndex = paneIds.indexOf(id)
        const nextPane = paneIds[paneIndex + 1] || paneIds[paneIndex - 1]
        nextTab = nextPane ? tabKey : adjacentWorkspaceTab(tab.workspaceId, tabKey)
        const hasOtherTabs =
          useSourceControl
            .getState()
            .sessions[tab.workspaceId].tabOrder.some((key) => key !== tabKey) || !!nextPane
        removed = true
        set((state) => {
          const tabs = state.tabs.filter((item) => item.id !== id)
          const remaining = tabs.filter((item) => item.workspaceId === tab.workspaceId)
          const activeTabs = { ...state.activeTabs }
          if (activeTabs[tab.workspaceId] === id) {
            if (remaining.length) activeTabs[tab.workspaceId] = remaining[remaining.length - 1].id
            else delete activeTabs[tab.workspaceId]
          }
          return {
            tabs,
            activeTabs,
            selectedProject:
              !hasOtherTabs && currentWorkspace(state)?.id === tab.workspaceId
                ? undefined
                : state.selectedProject,
            lastClosedWorkspaceId:
              !hasOtherTabs && currentWorkspace(state)?.id === tab.workspaceId
                ? tab.workspaceId
                : state.lastClosedWorkspaceId,
            focusVersion: state.focusVersion + 1,
          }
        })
        if (wasActive && nextPane) get().selectTab(nextPane)
        else if (wasActive && nextTab) get().selectWorkspaceTab(tab.workspaceId, nextTab)
        removedFocusVersion = get().focusVersion
      }
      const restore = () => {
        if (!removed) return
        const restoreActive =
          wasActive &&
          get().focusVersion === removedFocusVersion &&
          activeWorkspaceTab(get(), tab.workspaceId) === nextTab
        const hadTab = useSourceControl
          .getState()
          .sessions[tab.workspaceId].tabOrder.includes(tabKey)
        removed = false
        set((state) => {
          if (
            state.tabs.some((item) => item.id === id) ||
            !state.workspaces.some((item) => item.id === tab.workspaceId)
          )
            return state
          const tabs = [...state.tabs]
          tabs.splice(position, 0, { ...recovery, closingStatus: undefined })
          const active = state.activeTabs[tab.workspaceId]
          return {
            tabs,
            activeTabs: tabs.some((item) => item.id === active)
              ? state.activeTabs
              : { ...state.activeTabs, [tab.workspaceId]: id },
            selectedProject:
              !state.selectedProject && state.focusVersion === removedFocusVersion
                ? tab.projectPath
                : state.selectedProject,
            focusVersion: state.focusVersion + 1,
          }
        })
        if (get().tabs.some((item) => item.id === id)) {
          const sourceControl = useSourceControl.getState()
          if (!hadTab) {
            const tabOrder = sourceControl.sessions[tab.workspaceId].tabOrder.filter(
              (key) => key !== tabKey,
            )
            tabOrder.splice(Math.max(0, tabPosition), 0, tabKey)
            sourceControl.update(tab.workspaceId, { tabOrder })
          }
          if (restoreActive) get().selectTab(id)
        }
        // Reuse the normal revision/launch checks for updates received during background teardown.
        for (const event of agentUpdates) get().receiveAgent(event)
      }
      const stopTerminal = window.desktop.onTerminal((event) => {
        if (event.id !== id) return
        // The Host client emits this only after Main's required confirmation has completed.
        if (event.type === 'closing' && event.closing) remove()
        else if (removed && event.type === 'exit')
          recovery = { ...recovery, status: 'exited', exitCode: event.exitCode }
        else if (removed && event.type === 'error')
          recovery = { ...recovery, status: 'error', error: event.error }
      })
      const stopAgents = window.desktop.onAgent((event) => {
        if (
          removed &&
          (event.type === 'disconnected' ||
            (event.type === 'state' ? event.session.terminalId : event.terminalId) === id)
        )
          agentUpdates.push(event)
      })
      try {
        if (!unwrap(await window.desktop.closeTerminal(id))) {
          restore()
          return
        }
        remove()
        set((state) => ({
          terminalLayouts: removeTerminalPanes(state.terminalLayouts, new Set([id])),
        }))
        if (
          remember &&
          get().workspaces.some((workspace) => workspace.id === tab.workspaceId) &&
          (!group ||
            !terminalPaneIds(group.root).some((paneId) =>
              get().tabs.some((tab) => tab.id === paneId),
            ))
        )
          useSourceControl.getState().rememberClosedTab(tab.workspaceId, {
            kind: 'terminal',
            title: tab.title,
            provider: tab.kind === 'agent' ? tab.provider : undefined,
          })
      } catch (error) {
        restore()
        get().updateTab(id, {
          error: `关闭失败：${error instanceof Error ? error.message : String(error)}`,
        })
        console.error(error)
      } finally {
        stopTerminal()
        stopAgents()
        if (get().tabs.some((item) => item.id === id))
          get().updateTab(id, { closingStatus: undefined })
      }
    },
  }
}
