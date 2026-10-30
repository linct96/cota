import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRouter } from '@tanstack/react-router'
import { useWorkspace } from '@/state/workspace'
import { type ProjectWorkspace } from '../../../../../shared/contracts'
import { DotStatus } from '@/components/DotStatus'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import {
  AGENT_STATE_LABELS,
  agentIndicatorState,
  agentTabState,
} from '@/features/agents/lib/agent-status'
import { Button } from '@/components/ui/button'
import { cn, compactPath } from '@/lib/utils'

export const WorkspaceAgentActions = memo(function WorkspaceAgentActions({
  workspace,
  isSelected,
  homeActive,
}: {
  workspace: ProjectWorkspace
  isSelected: boolean
  homeActive: boolean
}) {
  const state = useWorkspace(
    useShallow((state) => ({
      activeId: state.activeTabs[workspace.id],
      ready: state.ready,
      removingWorkspace: state.removingWorkspace,
      selectProject: state.selectProject,
      selectTab: state.selectTab,
    })),
  )
  const router = useRouter()
  const path = workspace.projectPath
  const workspaceAgents = useWorkspace(
    useShallow((state) =>
      state.tabs.filter(
        (tab) =>
          tab.workspaceId === workspace.id && (tab.kind === 'agent' || tab.provider || tab.agent),
      ),
    ),
  )
  if (!workspaceAgents.length) return null
  return (
    <fieldset
      className="project-item-agents ml-7.5 flex min-w-0 flex-wrap gap-1 border-0 p-0 pr-2 pb-2"
      aria-label={`${workspace.name} Agent 列表`}
    >
      {workspaceAgents.map((tab) => {
        const agentState = agentTabState(tab)
        const agentActive = isSelected && homeActive && state.activeId === tab.id
        const label = `${compactPath(tab.cwd || tab.projectPath)} · ${AGENT_STATE_LABELS[agentState]}`
        return (
          <Button
            key={tab.id}
            variant="project"
            size="icon"
            className="project-item-agent-button relative text-inherit"
            data-active={agentActive}
            aria-pressed={agentActive}
            aria-label={`定位到 ${label}`}
            disabled={!state.ready || !!state.removingWorkspace}
            onClick={async () => {
              if (isSelected || (await state.selectProject(path, workspace.id))) {
                state.selectTab(tab.id)
                void router.navigate({ to: '/' })
              }
            }}
          >
            <span
              className="project-item-agent-provider relative inline-flex size-3.5 shrink-0"
              aria-hidden="true"
            >
              <AgentIcon
                provider={tab.provider || tab.agent?.provider}
                size={14}
                className="project-item-agent-provider-icon size-3.5 shrink-0"
              />
              {agentIndicatorState(tab) !== 'other' && (
                <span
                  className={cn(
                    'project-item-agent-status pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex rounded-full p-px [&_.dot-status]:size-2',
                    agentActive ? 'bg-background' : 'bg-muted',
                  )}
                >
                  <DotStatus state={agentState} />
                </span>
              )}
            </span>
          </Button>
        )
      })}
    </fieldset>
  )
})
