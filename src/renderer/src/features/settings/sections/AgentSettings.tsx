import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { AGENT_PROVIDERS, unwrap } from '../../../../../shared/contracts'
import type { AgentProvider } from '../../../../../shared/contracts'
import {
  AGENT_CLI_INSTALL_METHOD_LABELS,
  AGENT_CLI_PROVIDERS,
  agentCliEntry,
} from '../../../../../shared/agent-cli'
import type { AgentCliInstallRun, AgentCliStatus } from '../../../../../shared/agent-cli'
import { useAgentClis } from '@/state/agent-cli-store'
import { abbreviateHomePath, cn } from '@/lib/utils'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'
import { useDialogState } from '@/hooks/use-dialog-state'
import { AgentCliInstallDialog } from '@/features/agents/components/AgentCliInstallDialog'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import { AgentHookSettings } from './AgentHookSettings'
import { UsageRefreshSettings } from './UsageRefreshSettings'
import { LoadingContent } from '@/components/LoadingContent'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type AgentOperationError = { detail: string; retryCheck: boolean }

function AgentCliActionButton({
  agent,
  installing,
  checking,
  retryCheck,
  disabled,
  onClick,
}: {
  agent: AgentCliStatus
  installing: boolean
  checking: boolean
  retryCheck: boolean
  disabled: boolean
  onClick: () => void
}) {
  const checkingVisible = useLoadingIndicator(checking)
  const canCompare = agent.updateAvailable !== undefined
  return (
    <Button
      className="agent-settings-install"
      variant={agent.executable && !canCompare && !retryCheck ? 'ghost' : 'outline'}
      disabled={!installing && (disabled || checkingVisible)}
      aria-busy={checking || checkingVisible}
      aria-label={
        !installing && !retryCheck && !agent.executable
          ? `打开 ${AGENT_PROVIDERS[agent.provider].name} 官方安装指南`
          : undefined
      }
      onClick={onClick}
    >
      {checkingVisible ? (
        <LoaderCircle
          className="agent-settings-check-spinner motion-safe:animate-spin"
          data-icon="inline-start"
          aria-hidden="true"
        />
      ) : !installing && retryCheck ? (
        <RefreshCw
          className="agent-settings-retry-icon"
          data-icon="inline-start"
          aria-hidden="true"
        />
      ) : !installing && !agent.executable ? (
        <ExternalLink className="agent-settings-install-guide-icon" data-icon="inline-start" />
      ) : !installing && canCompare ? (
        <Download className="agent-settings-install-icon" data-icon="inline-start" />
      ) : null}
      {installing
        ? '查看更新进度'
        : checkingVisible
          ? '检查中…'
          : retryCheck
            ? '重新检查'
            : !agent.executable
              ? '安装'
              : !canCompare
                ? '检查更新'
                : agent.updateAvailable === false
                  ? '已是最新版本'
                  : '更新'}
    </Button>
  )
}

