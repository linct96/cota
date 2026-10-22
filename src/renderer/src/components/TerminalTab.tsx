import { useSortable } from '@dnd-kit/react/sortable'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { DotStatus } from './DotStatus'
import { buttonVariants } from './ui/button'
import { agentIndicatorState, AGENT_STATE_LABELS } from '../lib/agent-status'
import { cn, shortenPath } from '../lib/utils'
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
  const path = tab.cwd || tab.projectPath
  const title = shortenPath(path)
  const { ref } = useSortable({
    id: tab.id,
    index,
    group: tab.workspaceId,
    disabled: closeDisabled,
    data: { title },
  })
  const isAgent = tab.kind === 'agent' || !!tab.provider || !!tab.agent
  const provider = tab.provider || tab.agent?.provider
  const agentState = isAgent ? agentIndicatorState(tab) : 'other'

  return (
    <div
      ref={ref}
      role="tab"
      aria-roledescription="可排序终端标签"
      id={`terminal-tab-${tab.id}`}
      aria-selected={active}
      aria-controls={`terminal-panel-${tab.id}`}
      aria-label={agentState === 'other' ? title : `${title}，${AGENT_STATE_LABELS[agentState]}`}
      tabIndex={active ? 0 : -1}
      title={path}
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
        buttonVariants({ variant: 'secondary', size: 'lg' }),
        'terminal-tab group/terminal-tab relative w-auto max-w-40 cursor-pointer gap-1.5 border-0 bg-muted text-foreground transition-colors hover:bg-muted-hover motion-reduce:transition-none',
        active && 'shadow-xs',
        className,
      )}
    >
      {isAgent ? (
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
      )}

      <span className="terminal-tab-title min-w-0 flex-1 truncate">{title}</span>

      <span className="terminal-tab-actions pointer-events-none absolute inset-y-0 right-0 flex w-12 max-w-[calc(100%-1.5rem)] items-center justify-end rounded-r-md pr-2.5 opacity-0 transition-opacity group-focus-visible/terminal-tab:opacity-100 group-hover/terminal-tab:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`关闭 ${title}`}
          disabled={closeDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="terminal-tab-close-button pointer-events-none relative inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-app-muted-foreground/80 transition-colors group-focus-visible/terminal-tab:pointer-events-auto group-hover/terminal-tab:pointer-events-auto focus-visible:pointer-events-auto hover:bg-foreground/10 hover:text-foreground active:scale-90 focus-visible:outline-none disabled:pointer-events-none [&:disabled>svg]:opacity-30"
        >
          <X className="terminal-tab-close-icon size-3" />
        </button>
      </span>
    </div>
  )
}
