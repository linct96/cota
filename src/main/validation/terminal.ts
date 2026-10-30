import { AGENT_PROVIDERS, type AgentProvider, type TerminalLaunch } from '../../shared/contracts'

export function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new Error('终端标识无效。')
  }
  return value
}

export function agentProvider(value: unknown): AgentProvider {
  if (typeof value !== 'string' || !Object.hasOwn(AGENT_PROVIDERS, value))
    throw new Error('不支持的 Agent 类型。')
  return value as AgentProvider
}

export function terminalLaunch(value: unknown): TerminalLaunch {
  if (!value || typeof value !== 'object') throw new Error('终端启动参数无效。')
  const launch = value as Partial<TerminalLaunch>
  if (launch.kind === 'agent')
    return {
      kind: 'agent',
      provider: agentProvider(launch.provider),
      launchId: terminalId(launch.launchId),
    }
  if (
    (launch.kind === undefined || launch.kind === 'shell') &&
    launch.provider === undefined &&
    launch.launchId === undefined
  )
    return { kind: 'shell' }
  throw new Error('终端启动身份无效。')
}

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 1000 ||
    Number(rows) < 1 ||
    Number(rows) > 500
  ) {
    throw new Error('终端尺寸无效。')
  }
  return { cols: Number(cols), rows: Number(rows) }
}
