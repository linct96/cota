// Real Electron ABI / PTY reconnect check, without invoking Agent CLIs.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { connect } = require('node:net')
const { randomBytes, randomUUID } = require('node:crypto')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
if (process.argv[2] === '--launch-host') {
  const [, , , directory, token, runtime, entry] = process.argv
  const child = spawn(runtime, [entry], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      COTA_HOST_DIRECTORY: directory,
      COTA_HOST_TOKEN: token,
    },
  })
  child.once('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.once('spawn', () => {
    console.log(child.pid)
    child.unref()
  })
} else {
  const packaged = process.argv.includes('--packaged')
  const bundle = join(__dirname, '../release/mac-arm64/Cota.app/Contents')
  const runtime = packaged ? join(bundle, 'MacOS/Cota') : process.execPath
  const entry = packaged
    ? join(bundle, 'Resources/app.asar/out/main/host.js')
    : join(__dirname, '../out/main/host.js')
  const directory = mkdtempSync(join(tmpdir(), 'chs-'))
  const token = randomBytes(32).toString('hex')
  const clients = []
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  let hostPid
  async function open() {
    const socket = connect(join(directory, 'host.sock'))
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    socket.setEncoding('utf8')
    let buffer = '',
      nextId = 0,
      output = ''
    const pending = new Map()
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer)
        reject(new Error('Host socket closed'))
      }
      pending.clear()
    })
    const client = {
      socket,
      get output() {
        return output
      },
      request(method, args = []) {
        return new Promise((resolve, reject) => {
          const id = ++nextId
          const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timeout: ${method}`))
          }, 15000)
          pending.set(id, { resolve, reject, timer })
          socket.write(JSON.stringify({ type: 'request', id, method, args }) + '\n')
        })
      },
    }
    socket.on('data', (chunk) => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
        if (message.type === 'event') {
          if (message.event.type === 'data') {
            output += message.event.data
            void client
              .request('acknowledge', [
                message.event.id,
                message.event.attachmentId,
                message.event.data.length,
              ])
              .catch(() => {})
          }
        } else {
          const request = pending.get(message.id)
          if (!request) continue
          pending.delete(message.id)
          clearTimeout(request.timer)
          if (message.ok) request.resolve(message.value)
          else request.reject(new Error(message.error))
        }
      }
    })
    clients.push(client)
    await client.request('hello', [token, 2])
    return client
  }
  async function until(check) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await check()) return
      await wait(100)
    }
    throw new Error('Host smoke condition timed out')
  }
  ;(async () => {
    try {
      // The launcher exits before any client connects, proving the Host outlives its owner.
      const launcher = spawnSync(
        process.execPath,
        [__filename, '--launch-host', directory, token, runtime, entry],
        {
          encoding: 'utf8',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      )
      assert.equal(launcher.status, 0, launcher.stderr)
      hostPid = Number(launcher.stdout.trim())
      assert.ok(hostPid > 0)
      let first
      await until(async () => {
        try {
          first = await open()
          return true
        } catch (error) {
          if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
          return false
        }
      })
      const options = {
        id: randomUUID(),
        workspaceId: randomUUID(),
        projectPath: directory,
        cwd: require('node:fs').realpathSync(directory),
        workspaceKind: 'local',
        cols: 91,
        rows: 31,
      }
      await first.request('create', [
        options,
        { shellPath: '/bin/bash', scrollback: 1000, openWith: [] },
      ])
      const original = await first.request('attach', [{ ...options, attachmentId: randomUUID() }])
      assert.equal(original.cols, 91)
      await first.request('write', [options.id, 'printf \'\\nCOTA_SHELL_PID=%s\\n\' "$$"\r'])
      await until(() => /COTA_SHELL_PID=(\d+)/.test(first.output))
      const shellPid = /COTA_SHELL_PID=(\d+)/.exec(first.output)[1]
      await first.request('write', [
        options.id,
        "printf '\\033[?1049h\\033[2J\\033[4;9HCOTA_TUI_ACTIVE'\r",
      ])
      await until(() => first.output.includes('\x1b[4;9HCOTA_TUI_ACTIVE'))
      first.socket.destroy()
      const second = await open()
      assert.equal((await second.request('list'))[0].id, options.id)
      const attachmentId = randomUUID()
      const restored = await second.request('attach', [{ ...options, attachmentId }])
      const { Terminal } = require('@xterm/headless')
      const terminal = new Terminal({
        cols: restored.cols,
        rows: restored.rows,
        allowProposedApi: true,
      })
      await new Promise((resolve) => terminal.write(restored.snapshot, resolve))
      assert.equal(terminal.buffer.active.type, 'alternate')
      assert.ok(terminal.buffer.active.getLine(3).translateToString().includes('COTA_TUI_ACTIVE'))
      terminal.dispose()
      await second.request('detach', [options.id, attachmentId])
      await second.request('write', [
        options.id,
        "printf '\\033[?1049l'; for ((i=0;i<16000;i++)); do printf 'detached output %05d\\n' \"$i\"; done; printf '\\nCOTA_DONE_PID=%s\\n' \"$$\"; exit 7\r",
      ])
      await until(async () => (await second.request('list'))[0].exited)
      const final = await second.request('attach', [{ ...options, attachmentId: randomUUID() }])
      assert.equal(final.exitCode, 7)
      assert.ok(
        final.snapshot.includes(`COTA_DONE_PID=${shellPid}`),
        'must resume the original shell, without detached output blocking it',
      )
      await second.request('shutdown')
      console.log(
        `PASS ${packaged ? 'packaged' : 'built'} Host: owner exit, same shell PID, client reconnect, alternate-screen restoration, detached backpressure, exit 7`,
      )
    } finally {
      for (const client of clients) client.socket.destroy()
      if (hostPid) {
        try {
          process.kill(hostPid, 'SIGTERM')
        } catch (error) {
          if (error.code !== 'ESRCH') {
            console.error(error)
            process.exitCode = 1
          }
        }
        await until(() => {
          try {
            process.kill(hostPid, 0)
            return false
          } catch (error) {
            return error.code === 'ESRCH'
          }
        })
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
