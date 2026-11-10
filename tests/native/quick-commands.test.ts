import { root } from '../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { promisify } from 'node:util'
import { savedQuickCommands, startupCommand } from '../../src/main/validation'
import { inspectAgentHook } from '../../src/main/agents/hooks/managed'
import { prepareAgentShell } from '../../src/main/agents/hooks/shell-integration'
import { prepareFishStartupInput } from '../../src/main/terminal/fish-startup'
import type * as ChildProcessModule from 'node:child_process'

describe('Real quick command startup and Fish history', () => {
  it('runs a quick command once and submits Fish through its native editor with history and interruption', async () => {
    const unicode = '中文'.repeat(200)
    const command = `printf '%s\\n' "$COTA_TEST_PROFILE" '${unicode} ; $(touch nope)' >> 'startup output'\nprintf '%s\\n' done >> 'startup output'`
    const definition = {
      id: 'dev',
      name: ' 开发服务 ',
      command,
      scope: { type: 'project', projectPath: root },
    }
    expect(savedQuickCommands([])).toEqual([])
    expect(savedQuickCommands([definition])[0].name).toBe('开发服务')
    expect(startupCommand('echo one\r\necho two\r')).toBe('echo one\necho two\n')
    for (const invalid of [
      undefined,
      [definition, definition],
      [{ ...definition, id: '../bad' }],
      [{ ...definition, command: '\u001b[31m' }],
      [{ ...definition, command: ' ' }],
      [{ ...definition, command: 'a'.repeat(8193) }],
      [{ ...definition, scope: { type: 'project', projectPath: 'relative' } }],
    ])
      expect(() => savedQuickCommands(invalid)).toThrow()
    const run = promisify(
      (await vi.importActual<typeof ChildProcessModule>('node:child_process')).execFile,
    )
    await writeFile(
      join(root, '.bash_profile'),
      'export COTA_TEST_PROFILE=ready\nPS1="COTA_PROMPT> "\n',
    )
    await writeFile(join(root, '.zprofile'), 'export COTA_TEST_PROFILE=ready\n')
    await writeFile(
      join(root, '.zshrc'),
      `PS1='COTA_PROMPT> '
HISTFILE="$HOME/history"; HISTSIZE=100; SAVEHIST=100
__cota_test_line_init() { printf 'called\\n' >> "$HOME/line-init"; }
zle -N zle-line-init __cota_test_line_init
`,
    )
    await mkdir(join(root, 'config', 'fish'), { recursive: true })
    await writeFile(
      join(root, 'config', 'fish', 'config.fish'),
      'set -gx COTA_TEST_PROFILE ready\nset -g fish_greeting\nfunction fish_prompt; printf "COTA_PROMPT> "; end\n',
    )
    for (const name of ['bash', 'zsh', 'fish']) {
      const env: Record<string, string> = {
        HOME: root,
        PATH: '/usr/bin:/bin',
        TERM: 'dumb',
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
      }
      const args = await prepareAgentShell(`/bin/${name}`, env, join(root, 'runtime'), command)
      expect(args).toBeDefined()
      expect((await inspectAgentHook('codex', env)).state).toBe('missing')
      let shell: string | undefined
      for (const candidate of name === 'fish'
        ? ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish']
        : [`/bin/${name}`]) {
        shell = await realpath(candidate).catch(() => undefined)
        if (shell) break
      }
      if (!shell) continue
      if (name !== 'fish') {
        const { stdout } = await run(shell, [...args!, '-c', 'printf COTA_AFTER_STARTUP; env'], {
          env,
          cwd: root,
          timeout: 5000,
        })
        expect(stdout).toContain('COTA_AFTER_STARTUP')
        expect(stdout).not.toContain('COTA_STARTUP_COMMAND=')
        expect(await readFile(join(root, 'startup output'), 'utf8')).toBe(
          `ready\n${unicode} ; $(touch nope)\ndone\n`,
        )
        expect(await readdir(root)).not.toContain('nope')
        await rm(join(root, 'startup output'))
      }
      {
        const require = createRequire(import.meta.url)
        const ptyEnv = {
          ...env,
          ZDOTDIR: root,
          HISTFILE: join(root, 'history'),
          TERM: 'xterm-256color',
          COTA_SHELL_ACTIVITY: 'a'.repeat(64),
        }
        await writeFile(ptyEnv.HISTFILE, 'echo COTA_OLDER_COMMAND\n')
        const startupInput = `${command}\nsh -c 'printf "COTA_%s\\n" RUNNING; exec sleep 30'`
        const ptyArgs = await prepareAgentShell(shell, ptyEnv, join(root, 'runtime'), startupInput)
        if (name === 'fish') expect(ptyEnv).not.toHaveProperty('COTA_STARTUP_COMMAND')
        const driver = `
const { shell, args, env, cwd, startupCommand } = JSON.parse(process.argv[1])
const child = require(${JSON.stringify(require.resolve('node-pty'))}).spawn(shell, args, { env, cwd, cols: 91, rows: 31 })
// Fish negotiates terminal capabilities before initialization, as it does with the real Host.
const { Terminal } = require(${JSON.stringify(require.resolve('@xterm/headless'))})
const screen = new Terminal({ cols: 91, rows: 31, allowProposedApi: true, vtExtensions: { kittyKeyboard: true } })
screen.onData((data) => child.write(data))
// Headless has no theme service; model the renderer's background-colour reply.
screen.parser.registerOscHandler(11, (data) => {
  if (data !== '?') return false
  child.write(${JSON.stringify('\x1b]11;rgb:0000/0000/0000\x1b\\')})
  return true
})
let exited = false
const startup = ${name === 'fish'} ? (${prepareFishStartupInput.toString()})({
  screen, child, command: startupCommand, token: env.COTA_SHELL_ACTIVITY,
  isLive: () => !exited,
  onError: (message) => process.stdout.write('COTA_STARTUP_ERROR:' + message),
}) : undefined
let stage = 0, output = ''
const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
child.onData((data) => {
  process.stdout.write(data)
  output += data
  screen.write(data, () => startup?.notifyOutput())
  if ((stage === 0 || stage === 2) && output.includes('COTA_RUNNING')) {
    stage++
    output = ''
    child.write('\\x03')
  } else if ((stage === 1 || stage === 3) && output.includes('COTA_PROMPT> ')) {
    stage++
    output = ''
    // Prompt hooks precede readline/ZLE; let the editor start before sending keys.
    setTimeout(() => child.write(stage === 2 ? '\\x1b[A\\r' : ${JSON.stringify(name === 'fish' ? "printf 'COTA_CLEAN:%s\\n' (set -q COTA_STARTUP_COMMAND; and echo present; or echo unset); exit\r" : 'printf \'COTA_CLEAN:%s\\n\' "${COTA_STARTUP_COMMAND-unset}"; exit\r')}), 30)
  }
})
child.onExit(({ exitCode, signal }) => {
  exited = true
  clearTimeout(timer)
  startup?.dispose()
  screen.dispose()
  process.stdout.write('COTA_DRIVER_STAGE:' + stage)
  process.exitCode = signal ? 1 : exitCode
})
process.on('SIGTERM', () => { child.kill(); process.exit(1) })
`
        const { stdout: ptyOutput } = await run(
          require('electron'),
          [
            '-e',
            driver,
            JSON.stringify({
              shell,
              args: ptyArgs,
              env: ptyEnv,
              cwd: root,
              startupCommand: startupInput,
            }),
          ],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: root, timeout: 5000 },
        ).catch((error) => {
          throw new Error(`${name}: ${error.message}\n${error.stdout}\n${error.stderr}`)
        })
        expect(await readdir(root)).not.toContain('nope')
        expect(ptyOutput, name).not.toContain('COTA_STARTUP_ERROR:')
        expect(ptyOutput, name).toContain('COTA_DRIVER_STAGE:4')
        expect(ptyOutput, name).toContain('COTA_CLEAN:unset')
        expect(await readFile(join(root, 'startup output'), 'utf8'), name).toBe(
          `ready\n${unicode} ; $(touch nope)\ndone\n`.repeat(2),
        )
        if (name === 'zsh')
          expect(
            (await readFile(join(root, 'line-init'), 'utf8')).trim().split('\n').length,
          ).toBeGreaterThanOrEqual(3)
        await rm(join(root, 'startup output'))
      }
      for (const fails of [false, true]) {
        const serviceEnv = { ...env, ZDOTDIR: root, COTA_SERVICE: '1', PORT: '32123' }
        const serviceArgs = await prepareAgentShell(
          `/bin/${name}`,
          serviceEnv,
          join(root, 'runtime'),
          `printf COTA_SERVICE_ONCE${fails ? '; false' : ''}`,
        )
        const result = await run(shell, [...serviceArgs!, '-c', 'printf SHOULD_NOT_RUN'], {
          env: serviceEnv,
          cwd: root,
          timeout: 5000,
        }).then(
          (value) => ({ ...value, code: 0 }),
          (error) => error,
        )
        expect(result.code).toBe(fails ? 1 : 0)
        expect(result.stdout).not.toContain('SHOULD_NOT_RUN')
        expect(result.stdout.split('COTA_SERVICE_ONCE').length - 1).toBe(2)
      }
    }
    await expect(
      prepareAgentShell('/bin/sh', { HOME: root }, join(root, 'runtime'), command),
    ).rejects.toThrow('快捷命令需要')
  })
})
