import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import {
  mkdir,
  chmod,
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
  readdir,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import * as shell from '../src/main/system/shell'
import { promisify } from 'node:util'
import { AGENT_PROVIDERS, DEFAULT_CONFIG } from '../src/shared/contracts'
import { agentCliCacheSchema } from '../src/shared/agent-cli'
import {
  parseArguments,
  preferredWorkspaceOpener,
  withSystemFileManager,
} from '../src/shared/open-with'
import { savedQuickCommands, startupCommand, workspaceOpeners } from '../src/main/validation'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  spawn: vi.fn(),
  ptySpawn: vi.fn(),
  adapter: vi.fn(),
  applications: new Set<string>(),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    stat: (path: string) =>
      mocks.applications.has(path)
        ? Promise.resolve({ isDirectory: () => true })
        : original.stat(path),
    access: (path: string, mode?: number) =>
      /(?:pi-extension|agent-hook)\.js$/.test(path)
        ? mocks.adapter(path)
        : original.access(path, mode),
  }
})
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.login }),
    spawn: mocks.spawn,
  }
})
import { listWorkspaceOpeners, openWorkspaceWith } from '../src/main/system/open-with'
import { agentCapability, detectAgents, resolveAgent } from '../src/main/agents/cli/registry'
vi.mock('node-pty', () => ({ spawn: mocks.ptySpawn }))
import { AgentCliManagement } from '../src/main/agents/cli/management'
import { AgentCliInstallTerminals } from '../src/main/agents/cli/install-terminal'
import { ConfigStore } from '../src/main/settings/config-store'
import {
  hookFiles,
  inspectAgentHook,
  installAgentHook,
  uninstallAgentHook,
} from '../src/main/agents/hooks/managed'
import { codexShellFunction, prepareAgentShell } from '../src/main/agents/hooks/shell-integration'

const opener = { id: 'editor', name: 'Editor', command: 'editor', arguments: '{path}' }
let root: string
let command: string
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'cota 中文 ; open-with-')))
  await mkdir(join(root, 'bin'))
  command = join(root, 'bin', 'editor')
  await writeFile(command, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  mocks.login.mockResolvedValue({ stdout: `shell startup output\0${join(root, 'bin')}\0` })
  child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => {
      child.emit('spawn')
      child.emit('exit', 0)
    })
    return child
  })
})
afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mocks.applications.clear()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('open-with arguments and validation', () => {
  it.each([
    ['', []],
    ['--new-window {path}', ['--new-window', '{path}']],
    ['"" \'\' a" b"c', ['', '', 'a bc']],
    ['"folder with spaces" a\\ b', ['folder with spaces', 'a b']],
    ['"a\\\"b" \'c\\d\'', ['a"b', 'c\\d']],
    ['$(touch nope) ; $HOME | *', ['$(touch', 'nope)', ';', '$HOME', '|', '*']],
  ])('parses %s without evaluating shell syntax', (value, expected) => {
    expect(parseArguments(value)).toEqual(expected)
  })
  it.each(['"unclosed', "'unclosed", 'trailing\\'])('rejects incomplete quoting: %s', (value) => {
    expect(() => parseArguments(value)).toThrow()
  })
  it.each([
    null,
    {},
    Array(51).fill(opener),
    [{ ...opener, id: '../id' }],
    [{ ...opener, name: ' ' }],
    [{ ...opener, command: 'code --new-window' }],
    [{ ...opener, command: 'code; touch nope' }],
    [{ ...opener, command: '/bin/sh\0' }],
    [{ ...opener, arguments: '"unclosed' }],
    [opener, opener],
  ])('rejects invalid program definitions: %j', (value) => {
    expect(() => workspaceOpeners(value)).toThrow()
  })
})

