import type { resolveCommand } from '../../system/shell'

export type ExecuteCliInstall = (
  command: Awaited<ReturnType<typeof resolveCommand>>,
) => Promise<{ stdout: string; stderr: string }>

export class AgentCliUpdateInterruptedError extends Error {
  constructor() {
    super('更新已中断。')
  }
}
