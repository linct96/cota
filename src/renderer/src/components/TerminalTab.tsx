import { useSortable } from '@dnd-kit/react/sortable'
import { Terminal as TerminalIcon } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { DotStatus } from './DotStatus'
import { agentIndicatorState, AGENT_STATE_LABELS } from '../lib/agent-status'
import { cn, shortenPath } from '../lib/utils'
import { WorkspaceTab } from './WorkspaceTab'
import type { TerminalTab as TerminalTabData } from '../store'

export interface TerminalTabProps {
  tab: TerminalTabData
  indicatorTab?: TerminalTabData
  index: number
  active: boolean
  closeDisabled?: boolean
  onSelect: () => void
  onClose: () => void
  className?: string
}

export function TerminalTab({
  tab,
  indicatorTab = tab,
  index,
  active,
  closeDisabled = false,
  onSelect,
  onClose,
  className,
}: TerminalTabProps) {
  const path = tab.cwd || tab.projectPath
  const title = shortenPath(path)
  const { ref } = useSortable({
    id: tab.id,
    index,
    group: tab.workspaceId,
    disabled: closeDisabled,
    data: { title },
  })
  const isAgent = indicatorTab.kind === 'agent' || !!indicatorTab.provider || !!indicatorTab.agent
  const provider = indicatorTab.provider || indicatorTab.agent?.provider
  const agentState = isAgent && !tab.closingStatus ? agentIndicatorState(indicatorTab) : 'other'

  return (
    <WorkspaceTab
      ref={ref}
      aria-roledescription="可排序终端标签"
      id={`terminal-tab-${tab.id}`}
      aria-controls={`terminal-panel-${tab.id}`}
      aria-label={agentState === 'other' ? title : `${title}，${AGENT_STATE_LABELS[agentState]}`}
      title={path}
      label={title}
      active={active}
      closeDisabled={closeDisabled}
      onSelect={onSelect}
      onClose={onClose}
      className={cn('terminal-tab', className)}
      icon={
        isAgent ? (
          <span className="terminal-tab-agent-icon relative inline-flex size-3.5 shrink-0">
            <AgentIcon
              provider={provider}
              size={14}
              className="terminal-tab-icon size-3.5 shrink-0"
            />
            {agentState !== 'other' && (
              <span className="terminal-tab-agent-status pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex rounded-full p-px [&_.dot-status]:size-2">
                <DotStatus state={agentState} />
              </span>
            )}
          </span>
        ) : (
          <TerminalIcon className="terminal-tab-icon size-3.5 shrink-0" />
        )
      }
    />
  )
}
