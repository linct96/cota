import { useSortable } from '@dnd-kit/react/sortable'
import { Terminal as TerminalIcon } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { DotStatus } from './DotStatus'
import { terminalIndicatorState, TERMINAL_STATE_LABELS } from '../lib/agent-status'
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
  const indicatorState = !tab.closingStatus ? terminalIndicatorState(indicatorTab) : 'other'

  return (
    <WorkspaceTab
      ref={ref}
      aria-roledescription="可排序终端标签"
      id={`terminal-tab-${tab.id}`}
      aria-controls={`terminal-panel-${tab.id}`}
      aria-label={
        indicatorState === 'other' ? title : `${title}，${TERMINAL_STATE_LABELS[indicatorState]}`
      }
      title={path}
      label={title}
      active={active}
      closeDisabled={closeDisabled}
      onSelect={onSelect}
      onClose={onClose}
      className={cn('terminal-tab', className)}
      icon={
        <span className="terminal-tab-status-icon relative inline-flex size-3.5 shrink-0">
          {isAgent ? (
            <AgentIcon
              provider={provider}
              size={14}
              className="terminal-tab-icon size-3.5 shrink-0"
            />
          ) : (
            <TerminalIcon className="terminal-tab-icon size-3.5 shrink-0" />
          )}
          {indicatorState !== 'other' && (
            <span className="terminal-tab-status pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex rounded-full p-px [&_.dot-status]:size-2">
              <DotStatus state={indicatorState} />
            </span>
          )}
        </span>
      }
    />
  )
}
