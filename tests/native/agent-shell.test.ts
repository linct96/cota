import { root } from '../helpers/cli-environment.fixture'
import { describe, expect, it, vi } from 'vitest'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { installAgentHook } from '../../src/main/agents/hooks/managed'
import { prepareAgentShell } from '../../src/main/agents/hooks/shell-integration'
import type * as ChildProcessModule from 'node:child_process'

describe('Real Codex Shell wrappers', () => {
  it('loads login profiles once and preserves native arguments, user functions and aliases', async () => {
    const env = { HOME: root, PATH: join(root, 'bin') }
    await installAgentHook('codex', env, '0.159.0')
    const run = promisify(
      (await vi.importActual<typeof ChildProcessModule>('node:child_process')).execFile,
    )
    await writeFile(
      join(root, 'bin', 'codex'),
      `#!/bin/sh
if [ "$1" = --help ]; then printf '%s\\n' "$COTA_TEST_HELP"; exit 0; fi
printf 'COTA_ARGS'
for arg in "$@"; do printf '<%s>' "$arg"; done
printf '\\n'
`,
      { mode: 0o700 },
    )
    const profile = 'export PATH="$COTA_TEST_BIN:/usr/bin:/bin"\nprintf "COTA_PROFILE\\n"\n'
    await writeFile(join(root, '.bash_profile'), profile)
    await writeFile(join(root, '.bash_login'), 'printf "WRONG_PROFILE\\n"\n')
    await writeFile(join(root, '.bashrc'), 'printf "DUPLICATE_RC\\n"\n')
    await writeFile(join(root, '.zprofile'), profile)
    await writeFile(join(root, '.zshrc'), '')
    await mkdir(join(root, 'config', 'fish'), { recursive: true })
    await writeFile(
      join(root, 'config', 'fish', 'config.fish'),
      'set -gx PATH "$COTA_TEST_BIN" /usr/bin /bin\nprintf "COTA_PROFILE\\n"\n',
    )
    for (const name of ['zsh', 'bash', 'fish']) {
      const shellEnv: Record<string, string> = {
        HOME: root,
        PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
        TERM: 'dumb',
        COTA_TEST_BIN: join(root, 'bin'),
        COTA_TEST_HELP: '--no-daemon',
      }
      const args = await prepareAgentShell(`/bin/${name}`, shellEnv, join(root, 'runtime'))
      expect(args).toBeDefined()
      const launch = await Promise.all([
        prepareAgentShell(`/bin/${name}`, { ...shellEnv }, join(root, 'runtime')),
        prepareAgentShell(`/bin/${name}`, { ...shellEnv }, join(root, 'other-runtime')),
      ])
      expect(launch.every(Boolean)).toBe(true)
      let shell: string | undefined
      for (const candidate of name === 'fish'
        ? ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish']
        : [`/bin/${name}`]) {
        shell = await realpath(candidate).catch(() => undefined)
        if (shell) break
      }
      if (!shell) continue
      const execute = (script: string, environment = shellEnv) =>
        run(shell, [...args!, '-c', script], { env: environment, cwd: root, timeout: 5000 })
      const { stdout } = await execute(`codex 'a b' '' '$(touch nope)'
codex agents
codex queue
codex --remote=server
codex --remote server
codex --no-daemon`)
      expect(stdout.match(/COTA_PROFILE/g)).toHaveLength(1)
      expect(stdout).not.toMatch(/WRONG_PROFILE|DUPLICATE_RC/)
      expect(stdout).toContain('COTA_ARGS<--no-daemon><a b><><$(touch nope)>')
      for (const arg of ['agents', 'queue', '--remote=server', '--remote><server', '--no-daemon'])
        expect(stdout).toContain(`COTA_ARGS<${arg}>`)
      expect((await execute('codex', { ...shellEnv, COTA_TEST_HELP: 'old CLI' })).stdout).toContain(
        'COTA_ARGS\n',
      )
      const userConfig =
        name === 'fish'
          ? join(root, 'config', 'fish', 'config.fish')
          : join(root, name === 'bash' ? '.bash_profile' : '.zshrc')
      const original = await readFile(userConfig, 'utf8')
      const userFunction =
        name === 'fish'
          ? 'function codex\n  printf "COTA_USER_FUNCTION\\n"\nend\n'
          : 'function codex { printf "COTA_USER_FUNCTION\\n"; }\n'
      await writeFile(userConfig, original + userFunction)
      expect((await execute('codex')).stdout).toContain('COTA_USER_FUNCTION')
      await writeFile(userConfig, original + "alias codex='printf COTA_USER_ALIAS'\n")
      expect((await execute('codex')).stdout).toContain('COTA_USER_ALIAS')
      await writeFile(userConfig, original)
      expect(await readdir(root)).not.toContain('nope')
    }
    expect(await prepareAgentShell('/bin/sh', env, join(root, 'runtime'))).toBeUndefined()
  })
})
