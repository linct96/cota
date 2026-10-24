import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TerminalBinding, WorkspaceTarget } from '../../shared/contracts'
import {
  worktreeSetupSchema,
  type WorktreeSetupConfig,
  type WorktreeSetupRun,
  type WorktreeSetupSnapshot,
} from '../../shared/worktree-setup'
import type { ConfigStore } from '../config'
import type { WorktreeManager } from './worktree-manager'
import { absolutePath, terminalId } from '../validation'
import { validateTerminalBinding } from '../terminal/terminal-binding'
import { loginShellEnvironment, resolveShell } from '../system/shell'
import { stopProcessTree } from '../system/process-tree'
import { isWindows } from '../system/platform'

const LOG_LIMIT = 64 * 1024
const runSchema = z.object({
  status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  log: z.string().max(LOG_LIMIT),
  definition: worktreeSetupSchema,
})
interface Job {
  run: WorktreeSetupRun
  child?: ChildProcess
  cancelled: boolean
  cleanupFailed?: boolean
  done: Promise<void>
}

export class WorktreeSetupService {
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly config: ConfigStore,
    private readonly worktrees: WorktreeManager,
    private readonly directory: string,
  ) {}

  get running(): boolean {
    return this.worktrees.initializing.size > 0
  }

  definition(value: string): WorktreeSetupConfig {
    const path = absolutePath(value)
    if (!this.config.snapshot().recentProjects.includes(path)) throw new Error('请先打开项目目录。')
    return this.config.snapshot().worktreeSetups?.[path] || { command: '', copyFiles: [] }
  }

  async inspect(target: WorkspaceTarget): Promise<WorktreeSetupSnapshot> {
    return this.worktrees.withTerminalTarget(target, async (binding) => {
      const id = this.id(binding)
      return {
        definition: this.definition(binding.projectPath),
        run: await this.read(id),
        running: this.worktrees.initializing.has(id),
      }
    })
  }

  async start(
    target: WorkspaceTarget,
    expected: unknown,
    confirm: (description: string) => Promise<boolean>,
    assertCanStart: () => void = () => {},
  ): Promise<boolean> {
    const accepted = worktreeSetupSchema.parse(expected)
    return this.worktrees.withTerminalTarget(target, async (binding) => {
      const id = this.id(binding)
      this.config.assertWritable()
      if (this.worktrees.initializing.has(id)) throw new Error('工作区正在初始化，请勿重复执行。')
      const definition = this.definition(binding.projectPath)
      if (JSON.stringify(definition) !== JSON.stringify(accepted))
        throw new Error('初始化配置已改变，请刷新后重新确认。')
      if (!definition.command && !definition.copyFiles.length)
        throw new Error('请先在项目菜单中配置工作树初始化。')
      const previous = await this.read(id)
      const warning = previous
        ? '\n这是再次执行，命令可能重复修改数据；请先确认之前的进程已结束、命令可安全重试。'
        : ''
      if (
        !(await confirm(
          `将在 ${binding.cwd} 中初始化工作区。\n\n从 ${binding.projectPath} 复制指定文件（已有文件不覆盖）：\n${definition.copyFiles.join('\n') || '无'}\n\n执行命令：\n${definition.command || '无'}\n\n命令具有当前用户权限；失败会保留目录及已完成的修改。${warning}`,
        ))
      )
        return false
      await validateTerminalBinding(binding)
      if ((await realpath(binding.projectPath)) !== binding.projectPath)
        throw new Error('项目目录已改变，请重新打开。')
      assertCanStart()
      if (
        !this.config
          .snapshot()
          .layout?.workspaces.some(
            (workspace) =>
              workspace.id === binding.workspaceId &&
              workspace.projectPath === binding.projectPath &&
              workspace.worktreeId === id,
          )
      )
        throw new Error('工作区登记已改变，请重新选择。')
      if (JSON.stringify(this.definition(binding.projectPath)) !== JSON.stringify(definition))
        throw new Error('确认期间配置已改变，请重新确认。')
      let complete!: () => void
      const job: Job = {
        run: { status: 'running', startedAt: new Date().toISOString(), log: '', definition },
        cancelled: false,
        done: new Promise<void>((resolve) => {
          complete = resolve
        }),
      }
      this.worktrees.initializing.add(id)
      this.jobs.set(id, job)
      try {
        await this.persist(id, job.run)
      } catch (error) {
        this.worktrees.initializing.delete(id)
        this.jobs.delete(id)
        complete()
        throw error
      }
      void this.execute(binding, job)
        .then(async () => {
          job.run.status = job.cancelled ? 'interrupted' : 'succeeded'
          this.append(
            job,
            job.cancelled ? '\n初始化已停止；目录和已完成的修改已保留。\n' : '\n初始化完成。\n',
          )
        })
        .catch((error: unknown) => {
          job.run.status = job.cancelled ? 'interrupted' : 'failed'
          this.append(
            job,
            `\n${error instanceof Error ? error.message : String(error)}\n目录和已完成的修改已保留。\n`,
          )
        })
        .then(async () => {
          job.run.finishedAt = new Date().toISOString()
          try {
            await this.persist(id, job.run)
          } catch (error) {
            job.run.status = 'failed'
            this.append(job, `\n无法保存初始化结果：${String(error)}\n`)
            console.error('无法保存 Worktree 初始化结果', error)
          } finally {
            if (!job.cleanupFailed) this.worktrees.initializing.delete(id)
          }
        })
        .finally(complete)
      return true
    })
  }

  async stop(target: WorkspaceTarget): Promise<void> {
    // Do not hold the repository gate while waiting for the process to stop.
    const id = await this.worktrees.withTerminalTarget(target, async (binding) => this.id(binding))
    await this.stopJob(id)
  }

  async close(): Promise<void> {
    await Promise.all([...this.worktrees.initializing].map((id) => this.stopJob(id)))
  }

  private async stopJob(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job || !this.worktrees.initializing.has(id)) return
    job.cancelled = true
    if (job.child?.pid) await stopProcessTree(job.child.pid)
    await job.done
    job.cleanupFailed = false
    this.worktrees.initializing.delete(id)
  }

  private id(binding: TerminalBinding): string {
    if (
      binding.workspaceKind !== 'git-worktree' ||
      !binding.worktreeId ||
      binding.cwd === binding.projectPath
    )
      throw new Error('只能初始化已登记的独立 Git 工作树。')
    return terminalId(binding.worktreeId)
  }

  private append(job: Job, text: string): void {
    job.run.log = (job.run.log + text).slice(-LOG_LIMIT)
  }

  private async read(id: string): Promise<WorktreeSetupRun | undefined> {
    const job = this.jobs.get(id)
    if (job) return structuredClone(job.run)
    try {
      const file = join(this.directory, `${terminalId(id)}.json`)
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
        throw new Error('初始化日志文件无效。')
      const run = runSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      if (run.status === 'running') {
        run.status = 'interrupted'
        run.log = (run.log + '\n上次运行结果无法确认，不会自动重试；请先检查残留进程。\n').slice(
          -LOG_LIMIT,
        )
      }
      return run
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async persist(id: string, run: WorktreeSetupRun): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const file = join(this.directory, `${terminalId(id)}.json`)
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(run), { flag: 'wx', mode: 0o600 })
      await rename(temp, file)
    } finally {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  private async execute(binding: TerminalBinding, job: Job): Promise<void> {
    const checkCancelled = () => {
      if (job.cancelled) throw new Error('初始化已停止。')
    }
    for (const path of job.run.definition.copyFiles) {
      checkCancelled()
      await validateTerminalBinding(binding)
      await this.copyFile(binding.projectPath, binding.cwd, path, job)
    }
    checkCancelled()
    if (!job.run.definition.command) return
    const settings = this.config.snapshot().preferences
    const executable = await resolveShell(settings)
    const env = await loginShellEnvironment(settings)
    checkCancelled()
    await validateTerminalBinding(binding)
    checkCancelled()
    const command = job.run.definition.command
    const shellName = basename(executable).toLowerCase()
    const args =
      isWindows && ['cmd.exe', 'powershell.exe', 'pwsh.exe'].includes(shellName)
        ? shellName === 'cmd.exe'
          ? ['/d', '/s', '/c', command]
          : [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$ErrorActionPreference = 'Stop'\n${command}\nif (-not $?) { exit 1 }\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`,
            ]
        : ['-lc', command]
    this.append(job, `$ ${command}\n`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: binding.cwd,
        env,
        detached: !isWindows,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      job.child = child
      child.stdout!.setEncoding('utf8').on('data', (data: string) => this.append(job, data))
      child.stderr!.setEncoding('utf8').on('data', (data: string) => this.append(job, data))
      let cleanup = Promise.resolve()
      child.once('error', reject)
      child.once('exit', () => {
        // Clean up the owned group before waiting for inherited output pipes to close.
        cleanup = child.pid
          ? stopProcessTree(child.pid).catch((error) => {
              job.cleanupFailed = true
              this.append(job, `\n子进程清理失败，请点击停止重试：${String(error)}\n`)
            })
          : Promise.resolve()
      })
      child.once('close', (code, signal) => {
        void cleanup.then(() => {
          if (job.cleanupFailed) reject(new Error('子进程清理未完成。'))
          else if (code === 0 && !job.cancelled) resolve()
          else reject(new Error(`初始化命令退出：${signal || code}。`))
        })
      })
    })
  }

  private async copyFile(
    sourceRoot: string,
    targetRoot: string,
    path: string,
    job: Job,
  ): Promise<void> {
    const parts = path.split('/')
    let source = sourceRoot
    let target = targetRoot
    for (const part of parts.slice(0, -1)) {
      source = join(source, part)
      target = join(target, part)
      const info = await lstat(source)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`来源目录不可用或经过符号链接：${path}`)
      await mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      const destination = await lstat(target)
      if (
        !destination.isDirectory() ||
        destination.isSymbolicLink() ||
        (await realpath(target)) !== target
      )
        throw new Error(`目标目录不可用或经过符号链接：${path}`)
    }
    const name = parts.at(-1)!
    const sourcePath = join(source, name)
    const targetPath = join(target, name)
    if ((await realpath(source)) !== source || (await realpath(target)) !== target)
      throw new Error(`复制路径已改变：${path}`)
    const sourceInfo = await lstat(sourcePath)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
      throw new Error(`来源不是普通文件：${path}`)
    const input = await open(
      sourcePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | constants.O_NONBLOCK,
    )
    try {
      const info = await input.stat()
      if (!info.isFile() || info.size > 10 * 1024 * 1024)
        throw new Error(`只能复制 10 MB 以内的普通文件：${path}`)
      const existing = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink())
          throw new Error(`目标不是普通文件：${path}`)
        this.append(job, `保留已有文件：${path}\n`)
        return
      }
      const temp = join(target, `.cota-setup-${randomUUID()}.tmp`)
      try {
        await writeFile(temp, await input.readFile(), { flag: 'wx', mode: 0o600 })
        // An exclusive link publishes only complete files, never replacing a concurrent edit.
        await link(temp, targetPath)
        this.append(job, `已复制：${path}\n`)
      } finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    } finally {
      await input.close()
    }
  }
}
