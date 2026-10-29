import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  hostingHostSchema,
  hostingProviderSchema,
  type HostingAccounts,
  type HostingProvider,
} from '../../shared/code-hosting'
import { hostingCLI, HostingError } from './cli-runner'

const execute = promisify(execFile)
const accountName = z
  .string()
  .max(256)
  .refine((value) => !/\p{Cc}/u.test(value))
const githubStatus = z.object({
  hosts: z.record(
    hostingHostSchema,
    z.array(
      z.object({
        host: hostingHostSchema,
        login: accountName,
        active: z.boolean(),
        state: z.enum(['success', 'error', 'timeout', 'refresh_expired']),
      }),
    ),
  ),
})
const gitlabStatus = z.object({
  hosts: z.array(
    z.object({
      host: hostingHostSchema,
      user: accountName.optional(),
      state: z.enum(['success', 'error']),
    }),
  ),
})
const noAccounts = (): HostingAccounts => ({
  status: 'disconnected',
  message: '未发现已登录账号，请先在终端完成 CLI 登录授权，再重新检测。',
})

export function parseHostingAccounts(provider: HostingProvider, output: string): HostingAccounts {
  try {
    const data: unknown = JSON.parse(output)
    const accounts =
      provider === 'github'
        ? Object.values(githubStatus.parse(data).hosts)
            .flat()
            .map((entry) => ({
              host: entry.host,
              account: entry.login,
              active: entry.active,
              status: entry.state === 'success' ? ('connected' as const) : ('error' as const),
            }))
        : gitlabStatus.parse(data).hosts.map((entry) => ({
            host: entry.host,
            account: entry.user || '',
            active: true,
            status: entry.state === 'success' ? ('connected' as const) : ('error' as const),
          }))
    if (accounts.some((entry) => entry.status === 'connected' && !entry.account))
      throw new Error('Missing account')
    return accounts.length ? { status: 'detected', accounts } : noAccounts()
  } catch {
    // Never propagate CLI payloads: they may contain credentials or raw server errors.
    throw new HostingError('response', '账号列表格式无法识别，请更新官方 CLI 后重试。')
  }
}

export async function scanHostingAccounts(providerValue: unknown): Promise<HostingAccounts> {
  const provider = hostingProviderSchema.parse(providerValue)
  let cli: Awaited<ReturnType<typeof hostingCLI>>
  try {
    cli = await hostingCLI(provider)
  } catch (error) {
    if (error instanceof HostingError && error.kind === 'cli')
      return { status: 'cli-unavailable', message: error.message }
    throw error
  }
  const args =
    provider === 'github'
      ? ['auth', 'status', '--json', 'hosts', '--no-refresh']
      : ['auth', 'status', '--all', '--output', 'json']
  let output: string
  try {
    output = (
      await execute(cli.executable, args, {
        cwd: homedir(),
        env: cli.env,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      })
    ).stdout
  } catch (error) {
    const failure = error as {
      stdout?: string
      stderr?: string
      code?: number | string
      killed?: boolean
    }
    // glab exits with 1 even when JSON contains healthy hosts alongside failed ones.
    if (failure.code === 1 && failure.stdout?.trim()) output = failure.stdout
    else if (
      failure.code === 1 &&
      /no GitLab instances have been authenticated with glab/i.test(failure.stderr || '')
    )
      return noAccounts()
    else if (failure.code === 'ENOENT' || failure.code === 'EACCES')
      return { status: 'cli-unavailable', message: 'CLI 不可执行，请检查安装后重试。' }
    else
      throw new HostingError(
        'response',
        failure.killed
          ? '账号扫描超时，请检查网络后重新检测。'
          : '账号扫描失败，请检查网络，并确认官方 CLI 支持 JSON 状态输出后重试。',
      )
  }
  return parseHostingAccounts(provider, output)
}