export function AgentSettings() {
  const cache = useAgentClis((state) => state.cache)
  const cacheError = useAgentClis((state) => state.error)
  const agents = cache ? AGENT_CLI_PROVIDERS.map((id) => agentCliEntry(cache, id)) : []
  const [busy, setBusy] = useState<'updates' | 'detect'>()
  const [checkingProviders, setCheckingProviders] = useState<AgentProvider[]>([])
  const [updatingProviders, setUpdatingProviders] = useState<AgentProvider[]>([])
  const [operationErrors, setOperationErrors] = useState<
    Partial<Record<AgentProvider, AgentOperationError>>
  >({})
  const [installRuns, setInstallRuns] = useState<AgentCliInstallRun[]>([])
  const updatesVisible = useLoadingIndicator(busy === 'updates')
  const detectingVisible = useLoadingIndicator(busy === 'detect')
  const [progressProvider, setProgressProvider, progressDialog] = useDialogState<AgentProvider>()
  const [errorDetails, setErrorDetails, errorDialog] = useDialogState<{
    title: string
    detail: string
  }>()
  const pendingBatch = useRef(false)
  const pendingChecks = useRef(new Set<AgentProvider>())
  const pendingUpdates = useRef(new Set<AgentProvider>())
  useEffect(() => {
    let disposed = false
    const received = new Set<AgentProvider>()
    const unsubscribe = window.desktop.onAgentCliInstall(({ run, data }) => {
      if (data !== undefined) return
      received.add(run.provider)
      setInstallRuns((current) => [
        ...current.filter((item) => item.provider !== run.provider),
        run,
      ])
    })
    void window.desktop
      .listAgentCliInstalls()
      .then(unwrap)
      .then((runs) => {
        if (!disposed)
          setInstallRuns((current) => [
            ...current,
            ...runs.filter((run) => !received.has(run.provider)),
          ])
      })
      .catch(() => {})
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])
  function setOperationError(provider: AgentProvider, cause?: unknown, retryCheck = false) {
    setOperationErrors((current) => ({
      ...current,
      [provider]:
        cause === undefined
          ? undefined
          : {
              detail:
                cause instanceof Error
                  ? cause.message
                  : typeof cause === 'string'
                    ? cause
                    : '操作失败。',
              retryCheck,
            },
    }))
  }
  async function checkUpdate(provider: AgentProvider, updates = true) {
    if (
      pendingChecks.current.has(provider) ||
      pendingUpdates.current.has(provider) ||
      installRuns.some((run) => run.provider === provider && run.status === 'running')
    )
      return
    pendingChecks.current.add(provider)
    setCheckingProviders([...pendingChecks.current])
    const previousError = operationErrors[provider]
    try {
      unwrap(await window.desktop.inspectAgentClis(updates, provider))
      setOperationErrors((current) =>
        current[provider] === previousError && (updates || !previousError?.retryCheck)
          ? { ...current, [provider]: undefined }
          : current,
      )
    } catch (cause) {
      setOperationError(provider, cause, true)
    } finally {
      pendingChecks.current.delete(provider)
      setCheckingProviders([...pendingChecks.current])
    }
  }
  async function inspect(updates: boolean) {
    if (pendingBatch.current) return
    pendingBatch.current = true
    setBusy(updates ? 'updates' : 'detect')
    try {
      await Promise.all(agents.map((agent) => checkUpdate(agent.provider, updates)))
      unwrap(await window.desktop.inspectAgentClis(false))
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      if (!agents.length) setErrorDetails({ title: 'Agent CLI 缓存同步失败', detail })
      else
        setOperationErrors((current) => {
          const next = { ...current }
          for (const { provider } of agents)
            next[provider] = {
              detail: [current[provider]?.detail, `缓存同步失败：${detail}`]
                .filter(Boolean)
                .join('\n\n'),
              retryCheck: current[provider]?.retryCheck ?? false,
            }
          return next
        })
    } finally {
      pendingBatch.current = false
      setBusy(undefined)
    }
  }
  async function openInstallGuide(provider: AgentProvider) {
    setOperationError(provider)
    try {
      unwrap(await window.desktop.openAgentCliInstallGuide(provider))
    } catch (cause) {
      setOperationError(provider, cause)
    }
  }
  async function update(provider: AgentProvider) {
    if (
      pendingChecks.current.has(provider) ||
      pendingUpdates.current.has(provider) ||
      installRuns.some((run) => run.provider === provider && run.status === 'running')
    )
      return
    pendingUpdates.current.add(provider)
    setUpdatingProviders([...pendingUpdates.current])
    setOperationError(provider)
    try {
      unwrap(await window.desktop.updateAgentCli(provider))
    } catch (cause) {
      setOperationError(provider, cause)
    } finally {
      pendingUpdates.current.delete(provider)
      setUpdatingProviders([...pendingUpdates.current])
    }
  }
  return (
    <section
      className="agent-settings flex min-h-0 flex-1 flex-col gap-6"
      aria-labelledby="agent-settings-title"
    >
      <header className="agent-settings-heading flex flex-col gap-1 border-b pb-4">
        <h1 id="agent-settings-title" className="agent-settings-title settings-page-title">
          智能体
        </h1>
        <p className="agent-settings-subtitle text-xs text-muted-foreground">
          检测本机已安装的 Coding Agent CLI 工具，并管理终端状态感知集成。
        </p>
      </header>
      <LoadingContent pending={!cache && !cacheError} label="智能体配置读取中..." showLabel>
        {(cache || cacheError) && (
          <FieldGroup className="agent-settings-groups gap-6">
            <section
              className="agent-settings-group flex flex-col gap-2.5"
              aria-labelledby="agent-cli-settings-title"
            >
              <div className="agent-settings-group-header flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="agent-cli-settings-title"
                  className="agent-settings-group-title settings-section-title"
                >
                  Agent CLI
                </h2>
                <div className="agent-settings-tools-control flex min-w-0 flex-col gap-1.5">
                  <div className="agent-settings-tools flex flex-wrap gap-1.5">
                    <Button
                      className="agent-settings-check-updates"
                      variant="ghost"
                      disabled={!!busy || updatesVisible || detectingVisible}
                      aria-busy={busy === 'updates' || updatesVisible}
                      onClick={() => void inspect(true)}
                    >
                      {updatesVisible ? '检查中…' : '检查更新'}
                    </Button>
                    <Button
                      className="agent-settings-detect"
                      variant="outline"
                      disabled={!!busy || updatesVisible || detectingVisible}
                      aria-busy={busy === 'detect' || detectingVisible}
                      onClick={() => void inspect(false)}
                    >
                      <RefreshCw
                        className={cn(
                          'agent-settings-detect-icon',
                          detectingVisible && 'motion-safe:animate-spin',
                        )}
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      {detectingVisible ? '检测中…' : '重新检测'}
                    </Button>
                  </div>
                </div>
              </div>
              <Card size="sm" className="agent-settings-card gap-0 divide-y divide-border py-0">
                {agents.map((agent) => {
                  const { provider, installMethod } = agent
                  const installSource =
                    installMethod && installMethod !== 'unknown'
                      ? AGENT_CLI_INSTALL_METHOD_LABELS[installMethod]
                      : undefined
                  const canCompare = agent.updateAvailable !== undefined
                  const operationError = operationErrors[provider]
                  const retryCheck = !!agent.updateError || !!operationError?.retryCheck
                  const upToDate = agent.updateAvailable === false && !retryCheck
                  const run = installRuns.find((item) => item.provider === provider)
                  const installing =
                    updatingProviders.includes(provider) || run?.status === 'running'
                  const error = [agent.error, agent.updateError, operationError?.detail]
                    .filter(Boolean)
                    .join('\n\n')
                  return (
                    <Field
                      key={provider}
                      className="agent-settings-item min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30"
                      aria-labelledby={`agent-cli-${provider}-label`}
                      aria-busy={installing || checkingProviders.includes(provider)}
                    >
                      <div className="agent-settings-item-description flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                        <div className="agent-settings-item-identity flex flex-wrap items-center gap-2">
                          <AgentIcon
                            provider={provider}
                            size={16}
                            className="agent-settings-item-icon"
                          />
                          <h3
                            id={`agent-cli-${provider}-label`}
                            className="agent-settings-item-name text-xs leading-5 font-medium text-foreground"
                          >
                            {AGENT_PROVIDERS[provider].name}
                          </h3>
                          {!agent.executable && (
                            <Badge className="agent-settings-missing-status" variant="secondary">
                              未安装
                            </Badge>
                          )}
                          {agent.version && (
                            <Badge
                              className="agent-settings-item-status tabular-nums"
                              variant="secondary"
                            >
                              {agent.version}
                            </Badge>
                          )}
                          {installSource ? (
                            <Badge className="agent-settings-install-source" variant="outline">
                              {installSource}
                            </Badge>
                          ) : null}
                          {agent.updateAvailable && agent.latestVersion && !retryCheck && (
                            <Badge
                              className="agent-settings-update-status tabular-nums"
                              variant="warning"
                            >
                              {agent.latestVersion} · 可更新
                            </Badge>
                          )}
                        </div>
                        {agent.executable && (
                          <p className="agent-settings-cli-path break-all font-mono text-xs text-muted-foreground select-text">
                            {abbreviateHomePath(agent.executable)}
                          </p>
                        )}
                      </div>
                      <div className="agent-settings-item-control flex min-w-0 flex-col gap-1.5">
                        <div className="agent-settings-item-actions flex min-h-7 flex-wrap items-center gap-2">
                          {run && run.status !== 'running' && !installing && (
                            <Button
                              className="agent-settings-view-install-log"
                              variant="ghost"
                              onClick={() => setProgressProvider(provider)}
                            >
                              查看日志
                            </Button>
                          )}
                          {error && (
                            <Button
                              className="agent-settings-operation-error"
                              variant="destructive"
                              size="icon"
                              aria-label={`查看 ${AGENT_PROVIDERS[provider].name} 操作错误详情`}
                              title={`查看 ${AGENT_PROVIDERS[provider].name} 操作错误详情`}
                              aria-haspopup="dialog"
                              onClick={() =>
                                setErrorDetails({
                                  title: `${AGENT_PROVIDERS[provider].name} 操作失败`,
                                  detail: error,
                                })
                              }
                            >
                              <TriangleAlert
                                className="agent-settings-operation-error-icon"
                                aria-hidden="true"
                              />
                            </Button>
                          )}
                          <AgentCliActionButton
                            agent={agent}
                            installing={installing}
                            checking={checkingProviders.includes(provider)}
                            retryCheck={retryCheck}
                            disabled={checkingProviders.includes(provider) || upToDate}
                            onClick={() =>
                              installing
                                ? setProgressProvider(provider)
                                : void (retryCheck
                                    ? checkUpdate(provider)
                                    : !agent.executable
                                      ? openInstallGuide(provider)
                                      : canCompare
                                        ? update(provider)
                                        : checkUpdate(provider))
                            }
                          />
                        </div>
                      </div>
                    </Field>
                  )
                })}
              </Card>
            </section>
            <AgentHookSettings
              agents={agents}
              onShowError={(title, detail) => setErrorDetails({ title, detail })}
            />
          </FieldGroup>
        )}
      </LoadingContent>
      <UsageRefreshSettings />
      <AlertDialog
        {...errorDialog}
        onOpenChange={(open) => {
          if (!open) setErrorDetails(undefined)
        }}
      >
        <AlertDialogContent className="agent-settings-error-dialog">
          <AlertDialogHeader className="agent-settings-error-header min-w-0">
            <AlertDialogTitle className="agent-settings-error-title">
              {errorDetails?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="agent-settings-error-detail max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words select-text">
              {errorDetails?.detail}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="agent-settings-error-footer">
            <AlertDialogCancel className="agent-settings-error-dismiss">知道了</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {progressProvider && (
        <AgentCliInstallDialog
          key={progressProvider}
          provider={progressProvider}
          {...progressDialog}
          onClose={() => setProgressProvider(undefined)}
        />
      )}
    </section>
  )
}
