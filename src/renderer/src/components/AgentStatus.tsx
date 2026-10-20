import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch'
import { PauseCircleIcon } from '@phosphor-icons/react/dist/csr/PauseCircle'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle'
import type { AgentDisplayState } from '../lib/agent-status'
import { cn } from '../lib/utils'

const ICONS = {
  error: XCircleIcon,
  working: CircleNotchIcon,
  'needs-input': WarningCircleIcon,
  completed: CheckCircleIcon,
  succeeded: CheckCircleIcon,
  failed: XCircleIcon,
  interrupted: PauseCircleIcon,
}

export function AgentStatus({ state }: { state: AgentDisplayState }) {
  if (state === 'other') return null
  const Icon = ICONS[state]
  const isLoading = state === 'working'
  return (
    <Icon
      weight={isLoading ? 'bold' : 'fill'}
      className={cn(
        'agent-status agent-status-icon size-3.5 shrink-0',
        isLoading && 'motion-safe:animate-spin',
      )}
      data-state={state}
      aria-hidden="true"
    />
  )
}
