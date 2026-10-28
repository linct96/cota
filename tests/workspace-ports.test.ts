import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { requireOwnedPort } from '../src/main/ports/workspace-ports'
import { terminatePortProcess } from '../src/main/ports/terminate-port-process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  attributePorts,
  parseEndpoint,
  parseLsofDirectories,
  parseLsofPorts,
  parseNetstatPorts,
  portAccess,
  scanLocalPorts,
} from '../src/main/ports/local-ports'
import {
  parseProcessSnapshot,
  readProcessSnapshot,
  type ProcessIdentity,
} from '../src/main/system/process-snapshot'
import type { PortScanContext } from '../src/shared/workspace-ports'

it('parses numeric TCP listeners without confusing connections, IPv6 or URLs', () => {
  expect(parseLsofPorts('p12\ncnode\nf18\ntIPv4\nn*:3000\nf19\ntIPv6\nn[::1]:3000\n')).toEqual([
    { pid: 12, address: '0.0.0.0', port: 3000 },
    { pid: 12, address: '::1', port: 3000 },
  ])
  expect(
    parseNetstatPorts(
      '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12\r\n  TCP    [::]:443    [::]:0    LISTENING    13\r\n  TCP    127.0.0.1:4000    127.0.0.1:3000    ESTABLISHED    14\r\n',
    ),
  ).toEqual([
    { pid: 12, address: '0.0.0.0', port: 3000 },
    { pid: 13, address: '::', port: 443 },
  ])
  expect(parseLsofPorts('')).toEqual([])
  expect(parseLsofDirectories('p12\nfcwd\nn/tmp/space here\n')).toEqual(
    new Map([[12, '/tmp/space here']]),
  )
  expect(portAccess('0.0.0.0', 3000)).toEqual({
    connectAddress: '127.0.0.1:3000',
    httpUrl: 'http://127.0.0.1:3000/',
  })
  expect(portAccess('::', 3000).httpUrl).toBe('http://[::1]:3000/')
  expect(portAccess('fe80::1%en0', 3000)).toEqual({ connectAddress: '[fe80::1%en0]:3000' })
  for (const address of [
    'localhost:3000',
    '127.0.0.1:0',
    '127.0.0.1:65536',
    '127.0.0.1:80/redirect',
  ])
    expect(() => parseEndpoint(address)).toThrow()
  expect(() => portAccess('127.0.0.1@evil.example', 3000)).toThrow()
  expect(
    parseProcessSnapshot('   12 1 Tue Oct 27 10:00:00 2026 /usr/local/bin/node\n')[0],
  ).toMatchObject({ pid: 12, parent: 1, command: '/usr/local/bin/node' })
})

it('prefers verified terminal ancestry and leaves reused, ambiguous or unrelated processes unassigned', () => {
  const cwd = join(process.cwd(), 'ports-fixture')
  const started = '2026-10-27T10:00:00Z'
  const context: PortScanContext = {
    workspaces: [
      { projectPath: cwd, workspaceId: 'a', name: 'A', cwd },
      { projectPath: cwd, workspaceId: 'nested', name: 'Nested', cwd: join(cwd, 'nested') },
    ],
    roots: [{ projectPath: cwd, workspaceId: 'a', terminalId: 'terminal', cwd, pid: 10, started }],
  }
  const before: ProcessIdentity[] = [
    { pid: 10, parent: 1, command: 'zsh', started },
    ...[11, 12, 13, 14, 15].map((pid) => ({
      pid,
      parent: pid === 11 ? 10 : 1,
      command: 'node',
      started: '2026-10-27T10:01:00Z',
    })),
  ]
  const after = before.map((row) =>
    row.pid === 14 ? { ...row, started: '2026-10-27T10:02:00Z' } : row,
  )
  const directories = new Map([
    [11, join(cwd, 'nested')],
    [12, join(cwd, 'nested', 'src')],
    [13, `${cwd}-sibling`],
    [14, cwd],
  ])
  const listeners = [11, 12, 13, 14, 15].map((pid) => ({
    pid,
    address: '127.0.0.1',
    port: 3000 + pid,
  }))
  const rows = attributePorts([...listeners, listeners[0]], before, after, directories, context)
  expect(rows).toHaveLength(5)
  expect(rows[0].owner).toMatchObject({
    workspaceId: 'a',
    terminalId: 'terminal',
    evidence: 'terminal',
  })
  expect(rows[1].owner).toMatchObject({ workspaceId: 'nested', evidence: 'cwd' })
  expect(rows.slice(2).map((row) => row.owner)).toEqual([undefined, undefined, undefined])
  const ambiguous = {
    ...context,
    roots: [],
    workspaces: [...context.workspaces, { ...context.workspaces[1], workspaceId: 'duplicate' }],
  }
  expect(
    attributePorts([listeners[1]], before, after, directories, ambiguous)[0].owner,
  ).toBeUndefined()
  const replacedRoot = after.map((row) =>
    row.pid === 10 ? { ...row, started: '2026-10-27T10:02:00Z' } : row,
  )
  expect(
    attributePorts([listeners[0]], before, replacedRoot, new Map(), context)[0].owner,
  ).toBeUndefined()
  expect(
    attributePorts([listeners[0]], before, after, new Map(), { ...context, workspaces: [] })[0]
      .owner,
  ).toBeUndefined()
})

