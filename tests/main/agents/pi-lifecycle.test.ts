import { mocks } from '../terminal/terminal.fixture'
import { describe, expect, it } from 'vitest'
import cotaLifecycle from '../../../src/main/agents/hooks/pi-extension'

describe('Pi lifecycle adapter', () => {
  it('reports failure, completion, interruption and unknown outcomes', () => {
    const hooks = new Map<
      string,
      (event: { aborted?: boolean; outcome?: 'completed' | 'aborted' | 'error' }) => void
    >()
    cotaLifecycle({
      on: (name, handler) => {
        hooks.set(name, handler)
      },
    })
    hooks.get('session_start')!({})
    for (const [outcome, expected] of [
      ['error', 'turn-failed'],
      ['completed', 'turn-completed'],
      ['aborted', 'turn-interrupted'],
      [undefined, 'activity-unknown'],
    ] as const) {
      hooks.get('agent_start')!({})
      if (outcome) hooks.get('agent_before_settle')!({ outcome })
      hooks.get('agent_settled')!({ aborted: false })
      expect(JSON.parse(mocks.eventWrite.mock.calls.at(-1)![0]).type).toBe(expected)
    }
  })
})
