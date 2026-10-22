import { PauseCircleIcon } from '@phosphor-icons/react/dist/csr/PauseCircle'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle'
import type { AgentDisplayState } from '../lib/agent-status'

const ICONS = {
  error: XCircleIcon,
  'needs-input': WarningCircleIcon,
  failed: XCircleIcon,
  interrupted: PauseCircleIcon,
}

export function DotStatus({ state }: { state: AgentDisplayState }) {
  if (state === 'other') return null
  if (state === 'working') {
    return (
      <span
        className="dot-status inline-flex size-3.5 shrink-0 items-center justify-center"
        data-state={state}
        aria-hidden="true"
      >
        <span className="dot-status-breath size-1.5" />
      </span>
    )
  }
  if (state === 'completed' || state === 'succeeded') {
    return (
      <span
        className="dot-status inline-flex size-3.5 shrink-0 items-center justify-center"
        data-state={state}
        aria-hidden="true"
      >
        <span className="dot-status-success size-1.5" />
      </span>
    )
  }
  const Icon = ICONS[state]
  return (
    <Icon
      weight="fill"
      className="dot-status dot-status-icon size-3.5 shrink-0"
      data-state={state}
      aria-hidden="true"
    />
  )
}
