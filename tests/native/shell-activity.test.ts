import { root } from '../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { promisify } from 'node:util'
import { inspectAgentHook } from '../../src/main/agents/hooks/managed'
import { prepareAgentShell } from '../../src/main/agents/hooks/shell-integration'
import type * as ChildProcessModule from 'node:child_process'

describe('Real interactive Shell markers', () => {
  it('reports command and prompt activity in real session-only Bash, Zsh and Fish PTYs', async () => {
    const run = promisify(
      (await vi.importActual<typeof ChildProcessModule>('node:child_process')).execFile,
    )
    await writeFile(
      join(root, '.bash_profile'),
      'PROMPT_COMMAND=\'printf "COTA_PROMPT:%s\\\\n" "$?"\'\n',
    )
    await writeFile(join(root, '.zshrc'), '')
    await mkdir(join(root, 'config', 'fish'), { recursive: true })
    await writeFile(join(root, 'config', 'fish', 'config.fish'), '')
    const require = createRequire(import.meta.url)
    // node-pty is built for Electron's ABI, not the test runner's Node ABI.
    const driver = `
const { shell, args, env, cwd, input } = JSON.parse(process.argv[1])
const child = require(${JSON.stringify(require.resolve('node-pty'))}).spawn(shell, args, { env, cwd, cols: 91, rows: 31 })
process.stdout.write('COTA_PTY_PID:' + child.pid + '\\n')
const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
child.onData((data) => process.stdout.write(data))
child.onExit(({ exitCode, signal }) => { clearTimeout(timer); process.exitCode = signal ? 1 : exitCode })
process.on('SIGTERM', () => { child.kill(); process.exit(1) })
child.write(input)
`
    for (const name of ['bash', 'zsh', 'fish']) {
      let shell: string | undefined
      for (const candidate of name === 'fish'
        ? ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish']
        : [`/bin/${name}`]) {
        shell = await realpath(candidate).catch(() => undefined)
        if (shell) break
      }
      if (!shell) continue
      const env: Record<string, string> = {
        HOME: root,
        PATH: '/usr/bin:/bin',
        TERM: 'dumb',
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
        COTA_SHELL_ACTIVITY: 'a'.repeat(64),
      }
      const args = await prepareAgentShell(shell, env, join(root, 'runtime'))
      expect(args).toBeDefined()
      const input = [
        'printf "COTA_BUILTIN\\n"',
        'sleep 0.02',
        'false',
        `printf "COTA_STATUS:%s\\n" "$${name === 'fish' ? 'status' : '?'}"`,
        'sleep 0.02 &',
        'printf "COTA_BACKGROUND\\n"',
        'wait',
        'exit',
        '',
      ].join('\r')
      const { stdout } = await run(
        require('electron'),
        ['-e', driver, JSON.stringify({ shell, args, env, cwd: root, input })],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: root, timeout: 5000 },
      )
      const pid = Number(/COTA_PTY_PID:(\d+)/.exec(stdout)?.[1])
      expect(pid).toBeGreaterThan(0)
      const markers = [
        // oxlint-disable-next-line no-control-regex -- OSC markers contain ESC and BEL.
        ...stdout.matchAll(/\u001b\]133;([CD]);Cota=([a-f0-9]{64});Shell=(\d+)\u0007/g),
      ]
      expect(
        markers
          .map((marker) => marker[1])
          .filter((state, index, states) => index === 0 || state !== states[index - 1]),
        name,
      ).toEqual(['D', 'C', 'D', 'C', 'D', 'C', 'D', 'C', 'D', 'C', 'D', 'C', 'D', 'C', 'D', 'C'])
      expect(
        markers.every(
          (marker) => marker[2] === env.COTA_SHELL_ACTIVITY && Number(marker[3]) === pid,
        ),
        name,
      ).toBe(true)
      expect(stdout, name).toContain('COTA_STATUS:1')
      expect(stdout, name).toContain('COTA_BACKGROUND')
      if (name === 'bash') expect(stdout).toContain('COTA_PROMPT:1')
      expect((await inspectAgentHook('codex', env)).state).toBe('missing')
    }
  })
})
