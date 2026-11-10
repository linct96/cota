import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { WorktreeErrorCode, WorktreeFailureDetails } from '../../shared/contracts'
import type { GitFailureDetails } from '../../shared/source-control'
import { projectDirectory } from '../validation'

const execFileAsync = promisify(execFile)
type CommandError = Error & {
  code?: string | number
  stdout?: Buffer
  stderr?: Buffer
  killed?: boolean
}
const gitLog = new AsyncLocalStorage<{ text: string }>()
const DIAGNOSTIC_LIMIT = 64000

export function withGitDiagnostics<T>(operation: () => Promise<T>): Promise<T> {
  return gitLog.run({ text: '' }, operation)
}

function recordGitCommand(
  cwd: string,
  args: string[],
  started: number,
  failure?: CommandError,
): GitFailureDetails | undefined {
  const log = gitLog.getStore()
  if (!log) return
  // Keep diagnostics local to this operation; never retain successful stdout (diffs/file contents).
  const clean = (value: string) =>
    value.replace(/(https?:\/\/)[^\s/]*@/gi, '$1***@').slice(0, DIAGNOSTIC_LIMIT)
  const command = clean(
    `git ${args.map((arg) => (/^[\w./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ')}`,
  )
  const output = clean(
    [failure?.stdout?.toString(), failure?.stderr?.toString()].filter(Boolean).join('\n').trim(),
  )
  log.text =
    `${log.text}[${new Date(started).toISOString()}] ${clean(cwd)}\n> ${command} [${Date.now() - started}ms, ${failure ? `exit ${failure.code ?? 'error'}` : 'ok'}]\n${output ? `${output}\n` : ''}`.slice(
      -DIAGNOSTIC_LIMIT,
    )
  if (failure)
    return {
      kind: /would be overwritten by (?:merge|checkout)|Entry .+ not uptodate\. Cannot merge\./i.test(
        output,
      )
        ? 'dirty-worktree'
        : 'command-failed',
      command,
      output,
      log: log.text,
    }
}

export class WorktreeError extends Error {
  constructor(
    readonly code: WorktreeErrorCode,
    message: string,
    readonly details?: WorktreeFailureDetails,
  ) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export function explainGitError(error: unknown, context?: string): Error {
  if (error instanceof WorktreeError && error.details?.git) {
    const message =
      error.details.git.kind === 'dirty-worktree'
        ? '请先清理仓库工作区改动，提交更改或使用 git stash 保存后再重试。'
        : context
          ? `${context}\n${error.message}`
          : error.message
    return new WorktreeError(error.code, message, error.details)
  }
  if (context) return new Error(`${context}\n${explainGitError(error).message}`)
  if (error instanceof WorktreeError && error.cause && typeof error.cause === 'object') {
    const cause = error.cause as { stderr?: Buffer; stdout?: Buffer; killed?: boolean }
    if (cause.killed)
      return new Error('Git 操作超时，结果可能已生效。请刷新核对后再操作，不要直接重复提交。')
    const detail = (cause.stderr?.toString() || cause.stdout?.toString())?.trim().slice(0, 8000)
    if (detail) return new Error(`${error.message}\n${detail}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

export async function resolveGitCommit(root: string, ref: string): Promise<string> {
  const oid = (
    await runGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
  ).trim()
  if (!/^[\da-f]{40}([\da-f]{24})?$/.test(oid)) throw new Error('Git 提交标识无效。')
  return oid
}

export function gitEnvironment(): NodeJS.ProcessEnv {
  // Git context/config overrides inherited from the launching shell must not redirect operations.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  return { ...env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' }
}

export async function runGitBytes(
  cwd: string,
  args: string[],
  writing = false,
  timeout = writing ? 120000 : 10000,
  input?: string,
): Promise<Buffer> {
  const started = Date.now()
  try {
    const command = execFileAsync('git', args, {
      cwd,
      env: { ...gitEnvironment(), ...(!writing && { GIT_OPTIONAL_LOCKS: '0' }) },
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'buffer',
      windowsHide: true,
    })
    const [{ stdout }] = await Promise.all([
      command,
      input === undefined ? undefined : pipeline(Readable.from([input]), command.child.stdin!),
    ])
    recordGitCommand(cwd, args, started)
    return stdout
  } catch (error) {
    const failure = error as CommandError
    const diagnostic = recordGitCommand(cwd, args, started, failure)
    const unavailable = failure.code === 'ENOENT' || failure.code === 'EACCES'
    if (unavailable) {
      try {
        await projectDirectory(cwd)
      } catch {
        throw new WorktreeError(
          'REPOSITORY_UNAVAILABLE',
          'Git 工作目录不可访问，可能已移动或删除。',
        )
      }
    }
    const message = unavailable
      ? 'Git 不存在或不可执行。'
      : failure.killed
        ? 'Git 操作超时，结果可能已生效。请刷新核对后再操作，不要直接重复提交。'
        : /You have not concluded your merge|MERGE_HEAD exists/.test(
              failure.stderr?.toString() || '',
            )
          ? '当前合并尚未提交，请先完成合并提交后再操作。'
          : 'Git 操作失败，请检查仓库权限与状态。'
    throw Object.assign(
      new WorktreeError(
        unavailable ? 'GIT_UNAVAILABLE' : 'GIT_COMMAND_FAILED',
        message,
        diagnostic ? { git: diagnostic } : undefined,
      ),
      { cause: failure },
    )
  }
}

export async function runGit(cwd: string, args: string[], writing = false): Promise<string> {
  return (await runGitBytes(cwd, args, writing)).toString('utf8')
}
