import type { AgentLifecycleEvent, AgentProvider } from '../../shared/contracts'

type HookEvent = Pick<
  AgentLifecycleEvent,
  | 'type'
  | 'turnId'
  | 'agentId'
  | 'requestId'
  | 'toolName'
  | 'requestDone'
  | 'waitingFor'
  | 'backgroundTasks'
>
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)

export function normalizeHook(provider: AgentProvider, input: unknown): HookEvent | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const data = input as Record<string, unknown>
  const name = data.hook_event_name
  if (
    ![
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PermissionRequest',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'Interrupt',
      'Notification',
      'SubagentStart',
      'SubagentStop',
    ].includes(String(name))
  )
    return
  if (
    name === 'Notification' &&
    (provider !== 'claude' || data.notification_type !== 'permission_prompt')
  )
    return
  const agentId = data.agent_id
  if (agentId !== undefined && !identifier(agentId)) return { type: 'integration-unavailable' }
  if (name === 'SessionStart' || name === 'SessionEnd')
    return agentId
      ? undefined
      : { type: name === 'SessionStart' ? 'session-started' : 'session-ended' }
  const turnId = provider === 'claude' ? data.prompt_id : data.turn_id
  // Native child IDs are launch-scoped; some versions omit the parent's turn ID on child hooks.
  if (!identifier(turnId) && !agentId) return { type: 'integration-unavailable' }
  const event: HookEvent = {
    type: 'turn-active',
    ...(identifier(turnId) ? { turnId } : {}),
    ...(agentId ? { agentId } : {}),
  }
  const tool = data.tool_name ?? data.name
  if (identifier(tool)) event.toolName = tool
  const request = data.tool_use_id ?? data.tool_call_id ?? data.call_id
  if (identifier(request)) event.requestId = request
  switch (name) {
    case 'SubagentStart':
      if (!agentId) return { type: 'integration-unavailable' }
      event.type = 'turn-started'
      break
    case 'SubagentStop':
      if (!agentId) return { type: 'integration-unavailable' }
      event.type = 'turn-ended'
      break
    case 'UserPromptSubmit':
      event.type = 'turn-started'
      break
    case 'PermissionRequest':
      event.type = 'attention-required'
      event.waitingFor = 'permission'
      break
    case 'PreToolUse':
      if (tool === 'AskUserQuestion' || tool === 'request_user_input') {
        event.type = 'attention-required'
        event.waitingFor = 'question'
      }
      break
    case 'PostToolUse':
    case 'PostToolUseFailure':
      event.requestDone = true
      break
    // Stop ends a response, not necessarily a task; later native activity may resume this turn.
    case 'Stop':
      event.type = 'turn-ended'
      break
    case 'StopFailure':
      event.type = 'turn-failed'
      break
    case 'Interrupt':
      event.type = 'turn-interrupted'
      break
    case 'Notification':
      if (provider !== 'claude' || data.notification_type !== 'permission_prompt') return
      event.type = 'attention-required'
      event.waitingFor = 'permission'
      break
  }
  // Child Stop inventories can still list the ending child as running; only lead boundaries reconcile them.
  if (
    provider === 'claude' &&
    !agentId &&
    (name === 'Stop' || name === 'StopFailure') &&
    data.background_tasks !== undefined
  ) {
    if (!Array.isArray(data.background_tasks) || data.background_tasks.length > 256)
      return { type: 'integration-unavailable' }
    const agentIds = new Set<string>()
    const otherIds = new Set<string>()
    for (const task of data.background_tasks) {
      if (!task || typeof task !== 'object' || typeof task.status !== 'string')
        return { type: 'integration-unavailable' }
      if (['completed', 'failed', 'stopped', 'cancelled', 'killed'].includes(task.status)) continue
      if (
        !['running', 'pending', 'queued', 'in_progress'].includes(task.status) ||
        !identifier(task.id)
      )
        return { type: 'integration-unavailable' }
      if (task.type === 'subagent') agentIds.add(task.id)
      else if (['shell', 'monitor', 'MCP task', 'cloud session'].includes(task.type))
        otherIds.add(task.id)
      else return { type: 'integration-unavailable' }
    }
    if ([...agentIds].some((id) => otherIds.has(id))) return { type: 'integration-unavailable' }
    event.backgroundTasks = { agentIds: [...agentIds], otherCount: otherIds.size }
  }
  // Leave room for the authenticated envelope within the event server's 4 KiB frame limit.
  if (Buffer.byteLength(JSON.stringify(event)) > 3000) return { type: 'integration-unavailable' }
  return event
}
