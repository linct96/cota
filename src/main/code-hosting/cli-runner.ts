import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import type { HostingRepository, HostingFailure } from '../../shared/code-hosting'
import { hostingHostSchema, hostingProviderSchema } from '../../shared/code-hosting'
import { findExecutable, loginShellEnvironment } from '../system/shell'

export type { HostingFailure } from '../../shared/code-hosting'
export class HostingError extends Error {
  constructor(
    readonly kind: HostingFailure,
    message: string,
  ) {
    super(message)
  }
}
export type HostingRequest = (
  repository: Pick<HostingRepository, 'provider' | 'host'>,
  endpoint: string,
  body?: Record<string, unknown>,
) => Promise<unknown>
const execute = promisify(execFile)
const cooldowns = new Map<string, number>()
let environment: ReturnType<typeof loginShellEnvironment> | undefined

export async function hostingCLI(providerValue: unknown) {
  const provider = hostingProviderSchema.parse(providerValue)
  const command = provider === 'github' ? 'gh' : 'glab'
  const env = {
    ...(await (environment ||= loginShellEnvironment())),
    GH_PROMPT_DISABLED: '1',
    GLAB_NO_PROMPT: '1',
    NO_COLOR: '1',
    GH_PAGER: 'cat',
    PAGER: 'cat',
  }
  let executable: string
  try {
    executable = await findExecutable(command, env)
  } catch {
    throw new HostingError('cli', `找不到 ${command}，请自行安装官方 CLI 后重试。`)
  }
  return { executable, env }
}

export const hostingRequest: HostingRequest = async (repository, endpoint, body) => {
  const provider = hostingProviderSchema.parse(repository.provider)
  const host = hostingHostSchema.parse(repository.host)
  const bucket = `${provider}:${host}`
  if ((cooldowns.get(bucket) || 0) > Date.now())
    throw new HostingError('rate-limit', '平台请求已限流，请一分钟后重试。')
  const command = provider === 'github' ? 'gh' : 'glab'
  const cli = await hostingCLI(provider)
  const env = { ...cli.env, GH_HOST: host, GITLAB_HOST: host }
  try {
    const args = ['api', '--hostname', host, '--method', body ? 'POST' : 'GET', endpoint]
    if (body) args.push('--input', '-')
    const child = execute(cli.executable, args, {
      cwd: homedir(),
      env,
      timeout: body ? 45000 : 15000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    })
    const [{ stdout }] = await Promise.all([
      child,
      body ? pipeline(Readable.from([JSON.stringify(body)]), child.child.stdin!) : undefined,
    ])
    try {
      return JSON.parse(stdout) as unknown
    } catch {
      throw new HostingError('response', 'CLI 返回了无法识别的数据，请检查 CLI 版本。')
    }
  } catch (error) {
    if (error instanceof HostingError) throw error
    const failure = error as { stderr?: string; code?: string; killed?: boolean }
    const text = failure.stderr || ''
    // Only classify stderr; never expose tokens, URLs with credentials, or response bodies.
    if (/rate.?limit|HTTP 429/i.test(text)) {
      cooldowns.set(bucket, Date.now() + 60000)
      throw new HostingError('rate-limit', '平台请求已限流，请一分钟后重试。')
    }
    if (/HTTP 401|not logged|authenticate|auth login|authentication/i.test(text))
      throw new HostingError(
        'auth',
        `未登录或凭据已失效，请在终端运行 ${command} auth login --hostname ${host}。`,
      )
    if (/HTTP 403|forbidden/i.test(text))
      throw new HostingError('forbidden', '无权访问，请检查账号权限、Token 范围和组织 SSO。')
    if (/HTTP 404|not found/i.test(text))
      throw new HostingError('not-found', '仓库或分支不存在，或当前账号无权访问。')
    if (/HTTP (400|409|422)\b/i.test(text))
      throw new HostingError(
        'rejected',
        '平台拒绝创建，请检查目标分支、差异或已有评审；必要时在网页处理。',
      )
    if (failure.code === 'ENOENT' || failure.code === 'EACCES')
      throw new HostingError('cli', `${command} 不可执行，请检查 CLI 安装。`)
    throw new HostingError(
      'network',
      failure.killed
        ? '平台请求超时，请检查网络后刷新。'
        : '平台请求失败，请检查网络、Host 和 CLI 版本后刷新。',
    )
  }
}
