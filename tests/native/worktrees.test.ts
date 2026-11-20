import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService } from '../../src/main/git/worktrees/git'
import type { WorktreeManager } from '../../src/main/git/worktrees/manager'
import { WorktreeSetupService } from '../../src/main/git/worktrees/setup'
import { ConfigStore } from '../../src/main/settings/config-store'
import { isWindows, powershell } from '../../src/main/system/platform'
import * as shells from '../../src/main/system/shell'
import { gitAvailable, linkDirectory } from '../helpers/git'
import {
  git,
  input,
  removalOptions,
  worktreeTestDirectory,
  worktreeTestRepository,
} from '../helpers/worktrees'

const service = new GitService()
let root: string
let repo: string
let config: ConfigStore
let manager: WorktreeManager

describe.skipIf(!gitAvailable)('Native worktree paths and setup', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    root = await worktreeTestDirectory()
    ;({ repo, config, manager } = await worktreeTestRepository(root))
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('canonicalizes subdirectories and linked worktree .git files to the same repository', async () => {
    const child = join(repo, 'nested')
    const linked = join(root, 'linked 中文')
    await mkdir(child)
    await git(repo, 'worktree', 'add', '-b', 'other', linked)
    const base = await service.requireRepository(child)
    expect(base).toEqual({
      status: 'ready',
      projectPath: child,
      rootPath: repo,
      repoCommonDir: join(repo, '.git'),
      isBare: false,
    })
    expect((await service.requireRepository(linked)).repoCommonDir).toBe(base.repoCommonDir)
    expect((await lstat(join(linked, '.git'))).isFile()).toBe(true)
    expect(await service.listWorktrees(repo)).toContainEqual(
      expect.objectContaining({ path: linked, branch: 'other' }),
    )
    const alias = join(root, 'repo-alias')
    await linkDirectory(repo, alias)
    expect((await service.requireRepository(alias)).repoCommonDir).toBe(base.repoCommonDir)
  }, 15_000)

  describe('worktree setup', () => {
    const forbidden = isWindows
      ? "Set-Content -LiteralPath 'should-not-exist' -Value 'forbidden'"
      : 'printf forbidden > should-not-exist'
    const fixture = async () => {
      vi.spyOn(shells, 'resolveShell').mockResolvedValue(isWindows ? powershell : '/bin/sh')
      vi.spyOn(shells, 'loginShellEnvironment').mockResolvedValue(
        isWindows ? shells.shellEnvironment() : { PATH: '/usr/bin:/bin', HOME: root },
      )
      const created = await manager.createWorktree(input(repo))
      const directory = join(root, 'setup-logs')
      const setup = new WorktreeSetupService(config, manager, directory)
      return {
        ...created,
        setup,
        directory,
        target: { projectPath: repo, workspaceId: created.workspace.id },
      }
    }
    const settled = async (
      setup: WorktreeSetupService,
      target: { projectPath: string; workspaceId: string },
    ) => {
      await vi.waitFor(async () => expect((await setup.inspect(target)).running).toBe(false), {
        timeout: 8000,
        interval: 100,
      })
      return (await setup.inspect(target)).run!
    }
    it('confirms before copying, runs in the worktree, preserves edits on retry and persists the result', async () => {
      const { setup, record, target, directory } = await fixture()
      try {
        await writeFile(join(repo, '.env.local'), 'local-secret')
        await mkdir(join(repo, 'config'))
        await writeFile(join(repo, 'config/local.json'), '{"local":true}')
        const definition = {
          command: isWindows
            ? "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); [Console]::WriteLine($PWD.Path); [IO.File]::WriteAllText((Join-Path $PWD.Path 'initialized.txt'), 'ready')"
            : 'pwd; cat .env.local; printf ready > initialized.txt',
          copyFiles: ['.env.local', 'config/local.json'],
        }
        await config.saveWorktreeSetup(repo, definition)
        expect((await setup.inspect(target)).run).toBeUndefined()
        expect(await setup.start(target, definition, () => Promise.resolve(false))).toBe(false)
        await expect(lstat(join(record.path, '.env.local'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        const confirm = vi.fn((_description: string) => Promise.resolve(true))
        expect(await setup.start(target, definition, confirm)).toBe(true)
        expect(confirm.mock.calls[0][0]).toContain(record.path)
        expect(confirm.mock.calls[0][0]).toContain(repo)
        const first = await settled(setup, target)
        expect(first.status).toBe('succeeded')
        expect(first.log).toContain(record.path)
        expect(await readFile(join(record.path, 'config/local.json'), 'utf8')).toBe(
          '{"local":true}',
        )
        expect(await readFile(join(record.path, 'initialized.txt'), 'utf8')).toBe('ready')
        if (!isWindows)
          expect((await lstat(join(record.path, '.env.local'))).mode & 0o777).toBe(0o600)
        await writeFile(join(record.path, '.env.local'), 'edited')
        await setup.start(target, definition, () => Promise.resolve(true))
        expect((await settled(setup, target)).log).toContain('保留已有文件')
        expect(await readFile(join(record.path, '.env.local'), 'utf8')).toBe('edited')
        expect(await readFile(join(repo, '.env.local'), 'utf8')).toBe('local-secret')
        const reloaded = new WorktreeSetupService(config, manager, directory)
        expect((await reloaded.inspect(target)).run?.status).toBe('succeeded')
        expect(
          (await new ConfigStore(join(root, 'config.json')).load()).config.worktreeSetups?.[repo],
        ).toEqual(definition)
        const last = (await reloaded.inspect(target)).run!
        await writeFile(
          join(directory, `${record.id}.json`),
          JSON.stringify({ ...last, status: 'running' }),
        )
        const interrupted = await reloaded.inspect(target)
        expect(interrupted.running).toBe(false)
        expect(interrupted.run?.status).toBe('interrupted')
        expect(interrupted.run?.log).toContain('不会自动重试')
      } finally {
        await setup.close()
      }
    }, 30_000)
    it('rejects unsafe paths and symlinks before commands and keeps failed worktrees', async () => {
      const { setup, record, target } = await fixture()
      try {
        const outside = join(root, 'outside-secret')
        await writeFile(outside, 'keep')
        if (isWindows) await linkDirectory(root, join(repo, 'linked'))
        else await symlink(outside, join(repo, 'linked.env'))
        let definition = {
          command: forbidden,
          copyFiles: [isWindows ? 'linked/outside-secret' : 'linked.env'],
        }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, () => Promise.resolve(true))
        expect((await settled(setup, target)).status).toBe('failed')
        await mkdir(join(repo, 'config'))
        await writeFile(join(repo, 'config/secret'), 'secret')
        const outsideDirectory = join(root, 'outside-directory')
        await mkdir(outsideDirectory)
        await linkDirectory(outsideDirectory, join(record.path, 'config'))
        definition = { ...definition, copyFiles: ['config/secret'] }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, () => Promise.resolve(true))
        expect((await settled(setup, target)).status).toBe('failed')
        await expect(lstat(join(record.path, 'should-not-exist'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        await expect(lstat(join(outsideDirectory, 'secret'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        expect(await readFile(outside, 'utf8')).toBe('keep')
        expect(
          (await service.listWorktrees(repo)).some((entry) => entry.path === record.path),
        ).toBe(true)
      } finally {
        await setup.close()
      }
    }, 15000)
    it('blocks duplicate runs and removal, then stops the owned process and allows inspection', async () => {
      const { setup, target, record } = await fixture()
      try {
        const definition = {
          command: isWindows
            ? `[Console]::WriteLine('started'); Start-Sleep -Seconds 30; ${forbidden}`
            : `printf 'started\\n'; sleep 30; ${forbidden}`,
          copyFiles: [],
        }
        await config.saveWorktreeSetup(repo, definition)
        await setup.start(target, definition, () => Promise.resolve(true))
        await vi.waitFor(
          async () => expect((await setup.inspect(target)).run?.log).toMatch(/^started\r?$/m),
          { timeout: 5000 },
        )
        await expect(setup.start(target, definition, () => Promise.resolve(true))).rejects.toThrow(
          '重复执行',
        )
        expect((await manager.inspectRemoval(record.id, [])).blockers).toContain('INITIALIZING')
        await expect(manager.removeWorktree(record.id, removalOptions())).rejects.toMatchObject({
          code: 'REMOVAL_BLOCKED',
        })
        await expect(manager.unlinkWorktree(record.id, removalOptions())).rejects.toThrow(
          '停止工作区初始化',
        )
        await setup.stop(target)
        expect((await setup.inspect(target)).run?.status).toBe('interrupted')
        expect(setup.running).toBe(false)
        await expect(lstat(join(record.path, 'should-not-exist'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        await setup.close()
      }
    }, 15000)
    it('requires fresh configuration and rechecks shutdown authorization after confirmation', async () => {
      const { setup, target } = await fixture()
      const definition = { command: forbidden, copyFiles: [] }
      await config.saveWorktreeSetup(repo, definition)
      await expect(
        setup.start(target, { ...definition, command: 'old command' }, () => Promise.resolve(true)),
      ).rejects.toThrow('配置已改变')
      await expect(
        setup.start(target, definition, async () => {
          await config.saveWorktreeSetup(repo, { ...definition, command: 'updated' })
          return true
        }),
      ).rejects.toThrow('确认期间配置已改变')
      await config.saveWorktreeSetup(repo, definition)
      await expect(
        setup.start(
          target,
          definition,
          () => Promise.resolve(true),
          () => {
            throw new Error('正在退出')
          },
        ),
      ).rejects.toThrow('正在退出')
      expect((await setup.inspect(target)).run).toBeUndefined()
      expect(setup.running).toBe(false)
    }, 15_000)
  })
})
