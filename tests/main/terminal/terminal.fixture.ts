import { afterEach, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'
import type { TerminalManager } from '../../../src/main/terminal/manager'
import type * as PromisesModule from 'node:fs/promises'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  stop: vi.fn(),
  busy: vi.fn(),
  directory: vi.fn(),
  shell: vi.fn(),
  agent: vi.fn(),
  eventWrite: vi.fn(),
  capability: vi.fn(),
  processes: vi.fn(),
  exec: vi.fn(),
  realpath: vi.fn(),
  prepareShell: vi.fn(),
}))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof PromisesModule>()
  return { ...fs, realpath: (path: string) => mocks.realpath(path) ?? fs.realpath(path) }
})
vi.mock('node:child_process', async (original) => {
  const { promisify } = await import('node:util')
  return {
    ...(await original<object>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }),
  }
})
vi.mock('../../../src/main/system/process-tree', () => ({
  stopProcessTree: mocks.stop,
  hasRunningJob: mocks.busy,
}))
vi.mock('../../../src/main/validation', async (original) => ({
  ...(await original<object>()),
  projectDirectory: mocks.directory,
}))
vi.mock('../../../src/main/system/shell', async (original) => ({
  ...(await original<object>()),
  resolveShell: mocks.shell,
  shellEnvironment: () => ({ TERM: 'xterm-256color' }),
}))
vi.mock('../../../src/main/agents/cli/registry', () => ({
  resolveAgent: mocks.agent,
  agentCapability: mocks.capability,
}))
vi.mock('../../../src/main/agents/hooks/shell-integration', () => ({
  prepareAgentShell: mocks.prepareShell,
}))
vi.mock('../../../src/main/agents/runtime/process-observation', async (original) => ({
  ...(await original<object>()),
  agentProcesses: mocks.processes,
}))
vi.mock('../../../src/main/agents/hooks/event-client', () => ({
  eventConnection: () => ({ destroyed: false, writableLength: 0, write: mocks.eventWrite }),
  lifecycleEvent: (type: string, turnId?: string) => ({ type, turnId }),
}))

function child() {
  const listeners = {
    data: (_data: string) => {},
    exit: (_event: { exitCode: number; signal?: number }) => {},
  }
  const dispose = vi.fn()
  return {
    pid: 98765,
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose,
    onData: vi.fn((callback) => {
      listeners.data = callback
      return { dispose }
    }),
    onExit: vi.fn((callback) => {
      listeners.exit = callback
      return { dispose }
    }),
    listeners,
  }
}
const settings = structuredClone(DEFAULT_CONFIG.preferences)
const agentLaunch = () => ({
  kind: 'agent' as const,
  provider: 'codex' as const,
  launchId: randomUUID(),
})
const options = () => ({
  id: randomUUID(),
  projectPath: '/tmp/project',
  cwd: '/tmp/project',
  workspaceKind: 'local' as const,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  cols: 80,
  rows: 24,
})
async function attach(
  manager: TerminalManager,
  entry: ReturnType<typeof options>,
  attachmentId = randomUUID(),
) {
  const promise = manager.attach({ ...entry, attachmentId })
  await vi.runAllTimersAsync()
  return { ...(await promise), attachmentId }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  mocks.spawn.mockImplementation(child)
  mocks.directory.mockImplementation((path: string) => Promise.resolve(path))
  mocks.shell.mockResolvedValue('/bin/zsh')
  mocks.agent.mockImplementation((provider: string) =>
    Promise.resolve({
      executable: `/usr/local/bin/${provider}`,
      args: [],
      env: { TERM: 'xterm-256color' },
    }),
  )
  mocks.capability.mockImplementation((provider) =>
    Promise.resolve(provider === 'pi' ? 'full' : 'partial'),
  )
  mocks.stop.mockResolvedValue(undefined)
  mocks.busy.mockResolvedValue(false)
  mocks.prepareShell.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

export { mocks, child, settings, agentLaunch, options, attach }
