import { spawn } from 'node:child_process'
import type { Preferences } from '../../shared/contracts'
import type { CommitMessageContext, CommitMessageResult } from '../../shared/commit-message'
import { buildCommitMessagePrompt, cleanCommitMessage } from '../git/commit-message-prompt'
import { stopProcessTree } from '../system/process-tree'
import { resolveAgent } from './registry'

type Request = { id: string; controller: AbortController; done: Promise<CommitMessageResult> }

export class CommitMessageService {
  private readonly requests = new Map<string, Request>()
  private readonly directories = new Map<string, AbortController>()

  generate(
    key: string,
    requestId: string,
    settings: Preferences,
    readContext: (signal: AbortSignal) => Promise<CommitMessageContext>,
    validateContext: (context: CommitMessageContext, signal: AbortSignal) => Promise<void>,
  ): Promise<CommitMessageResult> {
    if (this.requests.has(key)) return Promise.reject(new Error('当前工作区正在生成提交信息。'))
    const controller = new AbortController()
    const done = this.execute(controller, settings, readContext, validateContext).finally(() => {
      if (this.requests.get(key)?.controller === controller) this.requests.delete(key)
    })
    this.requests.set(key, { id: requestId, controller, done })
    return done
  }

  async cancel(key: string, requestId: string): Promise<void> {
    const request = this.requests.get(key)
    if (request?.id !== requestId) return
    request.controller.abort()
    await request.done.catch(() => {})
  }

  async close(): Promise<void> {
    const requests = [...this.requests.values()]
    for (const request of requests) request.controller.abort()
    await Promise.all(requests.map((request) => request.done.catch(() => {})))
  }

  private async execute(
    controller: AbortController,
    settings: Preferences,
    readContext: (signal: AbortSignal) => Promise<CommitMessageContext>,
    validateContext: (context: CommitMessageContext, signal: AbortSignal) => Promise<void>,
  ): Promise<CommitMessageResult> {
    const { signal } = controller
    let directory: string | undefined
    try {
      const context = await readContext(signal)
      signal.throwIfAborted()
      directory = process.platform === 'win32' ? context.rootPath.toLowerCase() : context.rootPath
      if (this.directories.has(directory))
        throw new Error('此工作目录正在生成提交信息，请稍后重试。')
      this.directories.set(directory, controller)
      const command = await resolveAgent('pi', settings)
      signal.throwIfAborted()
      const output = await runPi(
        command,
        context.rootPath,
        buildCommitMessagePrompt(context, settings.commitMessagePrompt ?? ''),
        signal,
      )
      signal.throwIfAborted()
      await validateContext(context, signal)
      signal.throwIfAborted()
      return {
        canceled: false,
        message: cleanCommitMessage(output),
        indexVersion: context.indexVersion,
        branch: context.branch,
      }
    } catch (error) {
      if (signal.aborted) return { canceled: true }
      throw error
    } finally {
      if (directory && this.directories.get(directory) === controller)
        this.directories.delete(directory)
    }
  }
}

async function runPi(
  command: Awaited<ReturnType<typeof resolveAgent>>,
  cwd: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const child = spawn(
    command.executable,
    [
      ...command.args,
      '--print',
      '--no-session',
      '--no-tools',
      '--no-skills',
      '--no-context-files',
      '--mode',
      'text',
    ],
    {
      cwd,
      env: Object.fromEntries(
        Object.entries(command.env).filter(([key]) => !key.startsWith('GIT_')),
      ),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  )
  let failure: Error | undefined
  let termination: Promise<void> | undefined
  const stop = (error: Error) => {
    failure ??= error
    if (!termination && child.pid) {
      termination = stopProcessTree(child.pid).catch(() => {
        child.kill('SIGKILL')
      })
    }
  }
  const abort = () => stop(new Error('已取消生成。'))
  const timer = setTimeout(
    () => stop(new Error('Pi 生成超过 60 秒，请检查网络或默认模型后重试。')),
    60_000,
  )
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Buffer[] = []
  let bytes = 0
  const collect = (chunk: Buffer, stdout: boolean) => {
    bytes += chunk.length
    if (bytes > 256 * 1024) stop(new Error('Pi 输出超过限制，请检查 CLI 扩展配置后重试。'))
    else if (stdout) chunks.push(chunk)
  }
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, true))
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, false))
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') stop(new Error('无法将改动发送给 Pi，请重试。'))
  })
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', () => reject(new Error('无法启动 Pi，请检查其安装和运行权限。')))
      child.once('close', resolve)
    })
    if (signal.aborted) abort()
    else child.stdin.end(prompt)
    const code = await exited
    if (termination) await termination
    signal.throwIfAborted()
    if (failure) throw failure
    if (code !== 0)
      throw new Error('Pi 生成失败。请在终端运行 pi，确认登录状态、默认模型及网络后重试。')
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
