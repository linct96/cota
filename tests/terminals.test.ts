import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG, type AgentEventType, type TerminalEvent } from '../src/shared/contracts'
import { AgentSessionManager } from '../src/main/agent-session-manager'
import { normalizeHook } from '../src/main/agents/hooks'
import cotaLifecycle from '../src/main/agents/pi-extension'
import {
  parseAgentProcesses,
  agentOwner,
  foregroundAgent,
  recognizeNodeAgent,
} from '../src/main/agents/process-observation'

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
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, realpath: (path: string) => mocks.realpath(path) ?? fs.realpath(path) }
})
vi.mock('node:child_process', async (original) => {
  const { promisify } = await import('node:util')
  return {
    ...(await original<object>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }),
  }
})
vi.mock('../src/main/process-tree', () => ({
  stopProcessTree: mocks.stop,
  hasRunningJob: mocks.busy,
}))
vi.mock('../src/main/validation', async (original) => ({
  ...(await original<object>()),
  projectDirectory: mocks.directory,
}))
vi.mock('../src/main/shell', async (original) => ({
  ...(await original<object>()),
  resolveShell: mocks.shell,
  shellEnvironment: () => ({ TERM: 'xterm-256color' }),
}))
vi.mock('../src/main/agents', () => ({
  resolveAgent: mocks.agent,
  agentCapability: mocks.capability,
}))
vi.mock('../src/main/agents/shell-integration', () => ({
  prepareAgentShell: mocks.prepareShell,
}))
vi.mock('../src/main/agents/process-observation', async (original) => ({
  ...(await original<object>()),
  agentProcesses: mocks.processes,
}))
vi.mock('../src/main/agents/event-client', () => ({
  eventConnection: () => ({ destroyed: false, writableLength: 0, write: mocks.eventWrite }),
  lifecycleEvent: (type: string, turnId?: string) => ({ type, turnId }),
}))
import { TerminalManager } from '../src/main/terminals'

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
  vi.useFakeTimers()
  mocks.spawn.mockImplementation(child)
  mocks.directory.mockImplementation(async (path: string) => path)
  mocks.shell.mockResolvedValue('/bin/zsh')
  mocks.agent.mockImplementation(async (provider: string) => ({
    executable: `/usr/local/bin/${provider}`,
    args: [],
    env: { TERM: 'xterm-256color' },
  }))
  mocks.capability.mockImplementation(async (provider) => (provider === 'pi' ? 'full' : 'partial'))
  mocks.stop.mockResolvedValue(undefined)
  mocks.busy.mockResolvedValue(false)
  mocks.prepareShell.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('single PTY owner', () => {
  it('spawns an interactive login shell at the validated cwd', async () => {
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
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-il'],
      expect.objectContaining({ cwd: '/tmp/project', cols: 80, rows: 24 }),
    )
    manager.write(entry.id, '中文\r')
    manager.resize(entry.id, 100, 30)
    expect(mocks.spawn.mock.results[0].value.write).toHaveBeenCalledWith('中文\r')
    expect(mocks.spawn.mock.results[0].value.resize).toHaveBeenCalledWith(100, 30)
    const agent = { ...options(), ...agentLaunch(), provider: 'pi' as const }
    await manager.create(agent, settings)
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/usr/local/bin/pi',
      [],
      expect.objectContaining({ cwd: entry.cwd }),
    )
    expect(await manager.needsCloseConfirmation(agent.id)).toBe(true)
    mocks.spawn.mock.results[1].value.listeners.data('Completed! Waiting for input...')
    await vi.runAllTimersAsync()
    expect((await manager.list())[1]).toMatchObject({
      kind: 'agent',
      provider: 'pi',
      agent: {
        terminalId: agent.id,
        launchId: agent.launchId,
        runtimeState: 'running',
        activityState: 'unknown',
        observability: 'unavailable',
      },
    })
    const managedUpdates = vi.fn()
    const dynamic = new TerminalManager(vi.fn(), managedUpdates, '/tmp/cota-test/agent.sock')
    const shell = options()
    mocks.shell.mockResolvedValueOnce('/usr/local/bin/fish')
    mocks.prepareShell.mockResolvedValueOnce(['-il', '-C', 'codex-wrapper'])
    await dynamic.create(shell, settings)
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      '/usr/local/bin/fish',
      ['-il', '-C', 'codex-wrapper'],
      expect.any(Object),
    )
    const env = mocks.spawn.mock.calls.at(-1)![2].env
    expect(env).toMatchObject({ COTA_AGENT_MANAGED: '1', COTA_AGENT_TERMINAL: shell.id })
    const rows = parseAgentProcesses(
      '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026\n60001 60000 60001 -1 S Mon Oct 19 10:01:01 2026',
    )
    expect(agentOwner(rows, 98765, 60001)?.pid).toBe(60000)
    expect(agentOwner(rows, 98765, 1)).toBeUndefined()
    expect(agentOwner(rows, 60000, 60001)).toBeUndefined()
    expect(agentOwner(rows, 60000, 60001, true)?.pid).toBe(60000)
    expect(agentOwner(rows, 60000, 1, true)).toBeUndefined()
    expect(
      agentOwner(
        rows.map((row) => (row.pid === 60000 ? { ...row, foreground: 98765 } : row)),
        60000,
        60001,
        true,
      ),
    ).toBeUndefined()
    expect(
      agentOwner(
        rows.map((row) => (row.pid === 98765 ? { ...row, foreground: 98765 } : row)),
        98765,
        60001,
      ),
    ).toBeUndefined()
    const codexRows = parseAgentProcesses(
      '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026 /bin/fish\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026 /tmp/工具 path/codex\n60001 60000 60001 -1 S Mon Oct 19 10:01:01 2026 Electron',
    )
    expect(codexRows[1]).toMatchObject({
      started: 'Mon Oct 19 10:01:00 2026',
      command: '/tmp/工具 path/codex',
    })
    expect(foregroundAgent(codexRows, 98765)).toMatchObject({
      provider: 'codex',
      owner: { pid: 60000 },
    })
    expect(foregroundAgent(rows, 98765)).toBeUndefined()
    for (const [command, provider] of [
      ['/bin/claude', 'claude'],
      ['/bin/pi', 'pi'],
      ['/bin/codex-aarch64-apple-darwin', 'codex'],
    ]) {
      expect(
        foregroundAgent(
          codexRows.map((row) => (row.pid === 60000 ? { ...row, command } : row)),
          98765,
        ),
      ).toMatchObject({ provider, owner: { pid: 60000 } })
    }
    for (const [command, provider] of [
      ['node /opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --prompt secret', 'pi'],
      ['/usr/bin/node /opt/node_modules/@mariozechner/pi-coding-agent/dist/bundle/cli.js', 'pi'],
      ['node "/tmp/path space/node_modules/@anthropic-ai/claude-code/cli.js"', 'claude'],
      ['node /opt/node_modules/@openai/codex/bin/codex.js', 'codex'],
      ['node /tmp/cli.js /opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js', undefined],
      ['node -e /opt/node_modules/@anthropic-ai/claude-code/cli.js', undefined],
      ['python /opt/node_modules/@anthropic-ai/claude-code/cli.js', undefined],
      ['node /tmp/pi-coding-agent/dist/cli.js', undefined],
    ] as const)
      expect(recognizeNodeAgent(command)).toBe(provider)
    const { agentProcesses: readProcesses } = await vi.importActual<
      typeof import('../src/main/agents/process-observation')
    >('../src/main/agents/process-observation')
    const nodeSnapshot =
      '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026 /bin/fish\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026 /usr/bin/node\n70000 1 70000 70000 S Mon Oct 19 10:01:00 2026 /usr/bin/node'
    const nodeArgs =
      '60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026 node /opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --prompt secret'
    mocks.exec
      .mockResolvedValueOnce({ stdout: nodeSnapshot })
      .mockResolvedValueOnce({ stdout: nodeArgs })
    const identified = await readProcesses(true, [98765])
    expect(foregroundAgent(identified, 98765)).toMatchObject({
      provider: 'pi',
      owner: { pid: 60000 },
    })
    expect(JSON.stringify(identified)).not.toContain('secret')
    expect(mocks.exec.mock.calls.at(-1)![1]).toContain('60000')
    expect(mocks.exec.mock.calls.at(-1)![1]).not.toContain('70000')
    mocks.realpath.mockResolvedValueOnce(
      '/opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    )
    mocks.exec.mockResolvedValueOnce({ stdout: nodeSnapshot }).mockResolvedValueOnce({
      stdout: nodeArgs.replace(
        '/opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        '/usr/local/bin/pi',
      ),
    })
    expect(foregroundAgent(await readProcesses(true, [98765]), 98765)).toMatchObject({
      provider: 'pi',
    })
    expect(mocks.realpath).toHaveBeenLastCalledWith('/usr/local/bin/pi')
    mocks.exec
      .mockResolvedValueOnce({ stdout: nodeSnapshot })
      .mockResolvedValueOnce({ stdout: nodeArgs.replace('10:01:00', '10:02:00') })
    expect(foregroundAgent(await readProcesses(true, [98765]), 98765)).toBeUndefined()
    mocks.exec
      .mockResolvedValueOnce({ stdout: nodeSnapshot })
      .mockRejectedValueOnce(new Error('argv unavailable'))
    expect(foregroundAgent(await readProcesses(true, [98765]), 98765)).toBeUndefined()
    for (const change of [
      { group: 70000 },
      { stat: 'T' },
      { stat: 'Z' },
      { parent: 1 },
      { command: '/bin/codex-helper' },
    ]) {
      expect(
        foregroundAgent(
          codexRows.map((row) => (row.pid === 60000 ? { ...row, ...change } : row)),
          98765,
        ),
      ).toBeUndefined()
    }
    expect(foregroundAgent([...codexRows, { ...codexRows[1], pid: 70000 }], 98765)).toBeUndefined()
    expect(
      foregroundAgent(
        [...codexRows, { ...codexRows[1], pid: 60002, parent: 60000, command: 'claude' }],
        98765,
      ),
    ).toBeUndefined()
    expect(
      foregroundAgent([{ ...codexRows[0], foreground: 98765, command: 'codex' }], 98765)?.owner.pid,
    ).toBe(98765)
    mocks.processes.mockResolvedValue(rows)
    const manual = {
      managed: true,
      terminalId: shell.id,
      token: env.COTA_AGENT_TOKEN,
      provider: 'pi',
      processId: 60001,
      sessionId: 'native-session',
      type: 'session-started',
      eventId: randomUUID(),
      timestamp: Date.now(),
    }
    const manualChannel = {}
    expect(dynamic.authenticManagedEvent({ ...manual, token: '0'.repeat(64) })).toBe(false)
    expect(
      await dynamic.receiveAgentEvent({ ...manual, token: '0'.repeat(64) }, manualChannel),
    ).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, processId: 1 }, manualChannel)).toBe(false)
    expect(await dynamic.receiveAgentEvent({ ...manual, prompt: 'secret' }, manualChannel)).toBe(
      false,
    )
    expect((await dynamic.list())[0].agent).toBeUndefined()
    expect(await dynamic.receiveAgentEvent(manual, manualChannel)).toBe(true)
    const firstRun = (await dynamic.list())[0].agent!
    expect(firstRun).toMatchObject({ provider: 'pi', activityState: 'idle', observability: 'full' })
    expect((await dynamic.list())[0].kind).toBeUndefined()
    expect(await dynamic.receiveAgentEvent({ ...manual, provider: 'codex' }, {})).toBe(false)
    const working = {
      ...manual,
      type: 'turn-started',
      turnId: 'native-turn',
      eventId: randomUUID(),
    }
    expect(await dynamic.receiveAgentEvent(working, manualChannel)).toBe(true)
    expect((await dynamic.list())[0].agent?.activityState).toBe('working')
    mocks.processes.mockRejectedValueOnce(new Error('ps unavailable'))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await dynamic.list())[0].agent?.activityState).toBe('unknown')
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await dynamic.list())[0].agent).toBeUndefined()
    expect(managedUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'removed', launchId: firstRun.launchId }),
    )
    const secondRows = rows.map((row) => ({ ...row, started: `${row.started}-new` }))
    mocks.processes.mockResolvedValue(secondRows)
    const secondChannel = {}
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        secondChannel,
      ),
    ).toBe(true)
    const secondRun = (await dynamic.list())[0].agent!
    expect(secondRun.launchId).not.toBe(firstRun.launchId)
    expect(secondRun.revision).toBeGreaterThan(firstRun.revision)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, type: 'session-ended', eventId: randomUUID(), timestamp: Date.now() },
        secondChannel,
      ),
    ).toBe(true)
    expect(
      await dynamic.receiveAgentEvent(
        { ...manual, eventId: randomUUID(), timestamp: Date.now() },
        {},
      ),
    ).toBe(true)
    expect((await dynamic.list())[0].agent?.launchId).not.toBe(secondRun.launchId)
    dynamic.write(shell.id, 'still a shell\r')
    await dynamic.shutdown()
    expect(dynamic.authenticManagedEvent(manual)).toBe(false)
    expect(
      await dynamic.receiveAgentEvent({ ...manual, timestamp: Date.now() }, manualChannel),
    ).toBe(false)

    const startup = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const startupEntry = options()
    await startup.create(startupEntry, settings)
    const startupEnv = mocks.spawn.mock.calls.at(-1)![2].env
    mocks.processes.mockResolvedValue(codexRows)
    await vi.advanceTimersByTimeAsync(500)
    const detected = (await startup.list())[0].agent!
    expect(detected).toMatchObject({
      provider: 'codex',
      runtimeState: 'running',
      activityState: 'unknown',
      eventSource: 'process',
      observability: 'unavailable',
      unread: false,
    })
    expect((await startup.list())[0].kind).toBeUndefined()
    const detectedRevision = detected.revision
    await vi.advanceTimersByTimeAsync(500)
    expect((await startup.list())[0].agent?.revision).toBe(detectedRevision)
    const startupEvent = {
      ...manual,
      terminalId: startupEntry.id,
      token: startupEnv.COTA_AGENT_TOKEN,
      provider: 'codex',
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-ended',
          turnId: 'too-early',
        },
        {},
      ),
    ).toBe(false)
    expect(await startup.receiveAgentEvent({ ...startupEvent, provider: 'pi' }, {})).toBe(false)
    const startupChannel = {}
    expect(await startup.receiveAgentEvent(startupEvent, startupChannel)).toBe(true)
    expect((await startup.list())[0].agent).toMatchObject({
      launchId: detected.launchId,
      activityState: 'idle',
      observability: 'partial',
    })
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-started',
          turnId: 'first-turn',
          eventId: randomUUID(),
        },
        startupChannel,
      ),
    ).toBe(true)
    expect((await startup.list())[0].agent?.activityState).toBe('working')
    mocks.processes.mockRejectedValueOnce(new Error('process snapshot unavailable'))
    await vi.advanceTimersByTimeAsync(750)
    expect((await startup.list())[0].agent).toMatchObject({
      launchId: detected.launchId,
      activityState: 'unknown',
    })
    mocks.processes.mockResolvedValue(
      codexRows.map((row) =>
        row.pid === 60000
          ? { ...row, started: `${row.started}-reused`, command: '/bin/python3' }
          : row,
      ),
    )
    await vi.advanceTimersByTimeAsync(1500)
    expect((await startup.list())[0].agent).toBeUndefined()
    expect(
      await startup.receiveAgentEvent(
        {
          ...startupEvent,
          type: 'turn-ended',
          turnId: 'old-turn',
        },
        {},
      ),
    ).toBe(false)
    mocks.processes.mockResolvedValue(
      codexRows.map((row) => ({
        ...row,
        started: `${row.started}-restarted`,
      })),
    )
    startup.write(startupEntry.id, 'codex\r')
    await vi.advanceTimersByTimeAsync(350)
    const restarted = (await startup.list())[0].agent!
    expect(restarted.launchId).not.toBe(detected.launchId)
    expect(restarted.revision).toBeGreaterThan(detectedRevision)
    expect(restarted.activityState).toBe('unknown')
    await startup.shutdown()

    for (const provider of ['claude', 'pi'] as const) {
      const generic = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
      const genericEntry = options()
      await generic.create(genericEntry, settings)
      const genericEnv = mocks.spawn.mock.calls.at(-1)![2].env
      mocks.processes.mockResolvedValue(
        codexRows.map((row) =>
          row.pid === 60000
            ? { ...row, command: provider === 'pi' ? '/usr/bin/node' : '/bin/claude', provider }
            : row,
        ),
      )
      await vi.advanceTimersByTimeAsync(350)
      const discovered = (await generic.list())[0].agent!
      expect(discovered).toMatchObject({
        provider,
        activityState: 'unknown',
        eventSource: 'process',
        observability: 'unavailable',
      })
      expect(mocks.processes).toHaveBeenLastCalledWith(true, [98765])
      expect(
        await generic.receiveAgentEvent(
          {
            ...manual,
            terminalId: genericEntry.id,
            token: genericEnv.COTA_AGENT_TOKEN,
            provider,
            timestamp: Date.now(),
            eventId: randomUUID(),
          },
          {},
        ),
      ).toBe(true)
      expect((await generic.list())[0].agent).toMatchObject({
        launchId: discovered.launchId,
        activityState: 'idle',
        observability: provider === 'pi' ? 'full' : 'partial',
      })
      await generic.shutdown()
    }

    const cadence = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const idleEntry = options()
    mocks.processes.mockResolvedValue(rows.filter((row) => row.pid === 98765))
    await cadence.create(idleEntry, settings)
    const idleChild = mocks.spawn.mock.results.at(-1)!.value
    await vi.advanceTimersByTimeAsync(350)
    const idleReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(1999)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 1)
    cadence.write(idleEntry.id, 'claude\r')
    await vi.advanceTimersByTimeAsync(349)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 2)
    idleChild.listeners.data('\x1b]133;')
    idleChild.listeners.data('C\x07')
    await vi.advanceTimersByTimeAsync(400)
    expect(mocks.processes).toHaveBeenCalledTimes(idleReads + 3)
    mocks.processes.mockRejectedValueOnce(new Error('snapshot unavailable'))
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    const failedReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(3999)
    expect(mocks.processes).toHaveBeenCalledTimes(failedReads)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.processes).toHaveBeenCalledTimes(failedReads + 1)
    let finishObservation!: (value: typeof rows) => void
    mocks.processes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishObservation = resolve
        }),
    )
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    const pendingReads = mocks.processes.mock.calls.length
    cadence.write(idleEntry.id, '\r')
    await vi.advanceTimersByTimeAsync(350)
    expect(mocks.processes).toHaveBeenCalledTimes(pendingReads)
    finishObservation(rows.filter((row) => row.pid === 98765))
    await vi.advanceTimersByTimeAsync(350)
    expect(mocks.processes).toHaveBeenCalledTimes(pendingReads + 1)
    await cadence.shutdown()
    const stoppedReads = mocks.processes.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.processes).toHaveBeenCalledTimes(stoppedReads)

    const directUpdates = vi.fn()
    const direct = new TerminalManager(vi.fn(), directUpdates, '/tmp/cota-test/agent.sock')
    const directEntry = { ...options(), ...agentLaunch(), provider: 'pi' as const }
    await direct.create(directEntry, settings)
    const directSpawn = mocks.spawn.mock.calls.at(-1)!
    const directChild = mocks.spawn.mock.results.at(-1)!.value
    expect(directSpawn.slice(0, 2)).toEqual(['/usr/local/bin/pi', []])
    expect(directSpawn[2].env).toMatchObject({
      COTA_AGENT_MANAGED: '1',
      COTA_AGENT_TERMINAL: directEntry.id,
      COTA_AGENT_RUNNER: process.execPath,
    })
    expect(directSpawn[2].env.COTA_AGENT_LAUNCH).toBeUndefined()
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'unknown',
      observability: 'unavailable',
    })
    mocks.processes.mockResolvedValue(rows.map((row) => ({ ...row, foreground: 98765 })))
    const directEvent = {
      ...manual,
      terminalId: directEntry.id,
      token: directSpawn[2].env.COTA_AGENT_TOKEN,
      processId: 98765,
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    const directChannel = {}
    expect(await direct.receiveAgentEvent({ ...directEvent, provider: 'codex' }, {})).toBe(false)
    expect(await direct.receiveAgentEvent({ ...directEvent, managed: undefined }, {})).toBe(false)
    expect(await direct.receiveAgentEvent(directEvent, directChannel)).toBe(true)
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'idle',
      observability: 'full',
    })
    expect(
      await direct.receiveAgentEvent(
        {
          ...directEvent,
          type: 'turn-started',
          turnId: 'direct-turn',
          eventId: randomUUID(),
        },
        directChannel,
      ),
    ).toBe(true)
    expect((await direct.list())[0].agent?.activityState).toBe('working')
    expect(
      await direct.receiveAgentEvent(
        {
          ...directEvent,
          type: 'session-ended',
          eventId: randomUUID(),
        },
        directChannel,
      ),
    ).toBe(true)
    const directRevision = (await direct.list())[0].agent!.revision
    expect(await direct.receiveAgentEvent({ ...directEvent, eventId: randomUUID() }, {})).toBe(true)
    expect((await direct.list())[0].agent).toMatchObject({
      launchId: directEntry.launchId,
      activityState: 'idle',
    })
    expect((await direct.list())[0].agent!.revision).toBeGreaterThan(directRevision)
    mocks.processes.mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(2000)
    expect((await direct.list())[0].agent?.runtimeState).toBe('running')
    expect(directUpdates.mock.calls.some(([event]) => event.type === 'removed')).toBe(false)
    directChild.listeners.exit({ exitCode: 7 })
    expect((await direct.list())[0]).toMatchObject({
      exited: true,
      exitCode: 7,
      agent: { launchId: directEntry.launchId, runtimeState: 'exited', exitCode: 7 },
    })
    expect(await direct.receiveAgentEvent(directEvent, {})).toBe(false)
    await direct.shutdown()

    const pendingManager = new TerminalManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
    const pendingEntry = { ...options(), ...agentLaunch() }
    await pendingManager.create(pendingEntry, settings)
    const pendingEnv = mocks.spawn.mock.calls.at(-1)![2].env
    mocks.processes.mockResolvedValue(rows.map((row) => ({ ...row, foreground: 98765 })))
    let finishCapability!: (value: 'partial') => void
    mocks.capability.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCapability = resolve
        }),
    )
    const pendingEvent = {
      ...directEvent,
      terminalId: pendingEntry.id,
      provider: 'codex',
      token: pendingEnv.COTA_AGENT_TOKEN,
      timestamp: Date.now(),
      eventId: randomUUID(),
    }
    const pendingReceive = pendingManager.receiveAgentEvent(pendingEvent, {})
    await vi.waitFor(() => expect(finishCapability).toBeDefined())
    mocks.stop.mockRejectedValueOnce(new Error('pending close failed'))
    await expect(pendingManager.close(pendingEntry.id)).rejects.toThrow('pending close failed')
    finishCapability('partial')
    expect(await pendingReceive).toBe(false)
    expect((await pendingManager.list())[0].agent?.observability).toBe('unavailable')
    expect(
      await pendingManager.receiveAgentEvent({ ...pendingEvent, eventId: randomUUID() }, {}),
    ).toBe(false)
    await pendingManager.shutdown()

    const updates = vi.fn()
    const engine = new AgentSessionManager(updates)
    const state = engine.create(agent.id, agent.launchId, 'pi', agent)
    engine.runtime(agent.id, 'running')
    const token = engine.enable(agent.id, 'pi-extension', 'full')
    const channel = {}
    const event = (type: AgentEventType, turnId?: string) => ({
      terminalId: agent.id,
      launchId: agent.launchId,
      provider: 'pi',
      token,
      eventId: randomUUID(),
      timestamp: Date.now(),
      type,
      ...(turnId ? { turnId } : {}),
    })
    const ready = event('session-started')
    expect(engine.receive({ ...ready, token: '0'.repeat(64) }, channel)).toBe(false)
    expect(engine.receive({ ...ready, launchId: randomUUID() }, channel)).toBe(false)
    expect(engine.receive({ ...ready, provider: 'claude' }, channel)).toBe(false)
    expect(engine.receive({ ...ready, prompt: 'never accepted' }, channel)).toBe(false)
    expect(engine.receive({ ...ready, timestamp: Date.now() - 31_000 }, channel)).toBe(false)
    expect(engine.receive({ ...ready, type: 'constructor' }, channel)).toBe(false)
    expect(engine.receive(ready, channel)).toBe(true)
    expect(state).toMatchObject({ activityState: 'idle', observability: 'full' })
    expect(engine.receive(ready, {})).toBe(false)
    const revision = state.revision
    expect(engine.receive(ready, channel)).toBe(true)
    expect(state.revision).toBe(revision)
    engine.receive(event('turn-started', 'turn-1'), channel)
    engine.receive(event('attention-required', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'needs-input', unread: true })
    engine.read(agent.id, agent.launchId, state.revision - 1)
    engine.read(agent.id, randomUUID(), state.revision)
    expect(state.unread).toBe(true)
    engine.read(agent.id, agent.launchId, state.revision)
    expect(state).toMatchObject({ activityState: 'needs-input', unread: false })
    engine.receive(event('turn-active', 'turn-1'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'completed', outcome: 'success', unread: true })
    engine.read(agent.id, agent.launchId, state.revision)
    expect(state).toMatchObject({ activityState: 'completed', unread: false })
    engine.receive(event('attention-required'), channel)
    engine.receive(event('activity-unknown'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    expect(state.activityState).toBe('unknown')
    engine.receive(event('turn-started', 'turn-2'), channel)
    engine.receive(event('turn-completed', 'turn-1'), channel)
    engine.receive(event('turn-started', 'turn-1'), channel)
    expect(state).toMatchObject({ activityState: 'working', lastTurnId: 'turn-2' })
    engine.receive(event('turn-interrupted', 'turn-2'), channel)
    expect(state).toMatchObject({ activityState: 'interrupted', unread: false })
    for (let index = 0; index < 101; index++) engine.receive(ready, channel)
    expect(engine.receive(ready, channel)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(engine.receive(event('turn-started', 'turn-3'), channel)).toBe(true)
    engine.disconnect(channel)
    expect(state).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    expect(engine.receive(event('turn-completed', 'turn-3'), channel)).toBe(false)
    expect(JSON.stringify(updates.mock.calls)).not.toContain(token)

    const hookAgent = { ...options(), ...agentLaunch(), provider: 'claude' as const }
    const hookState = engine.create(hookAgent.id, hookAgent.launchId, 'claude', hookAgent)
    engine.runtime(hookAgent.id, 'running')
    const hookToken = engine.enable(hookAgent.id, 'claude-hooks', 'partial')
    const hookEvent = (type: AgentEventType, turnId = 'prompt-1') => ({
      ...event(type, turnId),
      terminalId: hookAgent.id,
      launchId: hookAgent.launchId,
      provider: 'claude',
      token: hookToken,
    })
    engine.receive(hookEvent('turn-started'), {})
    engine.receive(hookEvent('turn-completed'), {})
    expect(hookState.activityState).toBe('working')
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      unread: true,
    })
    engine.receive(hookEvent('turn-active'), {})
    expect(hookState).toMatchObject({ activityState: 'working', unread: false })
    engine.receive(hookEvent('turn-failed'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({ activityState: 'failed', outcome: 'failure', unread: true })
    engine.receive(hookEvent('turn-active'), {})
    engine.receive(hookEvent('turn-interrupted'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      unread: false,
    })
    engine.receive(hookEvent('turn-started', 'prompt-2'), {})
    engine.receive(hookEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('working')
    const childEvent = (type: AgentEventType, agentId = 'child-a') => ({
      ...hookEvent(type, 'prompt-2'),
      agentId,
    })
    engine.receive(childEvent('turn-started'), {})
    engine.receive({ ...childEvent('turn-started', 'child-b'), turnId: undefined }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(childEvent('turn-started'), {})
    engine.receive(hookEvent('turn-ended', 'prompt-2'), {})
    expect(hookState).toMatchObject({
      activityState: 'needs-input',
      waitingChildren: 1,
      workingChildren: 1,
    })
    engine.receive(
      { ...childEvent('turn-active', 'child-b'), requestId: 'question-a', requestDone: true },
      {},
    )
    engine.receive(
      { ...childEvent('turn-active'), requestId: 'unrelated-tool', requestDone: true },
      {},
    )
    expect(hookState.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    expect(hookState).toMatchObject({
      activityState: 'working',
      waitingChildren: 0,
      workingChildren: 2,
    })
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('working')
    engine.receive({ ...childEvent('turn-ended', 'child-b'), turnId: undefined }, {})
    expect(hookState).toMatchObject({
      activityState: 'completed',
      outcome: 'unknown',
      workingChildren: 0,
    })
    const resumed = childEvent('turn-started')
    engine.receive(resumed, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive({ ...childEvent('attention-required'), requestId: 'question-a' }, {})
    engine.receive(resumed, {})
    engine.receive(childEvent('turn-started'), {})
    expect(hookState.activityState).toBe('needs-input')
    engine.receive({ ...childEvent('turn-active'), requestId: 'question-a', requestDone: true }, {})
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.activityState).toBe('completed')
    engine.receive({ ...hookEvent('attention-required', 'prompt-2'), toolName: 'Bash' }, {})
    engine.receive(
      {
        ...hookEvent('turn-active', 'prompt-2'),
        toolName: 'Bash',
        requestId: 'parallel',
        requestDone: true,
      },
      {},
    )
    expect(hookState.activityState).toBe('needs-input')
    const emptyInventory = { agentIds: [], otherCount: 0 }
    const inventory = { agentIds: ['child-a', 'snapshot-only'], otherCount: 1 }
    for (const backgroundTasks of [
      { agentIds: ['child-a', 'child-a'], otherCount: 0 },
      { agentIds: ['bad/id'], otherCount: 0 },
      { agentIds: [], otherCount: -1 },
      { agentIds: [], otherCount: 257 },
      { agentIds: [], otherCount: 0, command: 'never accepted' },
    ])
      expect(engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks }, {})).toBe(
        false,
      )
    expect(
      engine.receive({ ...childEvent('turn-ended'), backgroundTasks: emptyInventory }, {}),
    ).toBe(false)
    engine.receive(childEvent('turn-started'), {})
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 3 })
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: inventory }, {})
    expect(hookState.workingChildren).toBe(3)
    engine.receive(childEvent('turn-ended'), {})
    expect(hookState.workingChildren).toBe(2)
    engine.receive({ ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: emptyInventory }, {})
    expect(hookState).toMatchObject({ activityState: 'completed', workingChildren: 0 })
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-2'), backgroundTasks: { agentIds: [], otherCount: 1 } },
      {},
    )
    engine.receive(hookEvent('turn-started', 'prompt-background'), {})
    vi.advanceTimersByTime(4 * 60_000)
    engine.receive(hookEvent('turn-active', 'prompt-background'), {})
    engine.receive(hookEvent('turn-ended', 'prompt-background'), {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    vi.advanceTimersByTime(60_000)
    engine.expire()
    expect(hookState).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(
      { ...hookEvent('turn-failed', 'prompt-background'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'failed',
      outcome: 'failure',
      workingChildren: 0,
    })
    engine.receive(hookEvent('turn-started', 'prompt-2-clean'), {})
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-2-clean'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'completed',
      observability: 'partial',
      outcome: 'unknown',
    })
    const olderInventory = {
      ...hookEvent('turn-ended', 'prompt-2-clean'),
      backgroundTasks: emptyInventory,
    }
    vi.advanceTimersByTime(1)
    engine.receive(childEvent('turn-started'), {})
    engine.receive(olderInventory, {})
    expect(hookState).toMatchObject({ activityState: 'working', workingChildren: 1 })
    engine.receive(childEvent('turn-ended'), {})
    engine.receive(hookEvent('turn-started', 'prompt-cancel'), {})
    engine.receive(
      {
        ...hookEvent('turn-ended', 'prompt-cancel'),
        backgroundTasks: { agentIds: [], otherCount: 1 },
      },
      {},
    )
    engine.receive(hookEvent('turn-interrupted', 'prompt-cancel'), {})
    engine.receive(
      { ...hookEvent('turn-ended', 'prompt-cancel'), backgroundTasks: emptyInventory },
      {},
    )
    expect(hookState).toMatchObject({
      activityState: 'interrupted',
      outcome: 'cancelled',
      workingChildren: 0,
    })
    engine.receive(hookEvent('turn-started', 'prompt-3'), {})
    engine.receive(childEvent('turn-started', 'child-stale'), {})
    vi.advanceTimersByTime(5 * 60_000)
    engine.expire()
    engine.receive(hookEvent('turn-ended', 'prompt-3'), {})
    expect(hookState).toMatchObject({ activityState: 'unknown', observability: 'unavailable' })
    engine.receive(childEvent('turn-ended', 'child-stale'), {})
    expect(hookState).toMatchObject({ activityState: 'completed', observability: 'partial' })
    engine.runtime(hookAgent.id, 'exited', 7)
    expect(engine.receive(hookEvent('turn-completed', 'prompt-2'), {})).toBe(false)
    expect(hookState).toMatchObject({
      runtimeState: 'exited',
      activityState: 'unknown',
      exitCode: 7,
    })
    engine.disable()

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
  it('skips confirmation only for idle shells and falls back to confirmation when inspection fails', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    expect(mocks.busy).toHaveBeenCalledWith(98765, '/bin/zsh')
    mocks.busy.mockResolvedValueOnce(true)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    mocks.busy.mockRejectedValueOnce(new Error('ps failed'))
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    const process = mocks.spawn.mock.results[0].value
    mocks.busy.mockImplementationOnce(async () => {
      process.listeners.exit({ exitCode: 0 })
      return true
    })
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    mocks.busy.mockClear()
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
    expect(await manager.needsCloseConfirmation(randomUUID())).toBe(false)
    expect(mocks.busy).not.toHaveBeenCalled()
    await manager.close(entry.id)
  })
  it('does not advertise in-flight creates as recoverable sessions when creation fails', async () => {
    const manager = new TerminalManager(vi.fn())
    let fail!: (error: Error) => void
    mocks.directory.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    const creating = manager.create(options(), settings)
    await Promise.resolve()
    const rejected = expect(creating).rejects.toThrow('missing')
    const listing = manager.list()
    fail(new Error('missing'))
    await rejected
    expect(await listing).toEqual([])
  })
  it('reserves slots before async validation, enforcing the limit on concurrent creates', async () => {
    const manager = new TerminalManager(vi.fn())
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        manager.create(index % 2 ? { ...options(), ...agentLaunch() } : options(), settings),
      ),
    )
    await expect(manager.create(options(), settings)).rejects.toThrow('10')
    expect(mocks.spawn).toHaveBeenCalledTimes(10)
  })
  it('batches output, pauses at high water, and resumes only after rendering acknowledgements', async () => {
    const events: TerminalEvent[] = []
    const manager = new TerminalManager((event) => events.push(event))
    const entry = options()
    await manager.create(entry, settings)
    const { attachmentId } = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(12)
    expect(events).toHaveLength(1)
    expect(process.pause).toHaveBeenCalled()
    await vi.runAllTimersAsync()
    const resumes = process.resume.mock.calls.length
    manager.acknowledge(entry.id, attachmentId, 999999)
    expect(process.resume).toHaveBeenCalledTimes(resumes)
    manager.acknowledge(entry.id, attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(resumes + 1)
  })
  it('reports exit code, flushes pending output and rejects later input', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = { ...options(), ...agentLaunch() }
    await manager.create(entry, settings)
    const { attachmentId } = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('last output')
    process.listeners.exit({ exitCode: 7 })
    await vi.runAllTimersAsync()
    expect(send.mock.calls.map(([event]) => event.type)).toEqual(['data', 'exit'])
    expect(send).toHaveBeenLastCalledWith({
      type: 'exit',
      id: entry.id,
      attachmentId,
      exitCode: 7,
      signal: undefined,
    })
    expect(() => manager.write(entry.id, 'no')).toThrow('已退出')
    expect(manager.hasLive()).toBe(false)
    const restored = await attach(manager, entry)
    expect(restored.snapshot).toContain('last output')
    expect(restored.agent).toMatchObject({
      launchId: entry.launchId,
      runtimeState: 'exited',
      exitCode: 7,
      activityState: 'unknown',
    })
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(false)
  })
  it('retries a concurrent create with the same ID without spawning twice, rejecting a different owner', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = { ...options(), ...agentLaunch(), provider: 'claude' as const }
    await Promise.all([manager.create(entry, settings), manager.create(entry, settings)])
    await expect(manager.create({ ...entry, workspaceId: randomUUID() }, settings)).rejects.toThrow(
      '占用',
    )
    await expect(manager.create({ ...entry, launchId: randomUUID() }, settings)).rejects.toThrow(
      '占用',
    )
    await expect(manager.create({ ...entry, provider: 'pi' }, settings)).rejects.toThrow('占用')
    await expect(manager.create({ ...options(), id: entry.id }, settings)).rejects.toThrow('占用')
    for (const provider of ['__proto__', 'sh', 'codex; touch nope']) {
      expect(() => manager.create({ ...entry, provider: provider as never }, settings)).toThrow(
        '不支持',
      )
    }
    expect(() => manager.create({ ...entry, launchId: 'invalid' }, settings)).toThrow('标识无效')
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
  it('keeps output and releases renderer backpressure while detached; ignores stale detach and ACK', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings)
    const first = await attach(manager, entry)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('x'.repeat(150000))
    await vi.runAllTimersAsync()
    manager.detach(entry.id, first.attachmentId)
    const resumes = process.resume.mock.calls.length
    process.listeners.data('\r\nWHILE_DETACHED\r\n')
    await vi.runAllTimersAsync()
    const second = await attach(manager, entry)
    expect(second.snapshot).toContain('WHILE_DETACHED')
    manager.detach(entry.id, first.attachmentId)
    process.listeners.data('y'.repeat(150000))
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ attachmentId: second.attachmentId }),
    )
    const currentResumes = process.resume.mock.calls.length
    manager.acknowledge(entry.id, first.attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(currentResumes)
    manager.acknowledge(entry.id, second.attachmentId, 150000)
    expect(process.resume).toHaveBeenCalledTimes(currentResumes + 1)
    expect(resumes).toBeGreaterThan(0)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await manager.close(entry.id)
  })
  it('delivers output queued after the snapshot barrier exactly once, while earlier output stays in the snapshot', async () => {
    const send = vi.fn()
    const manager = new TerminalManager(send)
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('BEFORE_BARRIER\r\n')
    const attaching = manager.attach({ ...entry, attachmentId: randomUUID() })
    await Promise.resolve()
    process.listeners.data('AFTER_BARRIER\r\n')
    await vi.runAllTimersAsync()
    const restored = await attaching
    expect(restored.snapshot).toContain('BEFORE_BARRIER')
    expect(restored.snapshot).not.toContain('AFTER_BARRIER')
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'data', data: 'AFTER_BARRIER\r\n' }),
    )
    await manager.close(entry.id)
  })
  it('answers terminal status queries while detached, leaving attached renderer responses unduplicated', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('\x1b[6n')
    await vi.runAllTimersAsync()
    expect(process.write).toHaveBeenCalledExactlyOnceWith('\x1b[1;1R')
    await attach(manager, entry)
    process.listeners.data('\x1b[6n')
    await vi.runAllTimersAsync()
    expect(process.write).toHaveBeenCalledOnce()
    await manager.close(entry.id)
  })
  it('attaches to exited sessions with their final screen and never respawns a missing session', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await expect(manager.attach({ ...entry, attachmentId: randomUUID() })).rejects.toThrow('不存在')
    expect(mocks.spawn).not.toHaveBeenCalled()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data('\x1b[?1049h\x1b[2J\x1b[4;9H中文 TUI')
    process.listeners.exit({ exitCode: 7 })
    const result = await attach(manager, entry)
    expect(result).toMatchObject({ exited: true, exitCode: 7, cols: 80, rows: 24 })
    expect(result.snapshot).toContain('中文 TUI')
    expect(result.snapshot).toContain('\x1b[?1049h')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await manager.close(entry.id)
  })
  it('applies scrollback changes to Host snapshots and validates the limit before discarding history', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    const process = mocks.spawn.mock.results[0].value
    process.listeners.data(Array.from({ length: 1200 }, (_, index) => `LINE_${index}\r\n`).join(''))
    await vi.runAllTimersAsync()
    expect((await attach(manager, entry)).snapshot).toContain('LINE_0\r\n')
    expect(() => manager.setScrollback(1)).toThrow()
    manager.setScrollback(1000)
    const restored = await attach(manager, entry)
    expect(restored.snapshot).not.toContain('LINE_0\r\n')
    expect(restored.snapshot).toContain('LINE_1199')
    await manager.close(entry.id)
  })
  it('closes only the requested process tree and unsubscribes', async () => {
    const manager = new TerminalManager(vi.fn())
    const a = options(),
      b = options()
    await manager.create(a, settings)
    await manager.create(b, settings)
    const closing = manager.close(a.id)
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.spawn.mock.results[0].value.resize).not.toHaveBeenCalled()
    await closing
    expect(() => manager.resize(a.id, 80, 24)).not.toThrow()
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.spawn.mock.results[0].value.dispose).toHaveBeenCalledTimes(2)
    expect(manager.isLive(b.id)).toBe(true)
  })
  it('waits for in-flight creation and closes only the removed workspace', async () => {
    const manager = new TerminalManager(vi.fn())
    const other = {
      ...options(),
      projectPath: '/tmp/other',
      cwd: '/tmp/other',
      workspaceId: '22222222-2222-4222-8222-222222222222',
    }
    await manager.create(other, settings)
    const sibling = { ...options(), workspaceId: randomUUID() }
    await manager.create(sibling, settings)
    const entry = { ...options(), ...agentLaunch() }
    let finish!: (path: string) => void
    mocks.directory.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const creating = manager.create(entry, settings)
    const closing = manager.closeWorkspace(entry)
    expect(mocks.stop).not.toHaveBeenCalled()
    await Promise.resolve()
    finish('/tmp/project')
    await creating
    await closing
    expect(manager.isLive(entry.id)).toBe(false)
    expect(manager.isLive(other.id)).toBe(true)
    expect(manager.isLive(sibling.id)).toBe(true)
    expect(mocks.stop).toHaveBeenCalledOnce()
  })
  it('closes every workspace in a project while preserving other projects', async () => {
    const manager = new TerminalManager(vi.fn())
    const first = options()
    const second = { ...options(), workspaceId: randomUUID() }
    const other = { ...options(), projectPath: '/tmp/other', cwd: '/tmp/other' }
    await manager.create(first, settings)
    await manager.create(second, settings)
    await manager.create(other, settings)
    await manager.closeProject('/tmp/project')
    expect(manager.isLive(first.id)).toBe(false)
    expect(manager.isLive(second.id)).toBe(false)
    expect(manager.isLive(other.id)).toBe(true)
    expect(mocks.stop).toHaveBeenCalledTimes(2)
  })
  it('preserves sessions after workspace cleanup fails so removal can be retried', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    await manager.create(entry, settings)
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.closeWorkspace(entry)).rejects.toThrow('permission denied')
    expect(manager.isLive(entry.id)).toBe(true)
    await manager.closeWorkspace(entry)
    expect(manager.isLive(entry.id)).toBe(false)
  })
  it('frees a failed creation slot and exposes invalid-directory errors', async () => {
    const manager = new TerminalManager(vi.fn())
    const entry = options()
    mocks.directory.mockRejectedValueOnce(new Error('项目目录不可访问'))
    await expect(manager.create(entry, settings)).rejects.toThrow('不可访问')
    await manager.create(entry, settings)
    expect(manager.isLive(entry.id)).toBe(true)
  })
  it('prevents new spawns while shutting down an in-flight creation', async () => {
    const manager = new TerminalManager(vi.fn())
    const creation = manager.create(options(), settings)
    const shutdown = manager.shutdown()
    await expect(creation).rejects.toThrow('正在退出')
    await shutdown
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('does not silently discard a session when process cleanup fails', async () => {
    const updates = vi.fn()
    const manager = new TerminalManager(vi.fn(), updates)
    const entry = { ...options(), ...agentLaunch() }
    await manager.create(entry, settings)
    mocks.stop.mockRejectedValueOnce(new Error('permission denied'))
    await expect(manager.shutdown()).rejects.toThrow('permission denied')
    expect(manager.hasLive()).toBe(true)
    expect((await manager.list())[0].agent).toMatchObject({
      runtimeState: 'running',
      launchId: entry.launchId,
      activityState: 'unknown',
      observability: 'unavailable',
      observabilityReason: expect.stringContaining('关闭失败'),
    })
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ runtimeState: 'running' }),
      }),
    )
    manager.write(entry.id, 'save before retry\r')
    manager.resize(entry.id, 100, 30)
    expect(mocks.spawn.mock.results[0].value.write).toHaveBeenCalledWith('save before retry\r')
    expect(mocks.spawn.mock.results[0].value.resize).toHaveBeenCalledWith(100, 30)
    expect(await manager.needsCloseConfirmation(entry.id)).toBe(true)
    await manager.close(entry.id)
    const exiting = { ...options(), ...agentLaunch() }
    await manager.create(exiting, settings)
    mocks.stop.mockImplementationOnce(async () => {
      mocks.spawn.mock.results[1].value.listeners.exit({ exitCode: 9 })
      throw new Error('descendant cleanup failed')
    })
    await expect(manager.close(exiting.id)).rejects.toThrow('descendant cleanup failed')
    expect((await manager.list())[0].agent).toMatchObject({ runtimeState: 'exited', exitCode: 9 })
    expect(() => manager.write(exiting.id, 'no')).toThrow('已退出')
    await manager.close(exiting.id)
  })
})
