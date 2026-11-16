import { root } from '../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { promisify } from 'node:util'
import { inspectAgentHook } from '../../src/main/agents/hooks/managed'
import { prepareAgentShell } from '../../src/main/agents/hooks/shell-integration'
import { prepareFishStartupInput } from '../../src/main/terminal/fish-startup'
import type * as ChildProcessModule from 'node:child_process'

const unicode = '中文'.repeat(200)
const command = `printf '%s\\n' "$COTA_TEST_PROFILE" '${unicode} ; $(touch nope)' >> 'startup output'\nprintf '%s\\n' done >> 'startup output'`

type ShellName = 'bash' | 'zsh' | 'fish'

function shellEnvironment() {
  return {
    HOME: root,
    PATH: '/usr/bin:/bin',
    TERM: 'dumb',
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
  }
}

async function configureShell() {
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
}

async function installedShell(name: ShellName) {
  for (const candidate of name === 'fish'
    ? ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish']
    : [`/bin/${name}`]) {
    const shell = await realpath(candidate).catch(() => undefined)
    if (shell) return shell
  }
}

async function realExecFile() {
  return promisify(
    (await vi.importActual<typeof ChildProcessModule>('node:child_process')).execFile,
  )
}

describe('Real quick command startup and Shell history', () => {
  it.for(['bash', 'zsh', 'fish'] as const)(
    'prepares %s startup without installing Codex Hooks',
    async (name) => {
      const env = shellEnvironment()
      const args = await prepareAgentShell(`/bin/${name}`, env, join(root, 'runtime'), command)
      expect(args).toBeDefined()
      expect((await inspectAgentHook('codex', env)).state).toBe('missing')
    },
  )

  it.for(['bash', 'zsh'] as const)(
    'executes the startup command once before noninteractive %s input',
    async (name, { skip }) => {
      const shell = await installedShell(name)
      if (!shell) return skip(`${name} is not installed`)
      await configureShell()
      const env = shellEnvironment()
      const args = await prepareAgentShell(`/bin/${name}`, env, join(root, 'runtime'), command)
      const run = await realExecFile()
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
    },
  )

  it.for(['bash', 'zsh', 'fish'] as const)(
    'submits %s startup through the native editor with history and interruption',
    async (name, { skip }) => {
      const shell = await installedShell(name)
      if (!shell) return skip(`${name} is not installed`)
      await configureShell()
      const env = shellEnvironment()
      await prepareAgentShell(`/bin/${name}`, env, join(root, 'runtime'), command)
      const run = await realExecFile()
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
    },
  )

  it.for([
    { name: 'bash', fails: false },
    { name: 'bash', fails: true },
    { name: 'zsh', fails: false },
    { name: 'zsh', fails: true },
    { name: 'fish', fails: false },
    { name: 'fish', fails: true },
  ] as const)(
    'runs one $name service command and preserves exit status when fails=$fails',
    async ({ name, fails }, { skip }) => {
      const shell = await installedShell(name)
      if (!shell) return skip(`${name} is not installed`)
      await configureShell()
      const env = shellEnvironment()
      await prepareAgentShell(`/bin/${name}`, env, join(root, 'runtime'), command)
      const run = await realExecFile()
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
    },
  )

  it('rejects quick commands for an unsupported Shell', async () => {
    await expect(
      prepareAgentShell('/bin/sh', { HOME: root }, join(root, 'runtime'), command),
    ).rejects.toThrow('快捷命令需要')
  })
})
