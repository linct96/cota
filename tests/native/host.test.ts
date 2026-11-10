import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { Terminal } from '@xterm/headless'
import { expect, it, vi } from 'vitest'
import { HostClient } from '../../src/main/host/host-client'
import { HOST_PROTOCOL } from '../../src/main/host/host-protocol'
import { hostEndpoint, isWindows, powershell } from '../../src/main/system/platform'
import { stopProcessTree } from '../../src/main/system/process-tree'
import { DEFAULT_CONFIG } from '../../src/shared/contracts'

const require = createRequire(import.meta.url)
const run = promisify(execFile)
const packaged = process.env.COTA_TEST_PACKAGED === '1'
const root = resolve(import.meta.dirname, '../..')
const poll = { timeout: isWindows ? 60_000 : 15_000, interval: 100 }

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return false
  }
}

it(`reconnects a ${packaged ? 'packaged' : 'built'} Host without replacing its shell or losing output`, async ({
  onTestFinished,
  signal,
}) => {
  if (!packaged) {
    const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
    const build = await run(process.execPath, [cli, 'build'], {
      cwd: root,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    })
    console.info(build.stdout.trim())
  }
  const bundle = join(
    root,
    isWindows ? 'release/win-unpacked' : 'release/mac-arm64/Cota.app/Contents',
  )
  const runtime: string = packaged
    ? join(bundle, isWindows ? 'Cota.exe' : 'MacOS/Cota')
    : require('electron')
  const entry = packaged
    ? join(
        bundle,
        isWindows ? 'resources/app.asar/out/main/host.js' : 'Resources/app.asar/out/main/host.js',
      )
    : join(root, 'out/main/host.js')
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chs-')))
  const token = randomBytes(32).toString('hex')
  const clients: HostClient[] = []
  // Cleanup is registered before launch and must also handle a failed launch.
  let hostPid: number | undefined = undefined

  async function open() {
    const socket = connect(hostEndpoint(directory, 'host'))
    socket.setTimeout(15_000, () => socket.destroy(new Error('Host request timed out')))
    let output = ''
    const client = new HostClient(socket, (event) => {
      if (event.type !== 'data') return
      output += event.data
      void client
        .request('acknowledge', [event.id, event.attachmentId, event.data.length])
        .catch(() => {})
    })
    clients.push(client)
    try {
      await once(socket, 'connect')
      await client.request('hello', [token, HOST_PROTOCOL])
      return {
        client,
        get output() {
          return output
        },
      }
    } catch (error) {
      client.disconnect()
      throw error
    }
  }

  onTestFinished(
    async () => {
      try {
        const pid = hostPid
        if (pid && alive(pid)) {
          try {
            const { client } = await open()
            await client.request('shutdown', [])
            await expect.poll(() => alive(pid), poll).toBe(false)
          } catch {
            if (alive(pid)) {
              const { stdout } = isWindows
                ? await run(
                    powershell,
                    [
                      '-NoProfile',
                      '-NonInteractive',
                      '-Command',
                      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
                    ],
                    { windowsHide: true, timeout: 5000 },
                  )
                : await run('/bin/ps', ['-p', String(pid), '-o', 'command='], { timeout: 2000 })
              const commands = [
                `${runtime} ${entry}`,
                `"${runtime}" ${entry}`,
                `${runtime} "${entry}"`,
                `"${runtime}" "${entry}"`,
              ]
              expect(
                isWindows ? commands.map((command) => command.toLowerCase()) : commands,
                'refuse to stop an unknown Host',
              ).toContain(isWindows ? stdout.trim().toLowerCase() : stdout.trim())
              await stopProcessTree(pid)
            }
          }
          await expect.poll(() => alive(pid), poll).toBe(false)
        }
      } finally {
        for (const client of clients) client.disconnect()
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
    isWindows ? 90_000 : 35_000,
  )

  // The short-lived owner exits before any client connects, proving the Host outlives it.
  const launcher = await run(
    process.execPath,
    [
      '-e',
      `
const { spawn } = require('node:child_process')
const child = spawn(process.argv[1], [process.argv[2]], {
  detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
})
child.once('error', (error) => { console.error(error); process.exitCode = 1 })
child.once('spawn', () => { console.log(child.pid); child.unref() })
`,
      runtime,
      entry,
    ],
    {
      timeout: 10_000,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        COTA_HOST_DIRECTORY: directory,
        COTA_HOST_TOKEN: token,
        HOME: directory,
        USERPROFILE: directory,
        XDG_CONFIG_HOME: join(directory, 'config'),
        XDG_DATA_HOME: join(directory, 'data'),
        CODEX_HOME: join(directory, '.codex'),
        CLAUDE_CONFIG_DIR: join(directory, '.claude'),
        PI_CODING_AGENT_DIR: join(directory, '.pi', 'agent'),
        GROK_HOME: join(directory, '.grok'),
      },
    },
  )
  const pid = Number(launcher.stdout.trim())
  expect(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid).toBe(true)
  hostPid = pid
  expect(alive(pid)).toBe(true)
  const first = await vi.waitUntil(async () => {
    signal.throwIfAborted()
    try {
      return await open()
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error
      return false
    }
  }, poll)
  const options = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    projectPath: directory,
    cwd: directory,
    workspaceKind: 'local' as const,
    cols: 91,
    rows: 31,
  }
  const preferences = {
    ...DEFAULT_CONFIG.preferences,
    shellPath: isWindows ? null : '/bin/bash',
    scrollback: 1000,
    openWith: [],
  }
  await first.client.request('create', [options, preferences])
  const original = await first.client.request('attach', [
    { ...options, attachmentId: randomUUID() },
  ])
  expect(original.cols).toBe(91)
  expect(original.rows).toBe(31)
  await first.client.request('write', [
    options.id,
    isWindows
      ? "[Console]::WriteLine('COTA_SHELL_PID='+$PID)\r"
      : 'printf \'\\nCOTA_SHELL_PID=%s\\n\' "$$"\r',
  ])
  await expect.poll(() => first.output, poll).toMatch(/COTA_SHELL_PID=(\d+)/)
  const shellPid = Number(/COTA_SHELL_PID=(\d+)/.exec(first.output)![1])
  await first.client.request('write', [
    options.id,
    isWindows
      ? "[Console]::Write(([char]27)+'[?1049h'+([char]27)+'[2J'+([char]27)+'[4;9H'+'COTA_TUI_'+'ACTIVE'); Start-Sleep -Seconds 30\r"
      : "printf '\\033[?1049h\\033[2J\\033[4;9HCOTA_TUI_ACTIVE'\r",
  ])
  await expect
    .poll(() => first.output, poll)
    .toContain(isWindows ? 'COTA_TUI_ACTIVE' : '\x1b[4;9HCOTA_TUI_ACTIVE')
  first.client.disconnect()
  const second = await open()
  expect((await second.client.request('list', []))[0].id).toBe(options.id)
  const attachmentId = randomUUID()
  const restored = await second.client.request('attach', [{ ...options, attachmentId }])
  const terminal = new Terminal({
    cols: restored.cols,
    rows: restored.rows,
    allowProposedApi: true,
  })
  try {
    await new Promise<void>((complete) => terminal.write(restored.snapshot, complete))
    expect(terminal.buffer.active.type).toBe('alternate')
    expect(terminal.buffer.active.getLine(3)!.translateToString()).toContain('COTA_TUI_ACTIVE')
  } finally {
    terminal.dispose()
  }
  if (isWindows) {
    await second.client.request('write', [options.id, '\x03'])
    await delay(300)
  }
  await second.client.request('detach', [options.id, attachmentId])
  await second.client.request('write', [
    options.id,
    isWindows
      ? "[Console]::Write(([char]27)+'[?1049l'); for ($i=0; $i -lt 16000; $i++) { [Console]::WriteLine('detached output '+$i) }; [Console]::WriteLine('COTA_DONE_PID='+$PID); exit 7\r"
      : "printf '\\033[?1049l'; for ((i=0;i<16000;i++)); do printf 'detached output %05d\\n' \"$i\"; done; printf '\\nCOTA_DONE_PID=%s\\n' \"$$\"; exit 7\r",
  ])
  await expect
    .poll(async () => (await second.client.request('list', []))[0]?.exited, poll)
    .toBe(true)
  const final = await second.client.request('attach', [{ ...options, attachmentId: randomUUID() }])
  expect(final.exitCode).toBe(7)
  expect(
    final.snapshot,
    'must resume the original shell without detached output blocking it',
  ).toContain(`COTA_DONE_PID=${shellPid}`)
  if (isWindows) {
    const cleanup = { ...options, id: randomUUID() }
    await second.client.request('create', [cleanup, preferences])
    await second.client.request('attach', [{ ...cleanup, attachmentId: randomUUID() }])
    await second.client.request('write', [cleanup.id, 'ping.exe -t 127.0.0.1\r'])
    await expect.poll(() => second.output, poll).toContain('127.0.0.1')
    await expect
      .poll(() => second.client.request('needsCloseConfirmation', [cleanup.id]), poll)
      .toBe(true)
    await second.client.request('close', [cleanup.id])
    expect(
      (await second.client.request('list', [])).some((session) => session.id === cleanup.id),
    ).toBe(false)
  }
  await second.client.request('shutdown', [])
  await expect.poll(() => alive(pid), poll).toBe(false)
  expect(alive(shellPid)).toBe(false)
}, 185_000)
