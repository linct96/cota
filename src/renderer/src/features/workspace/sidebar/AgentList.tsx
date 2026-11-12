import { memo } from 'react'
import type { Ref } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useShallow } from 'zustand/react/shallow'
import { currentWorkspace, useWorkspace } from '@/state/workspace'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import { AGENT_STATE_LABELS, agentTabState } from '@/features/agents/lib/agent-status'
import { DotStatus } from '@/components/DotStatus'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SourceControlSection } from '@/features/source-control/components/SourceControlSection'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { folderName } from '@/lib/utils'

export const AgentList = memo(function AgentList({
  homeActive,
  projectBranches,
  open,
  onOpenChange,
  triggerRef,
}: {
  homeActive: boolean
  projectBranches: Record<string, string | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: Ref<HTMLButtonElement>
}) {
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
    <SourceControlSection
      open={open}
      triggerRef={triggerRef}
      onOpenChange={onOpenChange}
      title={
        <>
          <span className="project-agents-title">Agents</span>
          <Badge variant="secondary" className="project-agents-count tabular-nums">
            {agents.length}
          </Badge>
        </>
      }
    >
      <ScrollArea className="project-agents-scroll-area h-full min-w-0">
        <nav
          id="project-agent-list"
          className="project-agents-list flex flex-col gap-1 px-2 py-2"
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
            const origin = [folderName(workspace.projectPath), branch].filter(Boolean).join(' / ')
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
                <span className="project-agent-status shrink-0" title={AGENT_STATE_LABELS[status]}>
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
    </SourceControlSection>
  )
})
