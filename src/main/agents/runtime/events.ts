import type { AgentLifecycleEvent } from '../../../shared/contracts'

const types = new Set([
  'session-started',
  'turn-started',
  'turn-active',
  'attention-required',
  'turn-ended',
  'turn-completed',
  'turn-failed',
  'turn-interrupted',
  'activity-unknown',
  'integration-unavailable',
  'session-ended',
])
const keys = new Set([
  'token',
  'terminalId',
  'launchId',
  'provider',
  'eventId',
  'timestamp',
  'type',
  'turnId',
  'agentId',
  'requestId',
  'toolName',
  'requestDone',
  'waitingFor',
  'backgroundTasks',
])
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
export function validLifecycleEvent(event: AgentLifecycleEvent): boolean {
  const background = event.backgroundTasks
  return (
    !!event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    !Object.keys(event).some((key) => !keys.has(key)) &&
    types.has(event.type) &&
    identifier(event.eventId) &&
    (['turnId', 'agentId', 'requestId', 'toolName'] as const).every(
      (key) => event[key] === undefined || identifier(event[key]),
    ) &&
    (event.requestDone === undefined || typeof event.requestDone === 'boolean') &&
    (event.waitingFor === undefined || ['permission', 'question'].includes(event.waitingFor)) &&
    (background === undefined ||
      (event.provider === 'claude' &&
        event.agentId === undefined &&
        ['turn-ended', 'turn-failed'].includes(event.type) &&
        !!background &&
        typeof background === 'object' &&
        !Object.keys(background).some((key) => !['agentIds', 'otherCount'].includes(key)) &&
        Array.isArray(background.agentIds) &&
        background.agentIds.length <= 256 &&
        background.agentIds.every(identifier) &&
        new Set(background.agentIds).size === background.agentIds.length &&
        Number.isSafeInteger(background.otherCount) &&
        background.otherCount >= 0 &&
        background.otherCount + background.agentIds.length <= 256)) &&
    Number.isSafeInteger(event.timestamp) &&
    Math.abs(Date.now() - event.timestamp) <= 30_000
  )
}
