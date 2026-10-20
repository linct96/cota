import * as React from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { AgentStatus } from './AgentStatus'
import { AGENT_STATE_LABELS, agentIndicatorState, agentTabState } from '../lib/agent-status'
import { cn } from '../lib/utils'
import type { TerminalTab as TerminalTabData } from '../store'

export interface TerminalTabProps {
  tab: TerminalTabData
  active: boolean
  closeDisabled?: boolean
  onSelect: () => void
  onClose: () => void
  className?: string
}

export function TerminalTab({
  tab,
  active,
  closeDisabled = false,
  onSelect,
  onClose,
  className,
}: TerminalTabProps) {
  const isAgent = tab.kind === 'agent' || !!tab.provider || !!tab.agent
  const provider = tab.provider || tab.agent?.provider
  const agentState = agentIndicatorState(tab)
  const agentLabel = isAgent ? AGENT_STATE_LABELS[agentTabState(tab)] : undefined

  return (
    <div
      role="tab"
      id={`terminal-tab-${tab.id}`}
      aria-selected={active}
      aria-controls={`terminal-panel-${tab.id}`}
      aria-label={agentLabel ? `${tab.title}，${agentLabel}` : undefined}
      tabIndex={active ? 0 : -1}
      title={agentLabel ? `${tab.projectPath}\n${agentLabel}` : tab.projectPath}
      onClick={onSelect}
      onAuxClick={(event) => {
        if (event.button === 1 && !closeDisabled) {
          event.preventDefault()
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'terminal-tab group/terminal-tab relative inline-flex h-8 w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs/relaxed font-medium transition-colors select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'bg-terminal-tab-inactive text-muted-foreground hover:bg-terminal-tab-inactive-hover hover:text-foreground',
        className,
      )}
    >
      {isAgent ? (
        <AgentIcon provider={provider} size={14} className="terminal-tab-icon size-3.5 shrink-0" />
      ) : (
        <TerminalIcon className="terminal-tab-icon size-3.5 shrink-0" />
      )}

      <span className="terminal-tab-title min-w-0 flex-1 truncate">{tab.title}</span>

      {isAgent
        ? agentState !== 'other' && (
            <span
              className="terminal-tab-agent-status inline-flex size-3.5 shrink-0 items-center justify-center"
              title={agentLabel}
              aria-hidden="true"
            >
              <AgentStatus state={agentState} />
            </span>
          )
        : active && (
            <span
              className="terminal-tab-status size-1.5 shrink-0 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
          )}

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
          'terminal-tab-close-button inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-muted-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-90 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30',
          active
            ? 'opacity-100'
            : 'pointer-events-none opacity-0 group-hover/terminal-tab:pointer-events-auto group-hover/terminal-tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
        )}
      >
        <X className="terminal-tab-close-icon size-3" />
      </button>
    </div>
  )
}
