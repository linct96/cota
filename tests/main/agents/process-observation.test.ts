import { mocks, options, settings } from '../terminal/terminal.fixture'
import { describe, expect, it, vi } from 'vitest'
import {
  agentOwner,
  foregroundAgent,
  recognizeNodeAgent,
} from '../../../src/main/agents/runtime/process-observation'
import type { TerminalManager } from '../../../src/main/terminal/manager'

import { backgroundRows, codexRows, rows } from './agent-process.fixture'
import type * as ProcessObservationModule from '../../../src/main/agents/runtime/process-observation'

describe('Agent process observation', () => {
  it('resolves foreground ownership without accepting background or ambiguous Agents', () => {
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
    ).toMatchObject({ provider: 'codex', process: { pid: 60000 } })
    expect(
      foregroundAgent([{ ...codexRows[0], foreground: 98765, command: 'codex' }], 98765)?.owner.pid,
    ).toBe(98765)
    expect(foregroundAgent(backgroundRows, 98765)).toBeUndefined()
  })

  it('reads only candidate Node arguments and rejects process reuse or inaccessible arguments', async () => {
    const { agentProcesses: readProcesses } = await vi.importActual<
      typeof ProcessObservationModule
    >('../../../src/main/agents/runtime/process-observation')
    const nodeSnapshot =
      '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026 /bin/fish\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026 /usr/bin/node\n60001 60000 60000 60000 S Mon Oct 19 10:01:01 2026 Electron\n60002 60001 60000 60000 S Mon Oct 19 10:01:02 2026 /usr/bin/node\n70000 1 70000 70000 S Mon Oct 19 10:01:00 2026 /usr/bin/node'
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
    expect(mocks.exec.mock.calls.at(-1)![1]).not.toContain('60002')
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
  })

  it('limits Windows discovery to terminal jobs and CLI shims, clearing exited CLI processes', async () => {
    const row = (pid: number, parent: number, command: string) => ({
      pid,
      parent,
      command,
      group: pid,
      foreground: pid,
      stat: 'S',
      started: '2026-10-19T10:00:00.0000000Z',
    })
    const root = row(98765, 1, 'powershell.exe')
    const shim = row(60000, root.pid, 'cmd.exe')
    const cli = row(60001, shim.pid, 'node.exe')
    const background = [
      root,
      shim,
      cli,
      row(60002, cli.pid, 'Electron.exe'),
      row(60003, 60002, 'claude.exe'),
      row(60004, 60002, 'node.exe'),
    ]
    vi.resetModules()
    vi.doMock('../../../src/main/system/platform', async (original) => ({
      ...(await original<object>()),
      isWindows: true,
    }))
    vi.doMock('../../../src/main/system/windows-processes', async (original) => ({
      ...(await original<object>()),
      windowsProcesses: () => Promise.resolve(background),
    }))
    let manager: TerminalManager | undefined
    try {
      const observation = await vi.importActual<typeof ProcessObservationModule>(
        '../../../src/main/agents/runtime/process-observation',
      )
      expect(observation.foregroundAgent(background, root.pid)).toBeUndefined()
      mocks.exec.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            ...cli,
            command: 'node.exe C:/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
          },
        ]),
      })
      const identified = await observation.agentProcesses(true, [root.pid])
      expect(mocks.exec.mock.calls.at(-1)![2].env.COTA_PROCESS_FILTER).toBe('ProcessId = 60001')
      expect(observation.foregroundAgent(identified, root.pid)).toMatchObject({
        provider: 'pi',
        owner: { pid: shim.pid },
        process: { pid: cli.pid },
      })
      vi.doMock('../../../src/main/agents/runtime/process-observation', () => ({
        ...observation,
        agentProcesses: mocks.processes,
      }))
      const { TerminalManager: WindowsManager } = await import('../../../src/main/terminal/manager')
      manager = new WindowsManager(vi.fn(), vi.fn(), '/tmp/cota-test/agent.sock')
      const entry = options()
      mocks.processes.mockResolvedValue(background)
      await manager.create(entry, settings)
      await vi.advanceTimersByTimeAsync(350)
      expect((await manager.list())[0].agent).toBeUndefined()
      mocks.processes.mockResolvedValue(identified)
      manager.write(entry.id, 'pi\r')
      await vi.advanceTimersByTimeAsync(350)
      expect((await manager.list())[0].agent).toMatchObject({ provider: 'pi' })
      mocks.processes.mockResolvedValue([root, shim])
      await vi.advanceTimersByTimeAsync(750)
      expect((await manager.list())[0].agent).toBeUndefined()
    } finally {
      await manager?.shutdown()
      vi.doUnmock('../../../src/main/system/platform')
      vi.doUnmock('../../../src/main/system/windows-processes')
      vi.doMock('../../../src/main/agents/runtime/process-observation', async (original) => ({
        ...(await original<object>()),
        agentProcesses: mocks.processes,
      }))
      vi.resetModules()
    }
  })
})
