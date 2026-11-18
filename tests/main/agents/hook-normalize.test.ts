import { describe, expect, it } from 'vitest'
import { normalizeHook } from '../../../src/main/agents/hooks/normalize'

describe('Agent Hook event normalization', () => {
  it('reads Antigravity lifecycle events without forwarding private payloads', () => {
    const common = { conversationId: 'conversation', lastUserInput: 'private prompt' }
    expect(normalizeHook('agy', common, 'SessionStart')).toEqual({ type: 'session-started' })
    expect(normalizeHook('agy', common, 'PreInvocation')).toEqual({ type: 'turn-started' })
    expect(normalizeHook('agy', { ...common, fullyIdle: false }, 'Stop')).toBeUndefined()
    expect(
      normalizeHook(
        'agy',
        { ...common, fullyIdle: true, terminationReason: 'NO_TOOL_CALL' },
        'Stop',
      ),
    ).toEqual({ type: 'turn-ended' })
    expect(
      normalizeHook('agy', { ...common, fullyIdle: true, terminationReason: 'ERROR' }, 'Stop'),
    ).toEqual({ type: 'turn-failed' })
    expect(normalizeHook('agy', common, 'PermissionRequest')).toBeUndefined()
  })
  it('omits a private Claude response from a turn-ending event', () => {
    expect(
      normalizeHook('claude', { hook_event_name: 'Stop', prompt_id: 'p', response: 'secret' }),
    ).toEqual({ type: 'turn-ended', turnId: 'p' })
  })

  it('omits private Codex tool input from a permission request', () => {
    expect(
      normalizeHook('codex', {
        hook_event_name: 'PermissionRequest',
        turn_id: 't',
        tool_input: 'secret',
      }),
    ).toEqual({ type: 'attention-required', turnId: 't', waitingFor: 'permission' })
  })

  it.each([
    [
      'with a prompt',
      { hook_event_name: 'Notification', prompt_id: 'p', notification_type: 'idle_prompt' },
    ],
    ['without a prompt', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }],
  ])('ignores an idle notification %s', (_label, input) => {
    expect(normalizeHook('claude', input)).toBeUndefined()
  })

  it.each([
    ['Claude Stop without a prompt', 'claude', { hook_event_name: 'Stop' }],
    [
      'Codex Stop with a non-native prompt',
      'codex',
      { hook_event_name: 'Stop', prompt_id: 'not-a-native-turn' },
    ],
  ] as const)('disables integration for %s', (_label, provider, input) => {
    expect(normalizeHook(provider, input)).toEqual({ type: 'integration-unavailable' })
  })

  it.each([
    ['claude', 'AskUserQuestion'],
    ['codex', 'request_user_input'],
  ] as const)('normalizes %s questions without forwarding tool input', (provider, tool) => {
    expect(
      normalizeHook(provider, {
        hook_event_name: 'PreToolUse',
        prompt_id: 'p',
        turn_id: 'p',
        tool_name: tool,
        tool_use_id: 'request',
        tool_input: { secret: 'never forward' },
      }),
    ).toEqual({
      type: 'attention-required',
      turnId: 'p',
      toolName: tool,
      requestId: 'request',
      waitingFor: 'question',
    })
  })

  it.each([
    [
      'Stop',
      { hook_event_name: 'Stop', agent_id: 'subagent', prompt_id: 'p' },
      { type: 'turn-ended', turnId: 'p', agentId: 'subagent' },
    ],
    [
      'SubagentStart',
      { hook_event_name: 'SubagentStart', agent_id: 'child' },
      { type: 'turn-started', agentId: 'child' },
    ],
    [
      'SubagentStop',
      {
        hook_event_name: 'SubagentStop',
        agent_id: 'child-id',
        prompt_id: 'p',
        background_tasks: [{ id: 'child-id', type: 'subagent', status: 'running' }],
      },
      { type: 'turn-ended', turnId: 'p', agentId: 'child-id' },
    ],
  ])('normalizes child %s without forwarding its inventory', (_label, input, expected) => {
    expect(normalizeHook('claude', input)).toEqual(expected)
  })

  it('deduplicates a lead inventory without forwarding commands or descriptions', () => {
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Stop',
        prompt_id: 'p',
        background_tasks: [
          { id: 'shell-id', type: 'shell', status: 'running', command: 'secret' },
          { id: 'shell-id', type: 'shell', status: 'running' },
          { id: 'child-id', type: 'subagent', status: 'running', description: 'secret' },
          { id: 'child-id', type: 'subagent', status: 'running' },
          { status: 'completed' },
        ],
      }),
    ).toEqual({
      type: 'turn-ended',
      turnId: 'p',
      backgroundTasks: { agentIds: ['child-id'], otherCount: 1 },
    })
  })

  it.each([
    [
      'with an empty inventory',
      { hook_event_name: 'StopFailure', prompt_id: 'p', background_tasks: [] },
      { type: 'turn-failed', turnId: 'p', backgroundTasks: { agentIds: [], otherCount: 0 } },
    ],
    [
      'without an inventory',
      { hook_event_name: 'StopFailure', prompt_id: 'p' },
      { type: 'turn-failed', turnId: 'p' },
    ],
  ])('normalizes a failed turn %s', (_label, input, expected) => {
    expect(normalizeHook('claude', input)).toEqual(expected)
  })

  it.each([
    ['unsupported task type', { id: 'team', type: 'teammate', status: 'running' }],
    ['invalid child ID', { id: 'bad/id', type: 'subagent', status: 'running' }],
    ['unknown task status', { status: 'new-unknown-status' }],
  ])('disables integration for an inventory with %s', (_label, task) => {
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Stop',
        prompt_id: 'p',
        background_tasks: [task],
      }),
    ).toEqual({ type: 'integration-unavailable' })
  })

  it('rejects an inventory that cannot fit in the authenticated event frame', () => {
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Stop',
        prompt_id: 'p',
        background_tasks: Array.from({ length: 40 }, (_, index) => ({
          id: `a${index}${'x'.repeat(100)}`,
          type: 'subagent',
          status: 'running',
        })),
      }),
    ).toEqual({ type: 'integration-unavailable' })
  })

  it('normalizes a Codex interruption', () => {
    expect(normalizeHook('codex', { hook_event_name: 'Interrupt', turn_id: 't' })).toEqual({
      type: 'turn-interrupted',
      turnId: 't',
    })
  })

  it('marks a failed tool request as done', () => {
    expect(
      normalizeHook('claude', {
        hook_event_name: 'PostToolUseFailure',
        prompt_id: 'p',
        tool_use_id: 'request',
      }),
    ).toEqual({ type: 'turn-active', turnId: 'p', requestId: 'request', requestDone: true })
  })
})
