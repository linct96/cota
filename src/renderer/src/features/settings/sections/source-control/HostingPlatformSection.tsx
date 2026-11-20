import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { unwrap } from '../../../../../../shared/contracts'
import { hostingProviderSchema } from '../../../../../../shared/code-hosting'
import type {
  HostingAccount,
  HostingAccounts,
  HostingAccountsCacheSnapshot,
  HostingProvider,
} from '../../../../../../shared/code-hosting'
import { cn } from '@/lib/utils'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'
import { DotStatus } from '@/components/DotStatus'
import { LoadingContent } from '@/components/LoadingContent'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { HostingPlatformIcon, cachedConnection, resolveProviderSummary } from './hosting-shared'
import type { ConnectionStatus, ProviderSummary } from './hosting-shared'

function endpointStatusLabel(
  provider: HostingProvider,
  account: HostingAccount,
  cliUnavailable: boolean,
): { label: string; className: string } {
  if (cliUnavailable) {
    return { label: '缓存', className: 'text-muted-foreground' }
  }
  if (account.status !== 'connected') {
    return { label: '验证失败', className: 'font-medium text-destructive' }
  }
  if (provider === 'github' && account.active) {
    return { label: '当前激活', className: 'font-medium text-success' }
  }
  return { label: '已连接', className: 'text-muted-foreground' }
}

function HostingPlatformSubtitle({
  provider,
  connection,
  summary,
}: {
  provider: HostingProvider
  connection: ConnectionStatus
  summary: ProviderSummary
}) {
  const { allAccounts, cliUnavailable, errorCount, summaryText } = summary
  const count = allAccounts.length

  if (count === 1) {
    const only = allAccounts[0]
    return (
      <div className="source-control-hosting-platform-detail-group flex flex-col gap-0.5">
        <p className="source-control-hosting-platform-inline-account break-all text-xs text-muted-foreground select-text">
          <span className="source-control-hosting-endpoint-host font-mono text-foreground [unicode-bidi:plaintext]">
            {only.host}
          </span>
          <span className="source-control-hosting-endpoint-account">
            {' '}
            · @{only.account || '账号不可用'}
          </span>
          {cliUnavailable && <span className="text-warning"> · 上次缓存</span>}
        </p>
        {summaryText && (
          <p className="source-control-hosting-platform-detail break-all text-xs text-muted-foreground select-text">
            {summaryText}
          </p>
        )}
        {connection.failure && (
          <output className="source-control-hosting-platform-error text-xs text-destructive">
            {connection.failure} 显示上次结果。
          </output>
        )}
      </div>
    )
  }

  if (count >= 2) {
    const highlighted =
      (provider === 'github'
        ? allAccounts.find((account) => account.active && account.status === 'connected')
        : undefined) ??
      allAccounts.find((account) => account.status === 'connected') ??
      allAccounts[0]

    return (
      <div className="source-control-hosting-platform-detail-group flex flex-col gap-0.5">
        <p className="source-control-hosting-platform-multi-summary break-all text-xs text-muted-foreground select-text">
          <span>{count} 个端点</span>
          {errorCount > 0 && (
            <>
              {' · '}
              <span className="text-destructive">{errorCount} 个异常</span>
            </>
          )}
          {' · '}
          <span className="font-mono text-foreground [unicode-bidi:plaintext]">
            {highlighted.host}
          </span>
          <span> (@{highlighted.account || '账号不可用'})</span>
        </p>
        {cliUnavailable && summaryText && (
          <p className="source-control-hosting-platform-detail break-all text-xs text-warning select-text">
            {summaryText}
          </p>
        )}
        {connection.failure && (
          <output className="source-control-hosting-platform-error text-xs text-destructive">
            {connection.failure} 显示上次结果。
          </output>
        )}
      </div>
    )
  }

  if (!summaryText && !connection.failure) return null

  return (
    <div className="source-control-hosting-platform-detail-group flex flex-col gap-0.5">
      {summaryText && (
        <p className="source-control-hosting-platform-detail break-all text-xs text-muted-foreground select-text">
          {summaryText}
        </p>
      )}
      {connection.failure && (
        <output className="source-control-hosting-platform-error text-xs text-destructive">
          {connection.failure}
        </output>
      )}
    </div>
  )
}

