import { memo, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { usePanelRef } from 'react-resizable-panels'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { currentWorkspace, useWorkspace } from '@/state/workspace'
import { useLeftPanel } from '@/state/left-panel-store'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import { AGENT_STATE_LABELS, agentTabState } from '@/features/agents/lib/agent-status'
import { DotStatus } from '@/components/DotStatus'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { folderName } from '@/lib/utils'

export const AgentList = memo(function AgentList({
  homeActive,
  projectBranches,
}: {
  homeActive: boolean
  projectBranches: Record<string, string | null>
}) {
  const open = useLeftPanel((state) => state.agentsOpen)
  const panelRef = usePanelRef()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const expandedSize = useRef(240)
  const router = useRouter()
  const state = useWorkspace(
    useShallow((currentState) => ({
      projects: currentState.projects,
      workspaces: currentState.workspaces,
      worktreeScans: currentState.worktreeScans,
      tabs: currentState.tabs,
      workspaceId: currentWorkspace(currentState)?.id,
      activeTabs: currentState.activeTabs,
      ready: currentState.ready,
      removingWorkspace: currentState.removingWorkspace,
      selectProject: currentState.selectProject,
      selectTab: currentState.selectTab,
    })),
  )
  const agents = state.projects.flatMap((projectPath) =>
    state.workspaces
      .filter((workspace) => workspace.projectPath === projectPath)
      .flatMap((workspace) =>
        state.tabs
          .filter(
            (tab) =>
              tab.workspaceId === workspace.id &&
              (tab.kind === 'agent' || tab.provider || tab.agent),
          )
          .map((tab) => ({ tab, workspace })),
      ),
  )

  return (
    <>
      <ResizableHandle
        className="project-agents-resize-handle"
        aria-label="调整项目与 Agent 列表高度"
      />
      <ResizablePanel
        id="project-agents"
        panelRef={panelRef}
        defaultSize={36}
        minSize={144}
        maxSize="70%"
        collapsible
        collapsedSize={36}
        groupResizeBehavior="preserve-pixel-size"
        className="project-agents-panel flex min-h-0 min-w-0 flex-col"
        onResize={(size) => {
          const agentsOpen = size.inPixels > 36.5
          if (agentsOpen) expandedSize.current = size.inPixels
          if (useLeftPanel.getState().agentsOpen === agentsOpen) return
          if (!agentsOpen && document.activeElement?.closest('#project-agent-list')) {
            triggerRef.current?.focus()
          }
          useLeftPanel.setState({ agentsOpen })
        }}
      >
        <Collapsible
          open={open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) panelRef.current?.resize(expandedSize.current)
            else panelRef.current?.collapse()
          }}
          className="project-agents-section flex h-full min-h-0 flex-col"
        >
          <h2 className="project-agents-heading shrink-0 px-2 py-1">
            <CollapsibleTrigger
              render={<Button ref={triggerRef} variant="project" />}
              className="project-agents-toggle w-full justify-start gap-2"
              aria-label={`${open ? '收起' : '展开'} Agent 列表，${agents.length} 个`}
            >
              {open ? (
                <ChevronDown className="project-agents-chevron" aria-hidden="true" />
              ) : (
                <ChevronRight className="project-agents-chevron" aria-hidden="true" />
              )}
              <span className="project-agents-title">Agents</span>
              <span className="project-agents-count ml-auto tabular-nums">{agents.length}</span>
            </CollapsibleTrigger>
          </h2>
          <CollapsibleContent
            id="project-agent-list"
            className="project-agents-content min-h-0 flex-1"
          >
            <ScrollArea className="project-agents-scroll-area h-full min-w-0">
              <nav
                className="project-agents-list flex flex-col gap-1 px-2 pb-2"
                aria-label="Agent 列表"
              >
                {agents.map(({ tab, workspace }) => {
                  const status = agentTabState(tab)
                  const selected = state.workspaceId === workspace.id
                  const active = selected && homeActive && state.activeTabs[workspace.id] === tab.id
                  const worktree = state.worktreeScans[workspace.projectPath]?.entries.find(
                    (entry) => entry.record.id === workspace.worktreeId,
                  )?.worktree
                  const branch =
                    workspace.kind === 'local'
                      ? projectBranches[workspace.projectPath]
                      : worktree?.branch ||
                        (worktree?.head ? `detached ${worktree.head.slice(0, 8)}` : undefined)
                  const origin = [folderName(workspace.projectPath), branch]
                    .filter(Boolean)
                    .join(' / ')
                  const label = `${tab.title}，${AGENT_STATE_LABELS[status]}，${origin}`
                  return (
                    <Button
                      key={tab.id}
                      variant="project"
                      className="project-agent-row h-auto min-w-0 justify-start gap-2 px-2 py-2 text-left"
                      data-active={active}
                      aria-current={active ? 'true' : undefined}
                      aria-label={`定位到 ${label}`}
                      title={[
                        workspace.projectPath,
                        workspace.name,
                        branch,
                        tab.title,
                        AGENT_STATE_LABELS[status],
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      disabled={!state.ready || !!state.removingWorkspace}
                      onClick={async () => {
                        if (
                          selected ||
                          (await state.selectProject(workspace.projectPath, workspace.id))
                        ) {
                          state.selectTab(tab.id)
                          void router.navigate({ to: '/' })
                        }
                      }}
                    >
                      <AgentIcon
                        provider={tab.provider || tab.agent?.provider}
                        size={18}
                        className="project-agent-provider size-4.5 shrink-0"
                      />
                      <span className="project-agent-details flex min-w-0 flex-1 flex-col">
                        <span className="project-agent-title truncate [unicode-bidi:plaintext]">
                          {tab.title}
                        </span>
                        <span className="project-agent-origin truncate font-normal text-app-muted-foreground [unicode-bidi:plaintext]">
                          {origin}
                        </span>
                      </span>
                      <span
                        className="project-agent-status shrink-0"
                        title={AGENT_STATE_LABELS[status]}
                      >
                        <DotStatus state={status === 'other' ? 'idle' : status} />
                      </span>
                    </Button>
                  )
                })}
                {!agents.length && (
                  <Empty className="project-agents-empty flex-none px-2 py-6">
                    <EmptyHeader className="project-agents-empty-header">
                      <EmptyTitle className="project-agents-empty-title">暂无 Agent</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
              </nav>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      </ResizablePanel>
    </>
  )
})
