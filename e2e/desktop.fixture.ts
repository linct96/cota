import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join, resolve, relative } from 'node:path'
import { promisify } from 'node:util'
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_CONFIG, type AppConfig, type TerminalSession } from '../src/shared/contracts'
import { HostClient, hostDirectory } from '../src/main/host/host-client'
import { HOST_PROTOCOL } from '../src/main/host/host-protocol'
import { stopProcessTree } from '../src/main/system/process-tree'

const exec = promisify(execFile)
const electronPath = require('electron') as string
const hostEntry = resolve('out/main/host.js')

async function optionalText(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return ''
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return false
  }
}

export type Desktop = {
  root: string
  repo: string
  home: string
  profile: string
  hostPath: string
  readonly page: Page
  readonly electron: ElectronApplication
  git(...args: string[]): Promise<string>
  config(): Promise<AppConfig>
  sessions(): Promise<TerminalSession[]>
  openProject(path?: string | null): Promise<void>
  terminalCommand(command: string): Promise<void>
  close(): Promise<void>
  restart(): Promise<void>
}

export const test = base.extend<{ desktop: Desktop }>({
  desktop: [
    async ({ playwright }, run, testInfo) => {
      const root = await realpath(await mkdtemp('/tmp/cota-e2e-'))
      const home = join(root, 'home')
      const repo = join(root, 'sample-project')
      const profile = join(root, 'profile', 'Cota Dev')
      const hostPath = hostDirectory(profile)
      const logs: string[] = []
      const rendererErrors: string[] = []
      const tracePaths: string[] = []
      let electron: ElectronApplication | undefined
      let page: Page | undefined
      let generation = 0
      let tracing = false
      let cleanupError: unknown
      let fixtureFailed = false
      const env: Record<string, string> = {
        HOME: home,
        USER: process.env.USER || 'cota-e2e',
        LOGNAME: process.env.LOGNAME || 'cota-e2e',
        TMPDIR: process.env.TMPDIR || '/tmp',
        PATH: `${join(root, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: '/bin/bash',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
        GIT_TERMINAL_PROMPT: '0',
        CODEX_HOME: join(home, '.codex'),
        GROK_HOME: join(home, '.grok'),
        PI_CODING_AGENT_DIR: join(home, '.pi', 'agent'),
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_CACHE_HOME: join(home, '.cache'),
        XDG_DATA_HOME: join(home, '.local', 'share'),
        GH_CONFIG_DIR: join(home, '.config', 'gh'),
        GLAB_CONFIG_DIR: join(home, '.config', 'glab-cli'),
        COTA_E2E_ROOT: root,
      }

      async function git(...args: string[]) {
        return (await exec('/usr/bin/git', args, { cwd: repo, env })).stdout.trim()
      }

      async function withHost<T>(action: (client: HostClient) => Promise<T>): Promise<T> {
        const info = JSON.parse(await readFile(join(hostPath, 'runtime.json'), 'utf8'))
        assert.equal(info.version, HOST_PROTOCOL)
        assert.match(info.token, /^[a-f0-9]{64}$/)
        assert.ok(Number.isSafeInteger(info.pid) && info.pid > 1)
        const socket = connect(join(hostPath, 'host.sock'))
        socket.setTimeout(10_000, () => socket.destroy(new Error('E2E Host request timeout')))
        const client = new HostClient(socket, () => {})
        try {
          await client.request('hello', [info.token, HOST_PROTOCOL])
          return await action(client)
        } finally {
          client.disconnect()
        }
      }

      async function stopTracing() {
        if (!tracing || !electron) return
        tracing = false
        const path = testInfo.outputPath(`trace-${generation}.zip`)
        await electron.context().tracing.stop({ path })
        tracePaths.push(path)
      }

      async function close() {
        if (
          !electron ||
          !page ||
          electron.process().exitCode !== null ||
          electron.process().signalCode !== null
        )
          return
        const shells = await withHost((client) => client.request('processRoots', []))
        await stopTracing()
        const closed = electron.waitForEvent('close', { timeout: 15_000 })
        void closed.catch(() => {})
        // app.quit enters the same guarded shutdown as the macOS Quit menu.
        await electron.evaluate(({ app }) => {
          setImmediate(() => app.quit())
        })
        if (shells.length) {
          const confirmation = page.getByRole('alertdialog', { name: '退出 Cota？' })
          await confirmation.getByRole('button', { name: '结束终端并退出' }).click()
        }
        await closed
        await expect
          .poll(async () => {
            const info = await optionalText(join(hostPath, 'runtime.json'))
            return !info || !alive(JSON.parse(info).pid)
          })
          .toBe(true)
        for (const shell of shells) await expect.poll(() => alive(shell.pid)).toBe(false)
        electron = undefined
        page = undefined
      }

      async function start() {
        generation++
        electron = await playwright._electron.launch({
          args: [resolve('e2e/launch.cjs')],
          cwd: process.cwd(),
          env,
          chromiumSandbox: true,
          timeout: 20_000,
        })
        assert.equal(electron.process().spawnfile, electronPath)
        electron.process().stdout?.on('data', (chunk) => logs.push(`[main] ${chunk}`))
        electron.process().stderr?.on('data', (chunk) => logs.push(`[main] ${chunk}`))
        await electron
          .context()
          .tracing.start({ screenshots: true, snapshots: true, sources: true })
        tracing = true
        page = await electron.firstWindow({ timeout: 15_000 })
        page.on('console', (message) =>
          logs.push(`[renderer:${message.type()}] ${message.text()}\n`),
        )
        page.on('pageerror', (error) => rendererErrors.push(error.stack || error.message))
        await expect(page.getByRole('button', { name: '添加项目', exact: true })).toBeEnabled()
        const paths = await electron.evaluate(({ app, BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents
          return {
            home: app.getPath('home'),
            profile: app.getPath('userData'),
            session: app.getPath('sessionData'),
            sandboxed: app.getAppMetrics().find((entry) => entry.pid === contents.getOSProcessId())
              ?.sandboxed,
            noSandbox: app.commandLine.hasSwitch('no-sandbox'),
            homeEnvironment: process.env.HOME,
          }
        })
        assert.equal(paths.home, home)
        assert.equal(paths.homeEnvironment, home)
        assert.equal(paths.profile, profile)
        assert.equal(paths.session, profile)
        assert.equal(paths.sandboxed, true)
        expect(JSON.parse(await readFile(join(root, 'security.json'), 'utf8'))).toEqual({
          sandboxed: true,
          contextIsolated: true,
        })
        assert.equal(paths.noSandbox, false)
        expect(
          await page.evaluate(() => ({ node: typeof process, loader: typeof require })),
        ).toEqual({ node: 'undefined', loader: 'undefined' })
      }

      const desktop: Desktop = {
        root,
        home,
        repo,
        profile,
        hostPath,
        get page() {
          assert.ok(page)
          return page
        },
        get electron() {
          assert.ok(electron)
          return electron
        },
        git,
        config: async () => JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')),
        sessions: () => withHost((client) => client.request('list', [])),
        async openProject(path = repo) {
          if (path !== null) assert.ok(!relative(root, await realpath(path)).startsWith('..'))
          await desktop.electron.evaluate(({ dialog }, selected) => {
            const original = dialog.showOpenDialog
            dialog.showOpenDialog = async () => {
              dialog.showOpenDialog = original
              return { canceled: selected === null, filePaths: selected === null ? [] : [selected] }
            }
          }, path)
          await desktop.page.getByRole('button', { name: '添加项目', exact: true }).click()
          if (path !== null) {
            await expect(
              desktop.page.getByRole('region', { name: 'sample-project 项目', exact: true }),
            ).toBeVisible()
            await expect(desktop.page.locator('.terminal-view:visible .xterm-rows')).toContainText(
              'cota-e2e$',
            )
          }
        },
        async terminalCommand(command) {
          const input = desktop.page.locator('.terminal-view:visible .xterm-helper-textarea')
          await expect(input).toBeVisible()
          await input.focus()
          await input.pressSequentially(command)
          await input.press('Enter')
        },
        close,
        async restart() {
          await close()
          await start()
        },
      }

      try {
        for (const directory of [
          home,
          repo,
          profile,
          join(root, 'bin'),
          join(root, 'logs'),
          join(root, 'crashes'),
        ])
          await mkdir(directory, { recursive: true, mode: 0o700 })
        await writeFile(join(root, '.e2e'), root, { mode: 0o600 })
        await writeFile(
          env.GIT_CONFIG_GLOBAL,
          '[user]\n name = Cota E2E\n email = e2e@example.invalid\n[commit]\n gpgsign = false\n[tag]\n gpgsign = false\n[core]\n hooksPath = /dev/null\n[credential]\n helper =\n[protocol]\n allow = never\n',
          { mode: 0o600 },
        )
        await writeFile(
          join(home, '.bash_profile'),
          `export PATH='${env.PATH}'\nexport PS1='cota-e2e$ '\nunset PROMPT_COMMAND HISTFILE\n`,
        )
        // Main strips GIT_* overrides; reapply isolation at the real Git executable boundary.
        const gitLauncher = join(root, 'bin', 'git')
        await writeFile(
          gitLauncher,
          '#!/bin/sh\nexport GIT_CONFIG_NOSYSTEM=1\nexport GIT_CONFIG_GLOBAL="$HOME/.gitconfig"\nexec /usr/bin/git "$@"\n',
        )
        await chmod(gitLauncher, 0o700)
        for (const cli of ['codex', 'claude', 'pi', 'grok', 'gh', 'glab']) {
          const file = join(root, 'bin', cli)
          await writeFile(
            file,
            '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$HOME/cli-calls.log"\nprintf "E2E: external CLI unavailable\\n" >&2\nexit 127\n',
          )
          await chmod(file, 0o700)
        }
        const config = structuredClone(DEFAULT_CONFIG)
        Object.assign(config.preferences, {
          shellPath: '/bin/bash',
          shellName: 'Bash',
          theme: 'light',
          terminalGpuAcceleration: 'off',
          notificationsEnabled: false,
          preventSleep: false,
        })
        await writeFile(join(profile, 'config.json'), JSON.stringify(config), { mode: 0o600 })
        await writeFile(join(repo, 'README.md'), 'COTA_ORIGINAL\n')
        await writeFile(join(repo, 'notes.txt'), 'COTA_NOTES\n')
        await git('init', '-b', 'main')
        await git('add', '.')
        await git('commit', '-m', 'Initial E2E fixture')
        await start()
        await run(desktop)
        expect(rendererErrors, 'renderer must not throw uncaught errors').toEqual([])
        expect(
          await optionalText(join(root, 'boundaries.log')),
          'unexpected native/network boundary',
        ).toBe('')
      } catch (error) {
        fixtureFailed = true
        throw error
      } finally {
        const failed = fixtureFailed || testInfo.status !== testInfo.expectedStatus
        if (failed && page && !page.isClosed()) {
          await page
            .screenshot({ path: testInfo.outputPath('failure.png'), timeout: 3000 })
            .then((body) => testInfo.attach('failure', { body, contentType: 'image/png' }))
            .catch((error) => logs.push(String(error)))
          await withHost((client) => client.request('list', []))
            .then((sessions) => logs.push(`sessions: ${JSON.stringify(sessions)}\n`))
            .catch((error) => logs.push(String(error)))
          await git('status', '--porcelain=v1', '--branch')
            .then((status) => logs.push(`Git status: ${status}\n`))
            .catch((error) => logs.push(String(error)))
        }
        try {
          await close()
        } catch (error) {
          cleanupError = error
          logs.push(`normal shutdown failed: ${String(error)}\n`)
        }
        try {
          await stopTracing().catch((error) => logs.push(String(error)))
          const text = await optionalText(join(hostPath, 'runtime.json'))
          if (text) {
            const info = JSON.parse(text)
            assert.ok(Number.isSafeInteger(info.pid) && info.pid > 1)
            if (alive(info.pid)) {
              await withHost((client) => client.request('shutdown', [])).catch(async () => {
                const { stdout } = await exec('/bin/ps', ['-p', String(info.pid), '-o', 'command='])
                assert.equal(
                  stdout.trim(),
                  `${electronPath} ${hostEntry}`,
                  'refuse to stop an unknown Host',
                )
                await stopProcessTree(info.pid)
              })
              await expect.poll(() => alive(info.pid), { timeout: 10_000 }).toBe(false)
            }
          }
        } catch (error) {
          cleanupError ??= error
          logs.push(`Host cleanup failed: ${String(error)}\n`)
        } finally {
          if (
            electron &&
            electron.process().exitCode === null &&
            electron.process().signalCode === null
          ) {
            const child = electron.process()
            const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
            child.kill('SIGKILL')
            await exited
          }
        }
        if (failed || cleanupError) {
          logs.push(`isolated root: ${root}\n`, ...rendererErrors)
          for (const [name, path] of [
            ['host', join(root, 'host.log')],
            ['boundaries', join(root, 'boundaries.log')],
            ['cli', join(home, 'cli-calls.log')],
          ])
            logs.push(`\n[${name}]\n${await optionalText(path)}`)
          await testInfo.attach('logs', {
            body: logs.join('').slice(-200_000),
            contentType: 'text/plain',
          })
          for (const path of tracePaths)
            await testInfo.attach('trace', { path, contentType: 'application/zip' })
        } else {
          for (const path of tracePaths) await rm(path, { force: true })
        }
        if (!cleanupError) {
          assert.equal(await readFile(join(root, '.e2e'), 'utf8'), root)
          await rm(hostPath, { recursive: true, force: true })
          await rm(root, { recursive: true, force: true })
        }
      }
      if (cleanupError) throw cleanupError
    },
    { timeout: 60_000 },
  ],
})

export { expect } from '@playwright/test'
