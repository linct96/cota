import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { WorktreeErrorCode, WorktreeFailureDetails } from '../../shared/contracts'
import { projectDirectory } from '../validation'

const execFileAsync = promisify(execFile)
type CommandError = Error & { code?: string | number; stderr?: Buffer; killed?: boolean }

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

export function explainGitError(error: unknown): Error {
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
    return stdout
  } catch (error) {
    const failure = error as CommandError
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
        ? 'Git 操作超时，需重新检查仓库状态。'
        : 'Git 操作失败，请检查仓库权限与状态。'
    throw Object.assign(
      new WorktreeError(unavailable ? 'GIT_UNAVAILABLE' : 'GIT_COMMAND_FAILED', message),
      { cause: failure },
    )
  }
}

export async function runGit(cwd: string, args: string[], writing = false): Promise<string> {
  return (await runGitBytes(cwd, args, writing)).toString('utf8')
}
