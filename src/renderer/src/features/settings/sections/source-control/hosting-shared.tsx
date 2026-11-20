import { siGithub, siGitlab } from 'simple-icons'
import type {
  HostingAccount,
  HostingAccounts,
  HostingAccountsCacheEntry,
  HostingProvider,
} from '../../../../../../shared/code-hosting'
import { cn } from '@/lib/utils'

const HOSTING_PLATFORMS = {
  github: { name: 'GitHub', cli: 'gh' },
  gitlab: { name: 'GitLab', cli: 'glab' },
}

export type ConnectionStatus = {
  failure?: string
  cliUnavailable?: boolean
} & (HostingAccounts | { status: 'unchecked' } | { status: 'error'; message: string })

export function cachedConnection(
  entry?: HostingAccountsCacheEntry,
  failure?: string,
): ConnectionStatus {
  const error = failure || (entry?.failed ? '检测失败，请重新检测。' : undefined)
  if (entry?.result)
    return { ...entry.result, failure: error, cliUnavailable: entry.cliUnavailable }
  if (error) return { status: 'error', message: error }
  return { status: 'unchecked' }
}

export interface ProviderSummary {
  name: string
  cli: string
  cliUnavailable: boolean
  allAccounts: HostingAccount[]
  connectedCount: number
  errorCount: number
  badge: {
    label: string
    variant: 'secondary' | 'success' | 'warning' | 'destructive'
  }
  summaryText?: string
}

export function resolveProviderSummary(
  provider: HostingProvider,
  connection: ConnectionStatus,
): ProviderSummary {
  const { name, cli } = HOSTING_PLATFORMS[provider]
  const cliUnavailable = Boolean(
    connection.cliUnavailable || connection.status === 'cli-unavailable',
  )
  const unavailableMessage =
    connection.status === 'cli-unavailable'
      ? connection.message
      : `${cli} 不可用，请检查安装后重新检测。`
  const allAccounts = connection.status === 'detected' ? connection.accounts : []
  const connectedCount = allAccounts.filter((account) => account.status === 'connected').length
  const errorCount = allAccounts.filter((account) => account.status === 'error').length
  const hasConnectedAccount = connectedCount > 0
  const hasEndpointError = errorCount > 0

  const badge: ProviderSummary['badge'] = cliUnavailable
    ? { label: 'CLI 不可用', variant: 'warning' }
    : connection.failure || connection.status === 'error'
      ? { label: '检测失败', variant: 'destructive' }
      : hasConnectedAccount && hasEndpointError
        ? { label: '部分异常', variant: 'warning' }
        : hasConnectedAccount
          ? { label: '已连接', variant: 'success' }
          : hasEndpointError
            ? { label: '验证失败', variant: 'destructive' }
            : connection.status === 'unchecked'
              ? { label: '未检测', variant: 'secondary' }
              : { label: '未登录', variant: 'warning' }

  const summaryText = cliUnavailable
    ? unavailableMessage
    : 'message' in connection
      ? connection.message
      : connection.status === 'detected' && !hasConnectedAccount
        ? '请在终端重新登录后检测。'
        : undefined

  return {
    name,
    cli,
    cliUnavailable,
    allAccounts,
    connectedCount,
    errorCount,
    badge,
    summaryText,
  }
}

export function HostingPlatformIcon({
  provider,
  className,
}: {
  provider: HostingProvider
  className?: string
}) {
  const icon = provider === 'github' ? siGithub : siGitlab
  return (
    <svg
      className={cn('source-control-hosting-platform-icon size-4 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path className="source-control-hosting-platform-icon-path" d={icon.path} />
    </svg>
  )
}
