import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const run = promisify(execFile)

it.skipIf(process.platform === 'win32')(
  'runs real PTYs with Unicode cwd, terminal size and exit status',
  async ({ signal }) => {
    const shells = [
      '/bin/zsh',
      '/bin/bash',
      '/opt/homebrew/bin/fish',
      '/usr/local/bin/fish',
      '/usr/bin/fish',
    ].filter(existsSync)
    expect(shells.length, 'PTY integration requires an installed POSIX shell').toBeGreaterThan(0)
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'cota 中文 smoke-')))
    try {
      for (const shell of shells) {
        const env = {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: directory,
          XDG_CONFIG_HOME: join(directory, 'config'),
          XDG_DATA_HOME: join(directory, 'data'),
          TERM: 'xterm-256color',
        }
        const input =
          "printf '\\nCOTA_NATIVE_OK\\n'; pwd; stty size; command -v codex; command -v pi; command -v claude; exit 7\r"
        // Only the native PTY driver runs under Electron's ABI; assertions stay in Vitest.
        const driver = `
const { shell, cwd, env, input } = JSON.parse(process.argv[1])
const child = require(${JSON.stringify(require.resolve('node-pty'))}).spawn(shell, ['-il'], {
  cwd, env, cols: 91, rows: 31,
})
let output = '', timedOut = false
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 15000)
child.onData((data) => { output += data })
child.onExit(({ exitCode }) => {
  clearTimeout(timer)
  process.stdout.write(JSON.stringify({ output, exitCode, timedOut }))
})
process.once('SIGTERM', () => child.kill('SIGKILL'))
child.write(input)
`
        const { stdout } = await run(
          require('electron'),
          ['-e', driver, JSON.stringify({ shell, cwd: directory, env, input })],
          {
            cwd: directory,
            env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
            timeout: 20_000,
            signal,
          },
        )
        const result: { output: string; exitCode: number; timedOut: boolean } = JSON.parse(stdout)
        const message = `${shell}\n${result.output}`
        expect(result.timedOut, message).toBe(false)
        expect(result.exitCode, message).toBe(7)
        expect(result.output, message).toContain('COTA_NATIVE_OK')
        expect(result.output, message).toContain(directory)
        expect(result.output, message).toMatch(/31\s+91/)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  65_000,
)
