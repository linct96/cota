import { useSortable } from '@dnd-kit/react/sortable'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { AgentStatus } from './AgentStatus'
import { AGENT_STATE_LABELS, agentIndicatorState, agentTabState } from '../lib/agent-status'
import { cn } from '../lib/utils'
import type { TerminalTab as TerminalTabData } from '../store'

export interface TerminalTabProps {
  tab: TerminalTabData
  index: number
  active: boolean
  closeDisabled?: boolean
  onSelect: () => void
  onClose: () => void
  className?: string
}

export function TerminalTab({
  tab,
  index,
  active,
  closeDisabled = false,
  onSelect,
  onClose,
  className,
}: TerminalTabProps) {
  const { ref } = useSortable({
    id: tab.id,
    index,
    group: tab.workspaceId,
    disabled: closeDisabled,
    data: { title: tab.title },
  })
  const isAgent = tab.kind === 'agent' || !!tab.provider || !!tab.agent
  const provider = tab.provider || tab.agent?.provider
  const agentState = agentIndicatorState(tab)
  const agentLabel = isAgent ? AGENT_STATE_LABELS[agentTabState(tab)] : undefined

  return (
    <div
      ref={ref}
      role="tab"
      aria-roledescription="可排序终端标签"
      id={`terminal-tab-${tab.id}`}
      aria-selected={active}
      aria-controls={`terminal-panel-${tab.id}`}
      aria-label={agentLabel ? `${tab.title}，${agentLabel}` : undefined}
      tabIndex={active ? 0 : -1}
      title={agentLabel ? `${tab.projectPath}\n${agentLabel}` : tab.projectPath}
      onClick={(event) => {
        if (!event.defaultPrevented) onSelect()
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && !closeDisabled) {
          event.preventDefault()
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || (event.key === ' ' && !event.shiftKey))
        ) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'terminal-tab group/terminal-tab relative inline-flex h-8 w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs/relaxed font-medium transition-colors select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'bg-transparent text-accent-foreground hover:bg-terminal-tab-hover',
        className,
      )}
    >
      {isAgent ? (
        <AgentIcon provider={provider} size={14} className="terminal-tab-icon size-3.5 shrink-0" />
      ) : (
        <TerminalIcon className="terminal-tab-icon size-3.5 shrink-0" />
      )}

      <span className="terminal-tab-title min-w-0 flex-1 truncate">{tab.title}</span>

      <span className="terminal-tab-actions inline-grid size-4 shrink-0 place-items-center">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`关闭 ${tab.title}`}
          disabled={closeDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className={cn(
            'terminal-tab-close-button peer/terminal-tab-close col-start-1 row-start-1 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-90 focus-visible:outline-none disabled:pointer-events-none [&:disabled>svg]:opacity-30',
            !isAgent && active
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover/terminal-tab:pointer-events-auto group-hover/terminal-tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
        >
          <X className="terminal-tab-close-icon size-3" />
        </button>

        {isAgent && agentState !== 'other' && (
          <span
            className="terminal-tab-agent-status pointer-events-none col-start-1 row-start-1 inline-flex size-3.5 items-center justify-center group-hover/terminal-tab:opacity-0 peer-focus-visible/terminal-tab-close:opacity-0"
            title={agentLabel}
            aria-hidden="true"
          >
            <AgentStatus state={agentState} />
          </span>
        )}
      </span>
    </div>
  )
}
