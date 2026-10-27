import type { TerminalDisplayState } from '../lib/agent-status'

function synchronizeBreathing(element: HTMLSpanElement | null) {
  if (!element) return
  // Join the document timeline instead of restarting the pulse on mount or CSS animation restart.
  for (const animation of element.getAnimations()) {
    if (animation.startTime !== 0) animation.startTime = 0
  }
}

export function DotStatus({ state }: { state: TerminalDisplayState | 'empty' | 'idle' }) {
  if (state === 'other') return null
  if (state === 'working') {
    return (
      <span
        className="dot-status inline-flex size-3.5 shrink-0 items-center justify-center"
        data-state={state}
        aria-hidden="true"
      >
        <span
          ref={synchronizeBreathing}
          onAnimationStart={(event) => synchronizeBreathing(event.currentTarget)}
          className="dot-status-breath size-1.5"
        />
      </span>
    )
  }
  return (
    <span
      className="dot-status inline-flex size-3.5 shrink-0 items-center justify-center"
      data-state={state}
      aria-hidden="true"
    >
      <span className="dot-status-dot size-1.5" />
    </span>
  )
}