function HostingPlatformRow({
  provider,
  connection,
  expanded,
  detecting,
  onExpandedChange,
  onDetect,
}: {
  provider: HostingProvider
  connection: ConnectionStatus
  expanded: boolean
  detecting: boolean
  onExpandedChange: (open: boolean) => void
  onDetect: (provider: HostingProvider) => void
}) {
  const detectingVisible = useLoadingIndicator(detecting)
  const summary = resolveProviderSummary(provider, connection)
  const hasMultipleAccounts = summary.allAccounts.length >= 2
  const isExpanded = hasMultipleAccounts && expanded

  const identityContent = (
    <>
      <HostingPlatformIcon
        provider={provider}
        className="source-control-hosting-platform-logo text-foreground"
      />
      <div className="source-control-hosting-platform-copy flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="source-control-hosting-platform-identity flex flex-wrap items-center gap-2">
          <h3
            id={`hosting-${provider}-label`}
            className="source-control-hosting-platform-name text-xs leading-5 font-medium text-foreground"
          >
            {summary.name}
          </h3>
          <span className="source-control-hosting-cli font-mono text-2xs text-muted-foreground">
            {summary.cli}
          </span>
          <Badge
            render={<output className="source-control-hosting-platform-status" />}
            variant={summary.badge.variant}
          >
            {summary.badge.label}
          </Badge>
        </div>
        <HostingPlatformSubtitle provider={provider} connection={connection} summary={summary} />
      </div>
    </>
  )

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(next) => {
        if (hasMultipleAccounts) onExpandedChange(next)
      }}
      className="source-control-hosting-platform"
      aria-busy={detecting || detectingVisible}
    >
      <div
        className="source-control-hosting-platform-row flex min-h-7 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
        aria-labelledby={`hosting-${provider}-label`}
      >
        {hasMultipleAccounts ? (
          <CollapsibleTrigger
            className="source-control-hosting-platform-trigger flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
            aria-label={`${isExpanded ? '收起' : '展开'} ${summary.name} 端点列表`}
          >
            <div className="source-control-hosting-platform-info flex min-w-0 flex-1 items-center gap-2.5">
              {identityContent}
            </div>
            <ChevronDown
              className={cn(
                'source-control-hosting-platform-expand-icon size-3.5 shrink-0 text-muted-foreground transition-transform',
                isExpanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        ) : (
          <div className="source-control-hosting-platform-info flex min-w-0 flex-1 items-center gap-2.5">
            {identityContent}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="source-control-hosting-platform-detect shrink-0 text-muted-foreground hover:text-foreground"
          disabled={detecting || detectingVisible}
          aria-busy={detecting || detectingVisible}
          aria-label={`检测 ${summary.name}`}
          onClick={() => onDetect(provider)}
        >
          <RefreshCw
            className={cn(
              'source-control-hosting-platform-detect-icon',
              detectingVisible && 'motion-safe:animate-spin',
            )}
            data-icon="inline-start"
            aria-hidden="true"
          />
          {detectingVisible ? '检测中' : '检测'}
        </Button>
      </div>

      {hasMultipleAccounts && (
        <CollapsibleContent className="source-control-hosting-endpoints-panel border-t border-border bg-muted/20">
          {summary.cliUnavailable && (
            <p className="source-control-hosting-endpoints-cache-note border-b border-border px-4 py-1.5 text-2xs text-warning">
              以下为上次检测缓存（当前 {summary.cli} 不可用）
            </p>
          )}
          <ul
            className="source-control-hosting-endpoints divide-y divide-border"
            aria-label={`${summary.name} 已发现端点`}
          >
            {summary.allAccounts.map((account) => {
              const accountKey = JSON.stringify([provider, account.host, account.account])
              const status = endpointStatusLabel(provider, account, summary.cliUnavailable)

              return (
                <li
                  key={accountKey}
                  className={cn(
                    'source-control-hosting-endpoint grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-4 py-2 text-xs',
                    summary.cliUnavailable && 'opacity-65',
                  )}
                >
                  <div className="source-control-hosting-endpoint-host-wrap flex min-w-0 items-center gap-2">
                    <DotStatus
                      state={
                        summary.cliUnavailable
                          ? 'idle'
                          : account.status === 'connected'
                            ? 'completed'
                            : 'error'
                      }
                    />
                    <span className="source-control-hosting-endpoint-host truncate font-mono font-medium text-foreground select-text [unicode-bidi:plaintext]">
                      {account.host}
                    </span>
                  </div>
                  <span className="source-control-hosting-endpoint-account max-w-44 truncate text-muted-foreground select-text">
                    @{account.account || '账号不可用'}
                  </span>
                  <span
                    className={cn(
                      'source-control-hosting-endpoint-status min-w-14 text-right text-2xs',
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                </li>
              )
            })}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

export function HostingPlatformSection() {
  const [connections, setConnections] = useState<Record<HostingProvider, ConnectionStatus>>({
    github: { status: 'unchecked' },
    gitlab: { status: 'unchecked' },
  })
  const [expanded, setExpanded] = useState<Record<HostingProvider, boolean>>({
    github: true,
    gitlab: true,
  })
  const [initialPending, setInitialPending] = useState(true)
  const [cacheError, setCacheError] = useState<string>()
  const [detectingProviders, setDetectingProviders] = useState<HostingProvider[]>([])

  const pendingProviders = useRef(new Set<HostingProvider>())
  const alive = useRef(true)

  const detectingAny = detectingProviders.length > 0
  const detectingAllVisible = useLoadingIndicator(
    detectingProviders.length === hostingProviderSchema.options.length,
  )

  const loadOnMount = useEffectEvent((cache: HostingAccountsCacheSnapshot) => {
    setCacheError(cache.error)
    setConnections({
      github: cachedConnection(cache.entries.github),
      gitlab: cachedConnection(cache.entries.gitlab),
    })
    const missing = hostingProviderSchema.options.filter((provider) => !cache.entries[provider])
    if (missing.length < hostingProviderSchema.options.length) setInitialPending(false)
    if (missing.length) void detect(missing, false)
    else setInitialPending(false)
  })

  useEffect(() => {
    let disposed = false
    alive.current = true
    void window.desktop.codeHosting
      .readAccounts()
      .then(unwrap)
      .then((cache) => {
        if (!disposed) loadOnMount(cache)
      })
      .catch(() => {
        if (!disposed) {
          setCacheError('无法读取代码托管缓存，请重新检测。')
          setInitialPending(false)
        }
      })
    return () => {
      disposed = true
      alive.current = false
    }
  }, [])

  async function scan(provider: HostingProvider, refresh: boolean) {
    let result: HostingAccounts | undefined
    let failure: string | undefined
    try {
      result = unwrap(await window.desktop.codeHosting.accounts(provider, refresh))
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : '检测失败，请重新检测。'
    }
    try {
      const cache = unwrap(await window.desktop.codeHosting.readAccounts())
      if (alive.current) {
        const nextStatus = cachedConnection(cache.entries[provider], failure)
        setCacheError(cache.error)
        setConnections((previous) => ({
          ...previous,
          [provider]: nextStatus,
        }))
      }
    } catch {
      if (alive.current) {
        const error = failure || '无法读取检测结果，请重新检测。'
        setCacheError('无法读取代码托管缓存，请重新检测。')
        setConnections((previous) => {
          const current = previous[provider]
          return {
            ...previous,
            [provider]: result
              ? result
              : current.status === 'unchecked' || current.status === 'error'
                ? { status: 'error', message: error }
                : { ...current, failure: error },
          }
        })
      }
    }
  }

  async function detect(
    providers: readonly HostingProvider[] = hostingProviderSchema.options,
    refresh = true,
  ) {
    const targets = providers.filter((provider) => !pendingProviders.current.has(provider))
    if (!targets.length) return
    for (const provider of targets) pendingProviders.current.add(provider)
    setDetectingProviders([...pendingProviders.current])
    try {
      await Promise.allSettled(targets.map((provider) => scan(provider, refresh)))
    } finally {
      for (const provider of targets) pendingProviders.current.delete(provider)
      if (alive.current) {
        setDetectingProviders([...pendingProviders.current])
        setInitialPending(false)
      }
    }
  }

  return (
    <section
      className="source-control-hosting-section flex flex-col gap-2.5"
      aria-labelledby="source-control-hosting-title"
    >
      <div className="source-control-hosting-header flex flex-wrap items-center justify-between gap-3">
        <h2
          id="source-control-hosting-title"
          className="source-control-hosting-title settings-section-title"
        >
          托管平台
        </h2>
        <Button
          type="button"
          variant="outline"
          className="source-control-hosting-detect-all"
          disabled={detectingAny || detectingAllVisible || initialPending}
          aria-busy={detectingAny || detectingAllVisible}
          onClick={() => void detect()}
        >
          <RefreshCw
            className={cn(
              'source-control-hosting-detect-all-icon',
              detectingAllVisible && 'motion-safe:animate-spin',
            )}
            data-icon="inline-start"
            aria-hidden="true"
          />
          {detectingAllVisible ? '检测中…' : '检测全部'}
        </Button>
      </div>

      <LoadingContent pending={initialPending} label="托管平台配置读取中..." showLabel>
        {!initialPending && (
          <>
            {cacheError && (
              <Alert className="source-control-hosting-cache-error mb-1" variant="destructive">
                <AlertDescription className="source-control-hosting-cache-error-message">
                  {cacheError}
                </AlertDescription>
              </Alert>
            )}
            <Card
              size="sm"
              className="source-control-hosting-card gap-0 divide-y divide-border py-0"
              aria-busy={detectingAny}
            >
              {hostingProviderSchema.options.map((provider) => (
                <HostingPlatformRow
                  key={provider}
                  provider={provider}
                  connection={connections[provider]}
                  expanded={expanded[provider]}
                  detecting={detectingProviders.includes(provider)}
                  onExpandedChange={(next) =>
                    setExpanded((previous) => ({ ...previous, [provider]: next }))
                  }
                  onDetect={(target) => void detect([target], true)}
                />
              ))}
            </Card>
          </>
        )}
      </LoadingContent>
    </section>
  )
}
