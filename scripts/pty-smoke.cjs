// Real native-module check, launched with Electron's Node ABI, without Agent credentials.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { mkdtempSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const pty = require('node-pty')
const root = mkdtempSync(path.join(tmpdir(), 'cota 中文 smoke-'))
const shells = ['/bin/zsh', '/bin/bash', '/opt/homebrew/bin/fish'].filter(existsSync)

async function check(shell) {
  const env = { ...process.env, TERM: 'xterm-256color' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  const child = pty.spawn(shell, ['-il'], { cwd: root, env, cols: 91, rows: 31 })
  let output = ''
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    console.error(output)
    process.exitCode = 1
  }, 15000)
  const exit = new Promise((resolve) => child.onExit(resolve))
  child.onData((data) => {
    output += data
  })
  child.write(
    "printf '\\nCOTA_NATIVE_OK\\n'; pwd; stty size; command -v codex; command -v pi; command -v claude; exit 7\r",
  )
  const result = await exit
  clearTimeout(timer)
  assert.equal(result.exitCode, 7, output)
  assert.ok(output.includes('COTA_NATIVE_OK'), output)
  assert.ok(
    output.includes(root.replace(/^\/var\//, '/private/var/')) || output.includes(root),
    output,
  )
  assert.match(output, /31\s+91/, output)
  console.log(`PASS ${shell}: real PTY, Unicode/space cwd, 91x31, exit 7`)
}

;(async () => {
  try {
    for (const shell of shells) await check(shell)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