it('rejects stale, unknown, other-workspace and protected port termination requests', () => {
  const cwd = process.cwd()
  const target = { projectPath: cwd, workspaceId: 'owned' }
  const [port] = attributePorts(
    [{ pid: 42, address: '127.0.0.1', port: 3000 }],
    [{ pid: 42, parent: 1, command: 'node', started: '2026-10-27T10:00:00Z' }],
    [{ pid: 42, parent: 1, command: 'node', started: '2026-10-27T10:00:00Z' }],
    new Map([[42, cwd]]),
    { workspaces: [{ ...target, name: 'Owned', cwd }], roots: [] },
  )
  const snapshot = { scannedAt: Date.now(), ports: [port], warnings: [] }
  expect(requireOwnedPort(snapshot, target, port.id, [])).toBe(port)
  expect(() => requireOwnedPort(snapshot, target, 42, [])).toThrow('端口标识无效')
  expect(() => requireOwnedPort(snapshot, target, 'stale-id', [])).toThrow('身份已变化')
  expect(() =>
    requireOwnedPort(snapshot, { ...target, workspaceId: 'other' }, port.id, []),
  ).toThrow('当前工作区')
  expect(() => requireOwnedPort(snapshot, target, port.id, [42])).toThrow('关键进程')
  expect(() =>
    requireOwnedPort({ ...snapshot, ports: [{ ...port, owner: undefined }] }, target, port.id, []),
  ).toThrow('当前工作区')
  expect(() =>
    requireOwnedPort(
      {
        ...snapshot,
        ports: [
          port,
          { ...port, id: 'shared', owner: { ...target, workspaceId: 'other', evidence: 'cwd' } },
        ],
      },
      target,
      port.id,
      [],
    ),
  ).toThrow('其他工作区')
})

it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')(
  'finds and terminates only an isolated listener with a verified process identity',
  async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const server = require('node:net').createServer();
      server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    `,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const exited = once(child, 'exit')
    try {
      const [output] = await once(child.stdout!, 'data')
      const number = Number(String(output).trim())
      expect(number).toBeGreaterThan(0)
      const identity = (await readProcessSnapshot()).find((row) => row.pid === child.pid)
      expect(identity?.started).toBeTruthy()
      const cwd = process.cwd()
      const target = { projectPath: cwd, workspaceId: 'live' }
      const snapshot = await scanLocalPorts({
        workspaces: [{ ...target, name: 'Live', cwd }],
        roots: [
          {
            ...target,
            cwd,
            terminalId: 'live-terminal',
            pid: child.pid!,
            started: identity!.started,
          },
        ],
      })
      const listener = snapshot.ports.find((row) => row.port === number && row.pid === child.pid)
      expect(listener).toMatchObject({
        address: '127.0.0.1',
        owner: { workspaceId: 'live', terminalId: 'live-terminal', evidence: 'terminal' },
      })
      expect(listener?.httpUrl).toBe(`http://127.0.0.1:${number}/`)
      const port = requireOwnedPort(snapshot, target, listener!.id, [process.pid])
      const changed = JSON.parse(port.id)
      changed[4] = 'reused-process'
      expect(() => terminatePortProcess({ ...port, id: JSON.stringify(changed) })).toThrow(
        '身份已变化',
      )
      expect(child.exitCode).toBeNull()
      terminatePortProcess(port)
      await exited
      const probe = createServer()
      probe.listen(number, '127.0.0.1')
      await once(probe, 'listening')
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
    }
  },
  20000,
)