describe('workspace program launch', () => {
  it('reports command and prompt activity in real session-only Bash, Zsh and Fish PTYs', async () => {
    const run = promisify(
      (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFile,
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
  it('runs a quick command once after shell initialization without installing hooks', async () => {
    const command = `printf '%s\\n' "$COTA_TEST_PROFILE" '中文 ; $(touch nope)' >> 'startup output'\nprintf '%s\\n' done >> 'startup output'`
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
      (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFile,
    )
    await writeFile(join(root, '.bash_profile'), 'export COTA_TEST_PROFILE=ready\n')
    await writeFile(join(root, '.zprofile'), 'export COTA_TEST_PROFILE=ready\n')
    await mkdir(join(root, 'config', 'fish'), { recursive: true })
    await writeFile(
      join(root, 'config', 'fish', 'config.fish'),
      'set -gx COTA_TEST_PROFILE ready\n',
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
      const { stdout } = await run(shell, [...args!, '-c', 'printf COTA_AFTER_STARTUP; env'], {
        env,
        cwd: root,
        timeout: 5000,
      })
      expect(stdout).toContain('COTA_AFTER_STARTUP')
      expect(stdout).not.toContain('COTA_STARTUP_COMMAND=')
      expect(await readFile(join(root, 'startup output'), 'utf8')).toBe(
        'ready\n中文 ; $(touch nope)\ndone\n',
      )
      expect(await readdir(root)).not.toContain('nope')
      await rm(join(root, 'startup output'))
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
  it('opens an explicitly configured Finder without shell evaluation', async () => {
    await openWorkspaceWith(root, {
      id: 'finder',
      name: 'Finder',
      command: '/usr/bin/open',
      arguments: '-a Finder {path}',
    })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-a', 'Finder', root]])
  })
  it('finds login-shell commands and passes a metacharacter/Unicode path as one literal argument', async () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    vi.stubEnv('COTA_HOST_TOKEN', 'private-host-credential')
    vi.stubEnv('NODE_CHANNEL_FD', '3')
    await openWorkspaceWith(root, { ...opener, arguments: '--new-window "{path}" --folder={path}' })
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      command,
      ['--new-window', root, `--folder=${root}`],
      expect.objectContaining({ cwd: root, detached: true, stdio: 'ignore' }),
    )
    const options = mocks.spawn.mock.calls[0][2]
    expect(options.shell).toBeUndefined()
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(options.env.NODE_OPTIONS).toBeUndefined()
    expect(options.env.COTA_HOST_TOKEN).toBeUndefined()
    expect(options.env.NODE_CHANNEL_FD).toBeUndefined()
    expect(child.unref).toHaveBeenCalledOnce()
    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
    mocks.login.mockImplementation(async (file: string, args: string[]) => {
      if (args[0] !== '--version') return { stdout: `startup noise\0${join(root, 'bin')}\0` }
      if (file.endsWith('/codex')) throw new Error('version probe timed out')
      return { stdout: file.endsWith('/pi') ? 'pi 1.2.3\n' : 'unknown banner' }
    })
    const detected = await detectAgents(DEFAULT_CONFIG.preferences)
    expect(detected).toEqual([
      { provider: 'pi', executable: join(root, 'bin', 'pi'), version: '1.2.3' },
      { provider: 'codex', executable: join(root, 'bin', 'codex'), version: undefined },
      { provider: 'claude', executable: join(root, 'bin', 'claude'), version: undefined },
    ])
    expect(mocks.login).toHaveBeenCalledWith(
      expect.any(String),
      ['-ilc', expect.any(String)],
      expect.objectContaining({ timeout: 5000, maxBuffer: 65536 }),
    )
    expect(mocks.login).toHaveBeenCalledWith(
      join(root, 'bin', 'codex'),
      ['--version'],
      expect.objectContaining({ timeout: 3000, maxBuffer: 65536 }),
    )
    const direct = await resolveAgent('codex', DEFAULT_CONFIG.preferences)
    expect(direct).toMatchObject({ executable: join(root, 'bin', 'codex'), args: [] })
    expect(direct.env.COTA_HOST_TOKEN).toBeUndefined()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await expect(agentCapability('codex', direct)).rejects.toThrow('版本未知')
    expect(direct.args).toEqual([])
    expect(direct.env.COTA_AGENT_TOKEN).toBeUndefined()
    mocks.login.mockImplementation(async (file: string) => ({
      stdout: file.endsWith('/pi')
        ? 'pi 1.3.0'
        : file.endsWith('/claude')
          ? '2.1.196'
          : 'codex 0.124.0',
    }))
    for (const provider of ['pi', 'claude', 'codex'] as const) {
      const command = {
        executable: join(root, 'bin', provider),
        args: [] as string[],
        env: {} as Record<string, string>,
      }
      expect(await agentCapability(provider, command)).toBe(provider === 'pi' ? 'full' : 'partial')
      expect(command.args).toEqual([])
      expect(command.env).toEqual({})
    }
    for (const minor of [145, 156, 159]) {
      mocks.login.mockImplementation(async (_file: string, args: string[]) => ({
        stdout: args[0] === '--version' ? `codex 0.${minor}.0` : `\0${join(root, 'bin')}\0`,
      }))
      const command = await resolveAgent('codex', DEFAULT_CONFIG.preferences)
      expect(command.args).toEqual(minor >= 156 ? ['--no-daemon'] : [])
      expect(command.env.COTA_AGENT_TOKEN).toBeUndefined()
    }
    const missingAdapter = { executable: join(root, 'bin', 'pi'), args: [] as string[], env: {} }
    mocks.adapter.mockRejectedValueOnce(new Error('missing packaged adapter'))
    mocks.login.mockResolvedValueOnce({ stdout: 'pi 1.3.0' })
    await expect(agentCapability('pi', missingAdapter)).rejects.toThrow('missing packaged adapter')
    expect(missingAdapter.args).toEqual([])
    expect(missingAdapter.env).toEqual({})

    const env = { HOME: root, PATH: join(root, 'bin') }
    expect(codexShellFunction).toContain('--no-daemon')
    expect(codexShellFunction).toContain('command "$__cota_program" "$@"')
    expect(codexShellFunction).not.toContain('eval')
    for (const shell of ['zsh', 'bash', 'fish']) {
      expect(await prepareAgentShell(`/bin/${shell}`, env, join(root, 'runtime'))).toBeUndefined()
    }
    for (const provider of ['pi', 'codex', 'claude'] as const) {
      expect((await inspectAgentHook(provider, env)).state).toBe('missing')
    }
    expect(await readdir(root)).toEqual(['bin'])
    const piPath = hookFiles('pi', env).config
    await mkdir(join(root, '.pi', 'agent', 'extensions'), { recursive: true })
    await writeFile(piPath, '// user-owned extension')
    expect((await inspectAgentHook('pi', env)).state).toBe('conflict')
    await expect(installAgentHook('pi', env)).rejects.toThrow('不属于 Cota')
    await expect(uninstallAgentHook('pi', env)).rejects.toThrow('不属于 Cota')
    expect(await readFile(piPath, 'utf8')).toBe('// user-owned extension')
    await rm(piPath)
    expect((await installAgentHook('pi', env)).state).toBe('installed')
    const piExtension = await readFile(piPath, 'utf8')
    expect(piExtension).toContain('COTA_AGENT_ADAPTER_DIR')
    await writeFile(`${piPath}.cota-lock`, '')
    await expect(uninstallAgentHook('pi', env)).rejects.toThrow()
    expect(await readFile(piPath, 'utf8')).toBe(piExtension)
    await rm(`${piPath}.cota-lock`)
    expect((await uninstallAgentHook('pi', env)).state).toBe('missing')
    await expect(readFile(piPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(piPath, '..'))).toEqual([])
    expect((await uninstallAgentHook('pi', env)).state).toBe('missing')
    expect((await installAgentHook('pi', env)).state).toBe('installed')
    const trustRecords = new Map([['user-trust', { trusted_hash: 'keep', enabled: false }]])
    const trustRequests: { method: string; params: any }[] = []
    let rpcFailure:
      | 'unsupported'
      | 'policy'
      | 'foreign'
      | 'race'
      | 'invalid'
      | 'timeout'
      | undefined
    const rpcChildren: (EventEmitter & { kill: ReturnType<typeof vi.fn> })[] = []
    mocks.spawn.mockImplementation((_file, args, options) => {
      expect(args).toEqual(['app-server'])
      expect(options.env.CODEX_HOME).toBe(join(root, '.codex'))
      expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore'])
      const stdout = new PassThrough()
      const rpc = Object.assign(new EventEmitter(), {
        stdout,
        exitCode: null as number | null,
        kill: vi.fn(() => {
          rpc.exitCode = 0
          rpc.emit('exit', 0)
          return true
        }),
        stdin: new Writable({
          write(chunk, _encoding, callback) {
            const request = JSON.parse(String(chunk))
            if (request.id === undefined) return callback()
            trustRequests.push(request)
            void (async () => {
              const paths = hookFiles('codex', env)
              const configPath = join(root, '.codex', 'config.toml')
              let result: unknown = {}
              if (request.method === 'hooks/list') {
                if (rpcFailure === 'timeout') return
                if (rpcFailure === 'invalid') {
                  stdout.write('not JSON\n')
                  return
                }
                if (rpcFailure === 'unsupported') {
                  stdout.write(
                    `${JSON.stringify({ id: request.id, error: { message: 'secret' } })}\n`,
                  )
                  return
                }
                const data = JSON.parse(await readFile(paths.config, 'utf8'))
                const hooks = Object.entries(data.hooks).flatMap(([eventName, groups]) =>
                  (
                    groups as { matcher?: string; hooks: { command: string; timeout: number }[] }[]
                  ).flatMap((group, groupIndex) =>
                    group.hooks.map((hook, hookIndex) => {
                      const key = `${eventName}:${groupIndex}:${hookIndex}`
                      const currentHash = `native-hash/${key}`
                      return {
                        key,
                        currentHash,
                        eventName: eventName[0].toLowerCase() + eventName.slice(1),
                        command: hook.command,
                        timeoutSec: hook.timeout,
                        matcher: group.matcher ?? null,
                        handlerType: 'command',
                        async: false,
                        statusMessage: null,
                        additionalContextLimit: null,
                        pluginId: null as string | null,
                        isManaged: false,
                        sourcePath: rpcFailure === 'foreign' ? '/foreign/hooks.json' : paths.config,
                        source: 'user',
                        trustStatus:
                          trustRecords.get(key)?.trusted_hash === currentHash
                            ? 'trusted'
                            : 'untrusted',
                      }
                    }),
                  ),
                )
                // Same command from a plugin must never be included in the approval.
                hooks.push({
                  ...hooks.find((hook) => hook.command === paths.command)!,
                  key: 'plugin-hook',
                  pluginId: 'other',
                })
                result = { data: [{ cwd: options.cwd, hooks, warnings: [], errors: [] }] }
              }
              if (request.method === 'config/read') {
                result = {
                  layers: [{ name: { type: 'user', file: configPath }, version: 'native-version' }],
                }
                if (rpcFailure === 'race') await writeFile(configPath, '# concurrent edit\n')
              }
              if (request.method === 'config/batchWrite') {
                if (rpcFailure === 'policy') {
                  stdout.write(
                    `${JSON.stringify({ id: request.id, error: { message: 'policy-secret' } })}\n`,
                  )
                  return
                }
                expect(request.params.filePath).toBe(configPath)
                expect(request.params.expectedVersion).toBe('native-version')
                expect(request.params.edits).toHaveLength(1)
                const edit = request.params.edits[0]
                expect(edit.keyPath).toBe('hooks.state')
                expect(edit.mergeStrategy).toBe('upsert')
                for (const [key, value] of Object.entries(edit.value)) {
                  expect(key).not.toMatch(/user-trust|plugin-hook/)
                  expect(Object.keys(value as object)).toEqual(['trusted_hash'])
                  trustRecords.set(key, value as { trusted_hash: string; enabled: boolean })
                }
                const raw = await readFile(configPath, 'utf8').catch(() => '')
                await writeFile(configPath, `${raw}# native trust write\n`)
                result = { status: 'ok', filePath: configPath }
              }
              stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)
            })().catch((error) => stdout.destroy(error))
            callback()
          },
        }),
      })
      rpcChildren.push(rpc)
      return rpc
    })
    for (const provider of ['codex', 'claude'] as const) {
      const paths = hookFiles(provider, env)
      await mkdir(join(root, provider === 'codex' ? '.codex' : '.claude'), { recursive: true })
      const original = JSON.stringify({
        description: 'user settings',
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: 'user-hook' },
                { type: 'command', command: paths.command, timeout: 1 },
              ],
            },
          ],
        },
      })
      await writeFile(paths.config, original)
      const trustConfig = join(root, '.codex', 'config.toml')
      const userToml = '# user settings\nnotify = ["keep-notify"]\n'
      if (provider === 'codex') await writeFile(trustConfig, userToml)
      const hookStatus = await installAgentHook(provider, env)
      expect(hookStatus.state).toBe('installed')
      if (provider === 'codex') {
        expect(hookStatus.detail).toContain('已安装并信任')
        expect(hookStatus.paths).toContain(trustConfig)
        expect(await readFile(trustConfig, 'utf8')).toBe(`${userToml}# native trust write\n`)
        expect(trustRecords.get('user-trust')).toEqual({ trusted_hash: 'keep', enabled: false })
        expect(trustRecords.size).toBe(7)
        expect((await inspectAgentHook(provider, env)).detail).toContain('检测不读取信任状态')
        expect(rpcChildren.every((rpc) => rpc.kill.mock.calls.length === 1)).toBe(true)
      }
      const installed = await readFile(paths.config, 'utf8')
      const data = JSON.parse(installed)
      expect(data.description).toBe('user settings')
      expect(data.hooks.Stop[0]).toEqual({
        matcher: '*',
        hooks: [{ type: 'command', command: 'user-hook' }],
      })
      expect(data.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks)).toHaveLength(2)
      expect(data).not.toHaveProperty('notify')
      const backups = (await readdir(join(paths.config, '..'))).filter((name) =>
        name.startsWith(`${provider === 'codex' ? 'hooks.json' : 'settings.json'}.cota-backup-`),
      )
      expect(backups).toHaveLength(1)
      expect(await readFile(join(paths.config, '..', backups[0]), 'utf8')).toBe(original)
      const writes = trustRequests.filter(
        (request) => request.method === 'config/batchWrite',
      ).length
      await installAgentHook(provider, env)
      expect(await readFile(paths.config, 'utf8')).toBe(installed)
      expect(
        trustRequests.filter((request) => request.method === 'config/batchWrite'),
      ).toHaveLength(writes)
      expect(
        (await readdir(join(paths.config, '..'))).filter((name) =>
          name.startsWith(`${provider === 'codex' ? 'hooks.json' : 'settings.json'}.cota-backup-`),
        ),
      ).toHaveLength(1)
      if (provider === 'codex') {
        for (const minor of [145, 159]) {
          await installAgentHook(provider, env, `0.${minor}.0`)
          const config = JSON.parse(await readFile(paths.config, 'utf8'))
          expect(config.hooks.SubagentStart).toBeDefined()
          expect(config.hooks.SubagentStop).toBeDefined()
          expect(!!config.hooks.Interrupt).toBe(minor >= 159)
          expect(config).not.toHaveProperty('features')
        }
        const trustBackups = (await readdir(join(trustConfig, '..'))).filter((name) =>
          name.startsWith('config.toml.cota-backup-'),
        )
        expect(
          await Promise.all(
            trustBackups.map((name) => readFile(join(trustConfig, '..', name), 'utf8')),
          ),
        ).toContain(userToml)
        trustRecords.clear()
        trustRecords.set('user-trust', { trusted_hash: 'keep', enabled: false })
        for (const failure of [
          'unsupported',
          'policy',
          'foreign',
          'race',
          'invalid',
          'timeout',
        ] as const) {
          rpcFailure = failure
          const before = await readFile(trustConfig, 'utf8')
          const calls = trustRequests.length
          if (failure === 'timeout') vi.useFakeTimers()
          const pending = expect(installAgentHook(provider, env, '0.159.0')).rejects.toThrow(
            '文件已安装，但未确认信任成功',
          )
          if (failure === 'timeout') {
            await vi.waitFor(() =>
              expect(
                trustRequests.slice(calls).some((request) => request.method === 'hooks/list'),
              ).toBe(true),
            )
            await vi.advanceTimersByTimeAsync(15_000)
          }
          await pending
          if (failure === 'timeout') vi.useRealTimers()
          expect(await readFile(trustConfig, 'utf8')).toBe(
            failure === 'race' ? '# concurrent edit\n' : before,
          )
          expect(trustRecords.size).toBe(1)
          expect(rpcChildren.at(-1)!.kill).toHaveBeenCalledOnce()
        }
        rpcFailure = undefined
        await writeFile(`${trustConfig}.cota-lock`, '')
        await expect(installAgentHook(provider, env, '0.159.0')).rejects.toThrow('未确认信任成功')
        await rm(`${trustConfig}.cota-lock`)
        const targetToml = join(root, 'user-config.toml')
        await writeFile(targetToml, userToml)
        await rm(trustConfig)
        await symlink(targetToml, trustConfig)
        const beforeSpawn = mocks.spawn.mock.calls.length
        await expect(installAgentHook(provider, env, '0.159.0')).rejects.toThrow('非普通文件')
        expect(mocks.spawn).toHaveBeenCalledTimes(beforeSpawn)
        expect(await readFile(targetToml, 'utf8')).toBe(userToml)
        await rm(trustConfig)
        expect((await installAgentHook(provider, env, '0.159.0')).detail).toContain('已安装并信任')
        expect(await readFile(trustConfig, 'utf8')).toBe('# native trust write\n')
        const run = promisify(
          (await vi.importActual<typeof import('node:child_process')>('node:child_process'))
            .execFile,
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
          const execute = (script: string, env = shellEnv) =>
            run(shell!, [...args!, '-c', script], { env, cwd: root, timeout: 5000 })
          const { stdout } = await execute(`codex 'a b' '' '$(touch nope)'
codex agents
codex queue
codex --remote=server
codex --remote server
codex --no-daemon`)
          expect(stdout.match(/COTA_PROFILE/g)).toHaveLength(1)
          expect(stdout).not.toMatch(/WRONG_PROFILE|DUPLICATE_RC/)
          expect(stdout).toContain('COTA_ARGS<--no-daemon><a b><><$(touch nope)>')
          for (const arg of [
            'agents',
            'queue',
            '--remote=server',
            '--remote><server',
            '--no-daemon',
          ])
            expect(stdout).toContain(`COTA_ARGS<${arg}>`)
          expect(
            (await execute('codex', { ...shellEnv, COTA_TEST_HELP: 'old CLI' })).stdout,
          ).toContain('COTA_ARGS\n')
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
      }
      const beforeUninstall = JSON.parse(await readFile(paths.config, 'utf8'))
      beforeUninstall.hooks.CustomEvent = [
        { matcher: 'mixed', hooks: [{ command: paths.command }, { command: 'keep-custom' }] },
        { matcher: 'empty-user-group', hooks: [] },
      ]
      beforeUninstall.hooks.Stop[0].hooks.push({ command: paths.command })
      const beforeRaw = JSON.stringify(beforeUninstall)
      await writeFile(paths.config, beforeRaw)
      const sharedLoader = await readFile(paths.loader, 'utf8')
      const filesBeforeUninstall = (await readdir(join(paths.config, '..'))).sort()
      expect((await uninstallAgentHook(provider, env)).state).toBe('missing')
      const uninstalled = await readFile(paths.config, 'utf8')
      expect(JSON.parse(uninstalled)).toEqual({
        description: 'user settings',
        hooks: {
          Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'user-hook' }] }],
          CustomEvent: [
            { matcher: 'mixed', hooks: [{ command: 'keep-custom' }] },
            { matcher: 'empty-user-group', hooks: [] },
          ],
        },
      })
      expect(await readFile(paths.loader, 'utf8')).toBe(sharedLoader)
      expect((await readdir(join(paths.config, '..'))).sort()).toEqual(filesBeforeUninstall)
      await uninstallAgentHook(provider, env)
      expect(await readFile(paths.config, 'utf8')).toBe(uninstalled)
      expect((await installAgentHook(provider, env)).state).toBe('installed')
      await writeFile(
        paths.config,
        JSON.stringify({
          keep: true,
          hooks: {
            FutureEvent: [{ hooks: [{ command: paths.command }] }],
          },
        }),
      )
      expect((await uninstallAgentHook(provider, env)).state).toBe('missing')
      expect(JSON.parse(await readFile(paths.config, 'utf8'))).toEqual({ keep: true })
      await writeFile(paths.config, '{broken')
      expect((await inspectAgentHook(provider, env)).state).toBe('error')
      await expect(installAgentHook(provider, env)).rejects.toThrow()
      await expect(uninstallAgentHook(provider, env)).rejects.toThrow()
      expect(await readFile(paths.config, 'utf8')).toBe('{broken')
      await rm(paths.config)
      const target = join(root, `${provider}-user-config`)
      await writeFile(target, '{}')
      await symlink(target, paths.config)
      expect((await inspectAgentHook(provider, env)).state).toBe('error')
      await expect(installAgentHook(provider, env)).rejects.toThrow('非普通文件')
      await expect(uninstallAgentHook(provider, env)).rejects.toThrow('非普通文件')
      expect(await readFile(target, 'utf8')).toBe('{}')
    }
  })
  it('supports absolute executable paths with spaces and appends the directory when no placeholder exists', async () => {
    mocks.login.mockRejectedValueOnce(new Error('shell initialization timed out'))
    await openWorkspaceWith(root, { ...opener, command, arguments: '--new-window' })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual([command, ['--new-window', root]])

    for (const name of ['code', 'zeditor'])
      await writeFile(join(root, 'bin', name), '#!/bin/sh\n', { mode: 0o700 })
    const configured = [
      { id: 'finder', name: '访达', command: '/usr/bin/open', arguments: '-a Finder {path}' },
      {
        ...opener,
        id: 'missing',
        name: 'Custom editor',
        command: 'missing-cota-editor',
        arguments: '--custom {path}',
      },
      opener,
    ]
    const loginCalls = mocks.login.mock.calls.length
    const available = listWorkspaceOpeners({
      ...DEFAULT_CONFIG.preferences,
      openWith: configured,
    })
    expect(available.slice(0, -1)).toEqual(configured)
    expect(available.at(-1)?.id).toBe('system-file-manager')
    expect(configured).toHaveLength(3)
    for (const [platform, name] of [
      ['darwin', '访达'],
      ['win32', '资源管理器'],
      ['linux', '文件管理器'],
    ]) {
      const builtIn = withSystemFileManager([], platform)
      expect(builtIn).toEqual([expect.objectContaining({ id: 'system-file-manager', name })])
      expect(withSystemFileManager([{ ...opener, id: 'system-file-manager' }], platform)).toEqual(
        builtIn,
      )
    }
    expect(mocks.login).toHaveBeenCalledTimes(loginCalls)
    const empty = listWorkspaceOpeners(DEFAULT_CONFIG.preferences)
    expect(empty).toEqual([expect.objectContaining({ id: 'system-file-manager' })])
    expect(DEFAULT_CONFIG.preferences.openWith).toEqual([])
    expect(
      preferredWorkspaceOpener({
        preferences: DEFAULT_CONFIG.preferences,
        workspaceOpeners: empty,
      })?.id,
    ).toBe('system-file-manager')
    expect(
      preferredWorkspaceOpener({
        preferences: DEFAULT_CONFIG.preferences,
        workspaceOpeners: available,
      })?.id,
    ).toBe('finder')
    expect(
      preferredWorkspaceOpener({
        preferences: { ...DEFAULT_CONFIG.preferences, preferredOpenerId: 'editor' },
        workspaceOpeners: available,
      })?.id,
    ).toBe('editor')
    expect(
      preferredWorkspaceOpener({
        preferences: { ...DEFAULT_CONFIG.preferences, preferredOpenerId: 'system-file-manager' },
        workspaceOpeners: available,
      })?.id,
    ).toBe('system-file-manager')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(
      (
        await listWorkspaceOpeners({
          ...DEFAULT_CONFIG.preferences,
          openWith: [{ ...opener, command: join(root, 'bin', 'code') }],
        })
      ).map((entry) => entry.id),
    ).toEqual(['editor', 'system-file-manager'])

    if (process.platform === 'darwin') {
      vi.spyOn(shell, 'findExecutable').mockRejectedValue(new Error('not on PATH'))
      mocks.applications.add('/Applications/Visual Studio Code.app')
      const apps = listWorkspaceOpeners({
        ...DEFAULT_CONFIG.preferences,
        openWith: [{ id: 'vscode', name: 'VS Code', command: 'code', arguments: '{path}' }],
      })
      expect(apps).toContainEqual(expect.objectContaining({ id: 'vscode' }))
      await openWorkspaceWith(
        root,
        apps.find((entry) => entry.id === 'vscode')!,
      )
      expect(mocks.spawn.mock.calls.at(-1)!.slice(0, 2)).toEqual([
        '/usr/bin/open',
        ['-a', '/Applications/Visual Studio Code.app', root, '--args', root],
      ])
      vi.mocked(shell.findExecutable).mockRestore()
    }

    vi.useFakeTimers()
    child.unref.mockClear()
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const pending = openWorkspaceWith(root, { ...opener, command })
    await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(300)
    await pending
    child.emit('exit', 0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects missing or non-executable programs and inaccessible directories before spawning', async () => {
    await expect(
      openWorkspaceWith(root, { ...opener, command: 'missing-cota-editor' }),
    ).rejects.toThrow('找不到')
    await writeFile(join(root, 'not-executable'), '')
    await expect(
      openWorkspaceWith(root, { ...opener, command: join(root, 'not-executable') }),
    ).rejects.toThrow('无法执行')
    await expect(openWorkspaceWith(join(root, 'missing'), opener)).rejects.toThrow('不可访问')
    expect(mocks.spawn).not.toHaveBeenCalled()

    const detectionEnv = { PATH: join(root, 'bin') }
    expect(await detectAgents(DEFAULT_CONFIG.preferences, undefined, detectionEnv)).toEqual([
      { provider: 'pi' },
      { provider: 'codex' },
      { provider: 'claude' },
    ])
    await writeFile(join(root, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o600 })
    expect(
      (await detectAgents(DEFAULT_CONFIG.preferences, 'claude', detectionEnv))[0].error,
    ).toContain('文件权限')
    await chmod(join(root, 'bin', 'claude'), 0o700)
    expect(
      agentCliCacheSchema.parse({
        checkedAt: 1,
        pathEnv: detectionEnv.PATH,
        entries: [
          {
            provider: 'claude',
            error: '找不到 claude。请安装其命令行工具，并检查登录 Shell 的 PATH。',
          },
          {
            provider: 'codex',
            error: `${AGENT_PROVIDERS.codex.name} CLI 已不存在，启动失败。请在设置中重新安装或检测。`,
          },
          { provider: 'pi', error: '无法执行 pi，请检查文件权限和磁盘状态。' },
        ],
      }).entries,
    ).toEqual([
      { provider: 'claude' },
      { provider: 'codex' },
      { provider: 'pi', error: '无法执行 pi，请检查文件权限和磁盘状态。' },
    ])

    for (const provider of ['pi', 'codex', 'claude'])
      await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
    mocks.login.mockImplementation(async (_file: string, args: string[]) => ({
      stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
    }))
    const configFile = join(root, 'config.json')
    const config = new ConfigStore(configFile)
    await config.load()
    const publish = vi.fn()
    const agents = new AgentCliManagement(config, publish)
    await agents.initialize()
    expect(agents.read().entries).toHaveLength(3)
    expect(
      agents
        .read()
        .entries.every((entry) => entry.version === '0.159.0' && entry.installMethod === 'unknown'),
    ).toBe(true)
    // Keep absence deterministic even on a developer machine with other installed copies.
    await config.saveAgentClis({ ...agents.read(), pathEnv: join(root, 'bin') })
    const probes = mocks.login.mock.calls.length
    const restored = new ConfigStore(configFile)
    await restored.load()
    const restarted = new AgentCliManagement(restored, publish)
    await restarted.initialize()
    expect(restarted.read()).toEqual(agents.read())
    const launch = vi.fn(async (command) => command.args)
    expect(await restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).toEqual([
      '--no-daemon',
    ])
    expect(mocks.login).toHaveBeenCalledTimes(probes)
    const saved = restarted.read()
    for (const failure of [
      new Error('CLI exited 1'),
      Object.assign(new Error('cwd missing'), { code: 'ENOENT' }),
      Object.assign(new Error('interpreter missing'), {
        code: 'ENOENT',
        path: join(root, 'bin', 'codex'),
      }),
    ]) {
      await expect(
        restarted.run('codex', DEFAULT_CONFIG.preferences, async () => {
          throw failure
        }),
      ).rejects.toBe(failure)
      expect(restarted.read()).toEqual(saved)
    }
    await chmod(join(root, 'bin', 'codex'), 0o600)
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow('权限')
    expect(restarted.read()).toEqual(saved)
    await chmod(join(root, 'bin', 'codex'), 0o700)
    await expect(
      restarted.run('codex', DEFAULT_CONFIG.preferences, async () => {
        await rm(join(root, 'bin', 'codex'))
        throw new Error('Host spawn failed')
      }),
    ).rejects.toThrow('CLI 已不存在')
    launch.mockClear()
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
      '未安装',
    )
    expect(launch).not.toHaveBeenCalled()
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
    })
    const disk = new ConfigStore(configFile)
    await disk.load()
    expect(disk.snapshot().agentCliCache).toEqual(restarted.read())
    expect(publish).toHaveBeenLastCalledWith(restarted.read())
    expect(mocks.login).toHaveBeenCalledTimes(probes)
    await writeFile(join(root, 'bin', 'npm'), '#!/bin/sh\n', { mode: 0o700 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: '0.159.0' }))
    mocks.login.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'install') {
        expect(args).toEqual(['install', '--global', '@openai/codex@latest'])
        await writeFile(join(root, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o700 })
      }
      return {
        stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
        stderr: '',
      }
    })
    const idle = vi.fn().mockResolvedValue(undefined)
    const installChild = new EventEmitter()
    const write = vi.fn()
    const resize = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 12345,
      write,
      resize,
      pause,
      resume,
      onData: (listener: (data: string) => void) => {
        installChild.on('data', listener)
        return { dispose: () => installChild.off('data', listener) }
      },
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        installChild.on('exit', listener)
        return { dispose: () => installChild.off('exit', listener) }
      },
    })
    const progress = vi.fn()
    const terminals = new AgentCliInstallTerminals(progress)
    const installation = terminals.run('codex', (execute) =>
      restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledOnce())
    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      join(root, 'bin', 'npm'),
      ['install', '--global', '@openai/codex@latest'],
      expect.objectContaining({ cols: 100, rows: 28 }),
    )
    expect(terminals.running).toBe(true)
    await expect(
      terminals.run('pi', async () => ({ status: { provider: 'pi' }, output: '' })),
    ).rejects.toThrow('等待完成')
    await expect(restarted.run('codex', DEFAULT_CONFIG.preferences, launch)).rejects.toThrow(
      '正在安装或更新',
    )
    installChild.emit('data', '\x1b[32mdownloading\x1b[0m\r\n')
    const firstSnapshot = (await terminals.snapshot('codex'))!
    expect(firstSnapshot.output).toContain('downloading')
    expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
    const attachment = '00000000-0000-0000-0000-000000000001'
    await terminals.snapshot('codex', attachment)
    installChild.emit('data', '\x1b[6n')
    await terminals.snapshot('codex')
    expect(write).not.toHaveBeenCalled()
    terminals.detach('codex', '00000000-0000-0000-0000-000000000002')
    installChild.emit('data', '\x1b[6n')
    await terminals.snapshot('codex')
    expect(write).not.toHaveBeenCalled()
    terminals.detach('codex', attachment)
    installChild.emit('data', '\x1b[6n')
    await terminals.snapshot('codex')
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/\[\d+;\d+R$/))
    write.mockClear()
    terminals.write(firstSnapshot.run.id, 'y\r')
    terminals.resize(firstSnapshot.run.id, 90, 24)
    expect(write).toHaveBeenCalledWith('y\r')
    expect(resize).toHaveBeenCalledWith(90, 24)
    expect(() => terminals.write(firstSnapshot.run.id, 1)).toThrow('输入无效')
    expect(() => terminals.resize(firstSnapshot.run.id, 0, 24)).toThrow('尺寸无效')
    // Reopening reads the same terminal; no second command is launched.
    installChild.emit('data', 'installed\r\n')
    const reopened = (await terminals.snapshot('codex'))!
    expect(reopened.run.id).toBe(firstSnapshot.run.id)
    expect(reopened.output).toContain('downloading')
    expect(reopened.output).toContain('installed')
    expect(reopened.revision).toBeGreaterThan(firstSnapshot.revision)
    expect(mocks.ptySpawn).toHaveBeenCalledOnce()
    expect(progress.mock.calls.some(([event]) => event.data?.includes('installed'))).toBe(false)

    const activeAttachment = '00000000-0000-0000-0000-000000000003'
    await terminals.snapshot('codex', activeAttachment)
    const chunk = 'streamed ' + 'x'.repeat(16 * 1024) + '\r\n'
    for (let index = 0; index < 4; index++) {
      installChild.emit('data', chunk)
      await terminals.snapshot('codex')
    }
    // A drained main parser must stay paused until the renderer consumes its output.
    expect(pause).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(
        progress.mock.calls
          .filter(([event]) => event.attachmentId === activeAttachment)
          .reduce((length, [event]) => length + event.data.length, 0),
      ).toBe(chunk.length * 4),
    )
    terminals.acknowledge('codex', attachment, chunk.length * 4)
    for (const length of [-1, 0, 0.5, NaN, chunk.length * 4 + 1])
      terminals.acknowledge('codex', activeAttachment, length)
    expect(resume).not.toHaveBeenCalled()
    terminals.acknowledge('codex', activeAttachment, chunk.length * 4)
    expect(resume).toHaveBeenCalledOnce()
    installChild.emit('data', 'x'.repeat(64 * 1024))
    await terminals.snapshot('codex')
    expect(pause).toHaveBeenCalledTimes(2)
    terminals.detach('codex', attachment)
    expect(resume).toHaveBeenCalledOnce()
    terminals.detach('codex', activeAttachment)
    expect(resume).toHaveBeenCalledTimes(2)
    progress.mockClear()
    installChild.emit('data', '\r\nhistory-start\r\n' + 'recent line\r\n'.repeat(300))
    const shortHistory = (await terminals.snapshot('codex'))!
    expect(shortHistory.output).not.toContain('history-start')
    expect(shortHistory.output).toContain('recent line')
    expect(progress.mock.calls.some(([event]) => event.data !== undefined)).toBe(false)
    await terminals.snapshot('codex', '00000000-0000-0000-0000-000000000004')
    installChild.emit('data', 'live output\r\n')
    await vi.waitFor(() =>
      expect(progress.mock.calls.some(([event]) => event.data?.includes('live output'))).toBe(true),
    )
    await writeFile(join(root, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o700 })
    installChild.emit('exit', { exitCode: 0 })
    expect((await installation).output.length).toBeLessThanOrEqual(4096)
    expect(idle).toHaveBeenCalledTimes(2)
    expect(terminals.running).toBe(false)
    expect((await terminals.snapshot('codex'))?.run.status).toBe('succeeded')

    const failed = terminals.run('pi', async (execute) => {
      await execute({ executable: 'npm', args: [], env: {} })
      return { status: { provider: 'pi' }, output: '' }
    })
    const failure = expect(failed).rejects.toThrow('退出码 2')
    installChild.emit('data', 'network failed\r\n')
    installChild.emit('exit', { exitCode: 2 })
    await failure
    expect((await terminals.snapshot('pi'))?.output).toContain('network failed')
    expect(terminals.list().find((run) => run.provider === 'pi')?.status).toBe('failed')
    terminals.write(firstSnapshot.run.id, 'ignored')
    expect(write).toHaveBeenCalledOnce()

    let release!: () => void
    const waiting = terminals.run('claude', async (execute) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await execute({ executable: 'claude', args: ['update'], env: {} })
      return { status: { provider: 'claude' }, output: '' }
    })
    const interrupted = expect(waiting).rejects.toThrow('已中断')
    const closed = terminals.close()
    release()
    await interrupted
    await closed
    expect(terminals.running).toBe(false)
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(2)
    for (const signal of [2, 15]) {
      const signalled = terminals.run('claude', async (execute) => {
        await execute({ executable: 'claude', args: ['update'], env: {} })
        return { status: { provider: 'claude', executable: '/fake/claude' }, output: '' }
      })
      const rejected = expect(signalled).rejects.toThrow(`信号 ${signal}`)
      installChild.emit('exit', { exitCode: 0, signal })
      await rejected
      expect((await terminals.snapshot('claude'))?.run.status).toBe('failed')
    }
    await restarted.inspect(DEFAULT_CONFIG.preferences, false)
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')?.executable).toBe(
      join(root, 'bin', 'codex'),
    )

    const findProgram = shell.findExecutable
    const missingCodex = new shell.ExecutableNotFoundError(
      '找不到 codex。请安装其命令行工具，并检查登录 Shell 的 PATH。',
    )
    const lookup = vi
      .spyOn(shell, 'findExecutable')
      .mockImplementation((command, env) =>
        command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
      )
    const beforeMissing = mocks.ptySpawn.mock.calls.length
    const missing = await terminals.run('codex', (execute) =>
      restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    expect(missing.status).toEqual({ provider: 'codex' })
    expect(restarted.read().entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
    })
    expect((await terminals.snapshot('codex'))?.run).toMatchObject({ status: 'not-installed' })
    expect((await terminals.snapshot('codex'))?.run.error).toBeUndefined()
    expect((await terminals.snapshot('codex'))?.output).not.toContain('找不到 codex')
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing)

    await restored.saveAgentClis({
      ...restarted.read(),
      entries: restarted
        .read()
        .entries.map((entry) =>
          entry.provider === 'codex'
            ? { provider: 'codex', executable: join(root, 'bin', 'codex') }
            : entry,
        ),
    })
    const permission = new Error('无法执行 codex，请检查文件权限和磁盘状态。')
    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(permission) : findProgram(command, env),
    )
    await expect(
      terminals.run('codex', (execute) =>
        restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
      ),
    ).rejects.toBe(permission)
    expect((await terminals.snapshot('codex'))?.run.error).toContain('文件权限')
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing)

    lookup.mockImplementation((command, env) =>
      command === 'codex' ? Promise.reject(missingCodex) : findProgram(command, env),
    )
    const undetected = terminals.run('codex', (execute) =>
      restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing + 1))
    installChild.emit('exit', { exitCode: 0 })
    expect((await undetected).status.executable).toBeUndefined()
    expect((await terminals.snapshot('codex'))?.run.status).toBe('not-installed')
    expect((await terminals.snapshot('codex'))?.run.error).toBeUndefined()

    const commandFailure = terminals.run('codex', (execute) =>
      restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
    )
    const failedCommand = expect(commandFailure).rejects.toThrow('退出码 2')
    await vi.waitFor(() => expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing + 2))
    installChild.emit('exit', { exitCode: 2 })
    await failedCommand
    expect(
      restarted.read().entries.find((entry) => entry.provider === 'codex')?.executable,
    ).toBeUndefined()
    expect((await terminals.snapshot('codex'))?.run.status).toBe('failed')
    expect((await terminals.snapshot('codex'))?.run.error).toContain('退出码 2')

    lookup.mockImplementation((command, env) =>
      command === 'npm'
        ? Promise.reject(
            new shell.ExecutableNotFoundError(
              '找不到 npm。请安装其命令行工具，并检查登录 Shell 的 PATH。',
            ),
          )
        : findProgram(command, env),
    )
    await expect(
      terminals.run('codex', (execute) =>
        restarted.install('codex', DEFAULT_CONFIG.preferences, idle, execute),
      ),
    ).rejects.toThrow('找不到 npm')
    expect((await terminals.snapshot('codex'))?.run.status).toBe('failed')
    expect(mocks.ptySpawn).toHaveBeenCalledTimes(beforeMissing + 2)
    lookup.mockRestore()
  })
  it('reports commands that launch but exit unsuccessfully', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.emit('spawn')
        child.emit('exit', 2)
      })
      return child
    })
    await expect(openWorkspaceWith(root, opener)).rejects.toThrow('状态码 2')
  })
  it('reports spawn errors instead of claiming success', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('error', new Error('permission denied')))
      return child
    })
    await expect(openWorkspaceWith(root, opener)).rejects.toThrow(
      '无法启动 Editor：permission denied',
    )
    expect(child.unref).not.toHaveBeenCalled()
  })
})
