import { describe, expect, it } from 'vitest'
import { normalizeHook } from '../../../src/main/agents/hooks/normalize'

describe('Agent Hook event normalization', () => {
  it('normalizes native Hook events without forwarding commands or private payloads', () => {
    const emptyInventory = { agentIds: [], otherCount: 0 }
    expect(
      normalizeHook('claude', { hook_event_name: 'Stop', prompt_id: 'p', response: 'secret' }),
    ).toEqual({ type: 'turn-ended', turnId: 'p' })
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Notification',
        prompt_id: 'p',
        notification_type: 'idle_prompt',
      }),
    ).toBeUndefined()
    expect(
      normalizeHook('claude', { hook_event_name: 'Stop', agent_id: 'subagent', prompt_id: 'p' }),
    ).toEqual({ type: 'turn-ended', turnId: 'p', agentId: 'subagent' })
    expect(normalizeHook('claude', { hook_event_name: 'Stop' })).toEqual({
      type: 'integration-unavailable',
    })
    expect(
      normalizeHook('codex', {
        hook_event_name: 'PermissionRequest',
        turn_id: 't',
        tool_input: 'secret',
      }),
    ).toEqual({ type: 'attention-required', turnId: 't', waitingFor: 'permission' })
    expect(
      normalizeHook('codex', { hook_event_name: 'Stop', prompt_id: 'not-a-native-turn' }),
    ).toEqual({ type: 'integration-unavailable' })
    for (const [provider, tool] of [
      ['claude', 'AskUserQuestion'],
      ['codex', 'request_user_input'],
    ] as const) {
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
    }
    expect(
      normalizeHook('claude', { hook_event_name: 'SubagentStart', agent_id: 'child' }),
    ).toEqual({ type: 'turn-started', agentId: 'child' })
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
    expect(
      normalizeHook('claude', {
        hook_event_name: 'SubagentStop',
        agent_id: 'child-id',
        prompt_id: 'p',
        background_tasks: [{ id: 'child-id', type: 'subagent', status: 'running' }],
      }),
    ).toEqual({ type: 'turn-ended', turnId: 'p', agentId: 'child-id' })
    expect(
      normalizeHook('claude', {
        hook_event_name: 'StopFailure',
        prompt_id: 'p',
        background_tasks: [],
      }),
    ).toEqual({ type: 'turn-failed', turnId: 'p', backgroundTasks: emptyInventory })
    for (const task of [
      { id: 'team', type: 'teammate', status: 'running' },
      { id: 'bad/id', type: 'subagent', status: 'running' },
    ])
      expect(
        normalizeHook('claude', {
          hook_event_name: 'Stop',
          prompt_id: 'p',
          background_tasks: [task],
        }),
      ).toEqual({ type: 'integration-unavailable' })
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
    expect(normalizeHook('claude', { hook_event_name: 'StopFailure', prompt_id: 'p' })).toEqual({
      type: 'turn-failed',
      turnId: 'p',
    })
    expect(normalizeHook('codex', { hook_event_name: 'Interrupt', turn_id: 't' })).toEqual({
      type: 'turn-interrupted',
      turnId: 't',
    })
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Notification',
        notification_type: 'idle_prompt',
      }),
    ).toBeUndefined()
    expect(
      normalizeHook('claude', {
        hook_event_name: 'Stop',
        prompt_id: 'p',
        background_tasks: [{ status: 'new-unknown-status' }],
      }),
    ).toEqual({ type: 'integration-unavailable' })
    expect(
      normalizeHook('claude', {
        hook_event_name: 'PostToolUseFailure',
        prompt_id: 'p',
        tool_use_id: 'request',
      }),
    ).toEqual({ type: 'turn-active', turnId: 'p', requestId: 'request', requestDone: true })
  })
})
