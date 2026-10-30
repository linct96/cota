import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import {
  AGENT_PROVIDERS,
  unwrap,
  type AgentHookStatus,
  type AgentProvider,
} from '../../../../../shared/contracts'
import {
  AGENT_CLI_INSTALL_METHOD_LABELS,
  type AgentCliInstallRun,
} from '../../../../../shared/agent-cli'
import { useAgentClis } from '@/state/agent-cli-store'
import { abbreviateHomePath } from '@/lib/utils'
import { useDialogState } from '@/hooks/use-dialog-state'
import { AgentCliInstallDialog } from '@/features/agents/components/AgentCliInstallDialog'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import { AgentHookSettings } from './AgentHookSettings'
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

function joinErrors(...messages: (string | undefined)[]) {
  return [...new Set(messages.filter(Boolean))].join('\n\n')
}

export function AgentSettings() {
  const cache = useAgentClis((state) => state.cache)
  const cacheError = useAgentClis((state) => state.error)
  const agents = cache?.entries ?? []
  const [busy, setBusy] = useState<string>()
  const [checkingProviders, setCheckingProviders] = useState<AgentProvider[]>([])
  const [initialPending, setInitialPending] = useState(true)
  const [hookStatuses, setHookStatuses] = useState<AgentHookStatus[]>([])
  const [hookError, setHookError] = useState<string>()
  const [installRuns, setInstallRuns] = useState<AgentCliInstallRun[]>([])
  const activeInstall = installRuns.find((run) => run.status === 'running')
  const isBusy = !!busy || !!activeInstall
  const [progressProvider, setProgressProvider, progressDialog] = useDialogState<AgentProvider>()
  const [error, setError] = useState<string>()
  const [operationErrors, setOperationErrors] = useState<Partial<Record<AgentProvider, string>>>({})
  const [errorDetails, setErrorDetails, errorDialog] = useDialogState<{
    title: string
    detail: string
  }>()
  const globalErrors = joinErrors(error, cacheError)
  const pending = useRef(false)
  const pendingChecks = useRef(new Set<AgentProvider>())
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
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    pending.current = true
    void window.desktop
      .detectAgentHooks()
      .then(unwrap)
      .then((value) => {
        if (!cancelled) setHookStatuses(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setHookError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) {
          pending.current = false
          setBusy(undefined)
          setInitialPending(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  async function inspect(updates: boolean) {
    if (pending.current || pendingChecks.current.size > 0 || initialPending || activeInstall) return
    pending.current = true
    setBusy(updates ? 'updates' : 'detect')
    setOperationErrors({})
    setError(undefined)
    try {
      unwrap(await window.desktop.inspectAgentClis(updates))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(undefined)
    }
  }
  async function checkUpdate(provider: AgentProvider) {
    if (pending.current || pendingChecks.current.has(provider) || initialPending || activeInstall)
      return
    pendingChecks.current.add(provider)
    setCheckingProviders([...pendingChecks.current])
    setOperationErrors((current) => ({ ...current, [provider]: undefined }))
    try {
      unwrap(await window.desktop.inspectAgentClis(true, provider))
    } catch (cause) {
      setOperationErrors((current) => ({
        ...current,
        [provider]: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      pendingChecks.current.delete(provider)
      setCheckingProviders([...pendingChecks.current])
    }
  }
  async function install(provider: AgentProvider) {
    if (pending.current || pendingChecks.current.size > 0 || initialPending || activeInstall) return
    pending.current = true
    setBusy(provider)
    setOperationErrors((current) => ({ ...current, [provider]: undefined }))
    try {
      unwrap(await window.desktop.installAgentCli(provider))
    } catch (cause) {
      setOperationErrors((current) => ({
        ...current,
        [provider]: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      pending.current = false
      setBusy(undefined)
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
      <LoadingContent
        pending={initialPending || (!cache && !cacheError)}
        label="智能体配置读取中..."
        showLabel
      >
        {!initialPending && (
          <FieldGroup className="agent-settings-groups gap-6">
            <section
              className="agent-settings-group flex flex-col gap-2.5"
              aria-labelledby="agent-cli-settings-title"
              aria-busy={isBusy || checkingProviders.length > 0}
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
                      disabled={isBusy || checkingProviders.length > 0}
                      onClick={() => void inspect(true)}
                    >
                      {busy === 'updates' ? '检查中…' : '检查更新'}
                    </Button>
                    <Button
                      className="agent-settings-detect"
                      variant="outline"
                      disabled={isBusy || checkingProviders.length > 0}
                      onClick={() => void inspect(false)}
                    >
                      <RefreshCw className="agent-settings-detect-icon" data-icon="inline-start" />
                      {busy === 'detect' ? '检测中…' : '重新检测'}
                    </Button>
                    {globalErrors && (
                      <Button
                        className="agent-settings-global-error"
                        variant="destructive"
                        aria-label="查看 Agent CLI 错误详情"
                        aria-haspopup="dialog"
                        onClick={() =>
                          setErrorDetails({ title: 'Agent CLI 错误详情', detail: globalErrors })
                        }
                      >
                        错误
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <Card
                size="sm"
                className="agent-settings-card gap-0 divide-y divide-border py-0"
                aria-busy={isBusy || checkingProviders.length > 0}
              >
                {agents.map((agent) => {
                  const { provider } = agent
                  const canCompare = agent.updateAvailable !== undefined
                  const upToDate = agent.updateAvailable === false
                  const manualUpdate = agent.installMethod === 'unknown'
                  const run = installRuns.find((item) => item.provider === provider)
                  const installing = busy === provider || run?.status === 'running'
                  const rowErrors = joinErrors(
                    agent.error,
                    agent.updateError,
                    operationErrors[provider],
                    run?.error,
                  )
                  return (
                    <Field
                      key={provider}
                      className="agent-settings-item min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30"
                      aria-labelledby={`agent-cli-${provider}-label`}
                      aria-busy={isBusy || checkingProviders.includes(provider)}
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
                          {agent?.version && (
                            <Badge
                              className="agent-settings-item-status tabular-nums"
                              variant="secondary"
                            >
                              {agent.version}
                            </Badge>
                          )}
                          {agent.installMethod && agent.installMethod !== 'native' && (
                            <Badge className="agent-settings-install-source" variant="outline">
                              {AGENT_CLI_INSTALL_METHOD_LABELS[agent.installMethod]}
                            </Badge>
                          )}
                          {agent?.updateAvailable && agent.latestVersion && (
                            <Badge
                              className="agent-settings-update-status tabular-nums"
                              variant="warning"
                            >
                              {agent.latestVersion} · 可更新
                            </Badge>
                          )}
                        </div>
                        <p className="agent-settings-cli-path break-all font-mono text-xs text-muted-foreground select-text">
                          {agent.executable
                            ? abbreviateHomePath(agent.executable)
                            : '通过 npm 全局安装（需先安装 Node.js）'}
                        </p>
                      </div>
                      <div className="agent-settings-item-control flex min-w-0 flex-col gap-1.5">
                        <div className="agent-settings-item-actions flex min-h-7 flex-wrap items-center gap-2">
                          <Button
                            className="agent-settings-install"
                            variant={agent.executable && !canCompare ? 'ghost' : 'outline'}
                            disabled={
                              !installing &&
                              (isBusy ||
                                checkingProviders.includes(provider) ||
                                (canCompare && checkingProviders.length > 0) ||
                                upToDate ||
                                (canCompare && manualUpdate))
                            }
                            onClick={() =>
                              installing
                                ? setProgressProvider(provider)
                                : void (!agent.executable || canCompare
                                    ? install(provider)
                                    : checkUpdate(provider))
                            }
                          >
                            {!installing && (!agent.executable || canCompare) && (
                              <Download
                                className="agent-settings-install-icon"
                                data-icon="inline-start"
                              />
                            )}
                            {installing
                              ? agent.executable
                                ? '查看更新进度'
                                : '查看安装进度'
                              : !agent.executable
                                ? '安装'
                                : !canCompare
                                  ? busy === 'updates' || checkingProviders.includes(provider)
                                    ? '检查中…'
                                    : '检查更新'
                                  : upToDate
                                    ? '已是最新版本'
                                    : manualUpdate
                                      ? '请手动更新'
                                      : '更新'}
                          </Button>
                          {run && run.status !== 'running' && !installing && (
                            <Button
                              className="agent-settings-view-install-log"
                              variant="ghost"
                              onClick={() => setProgressProvider(provider)}
                            >
                              查看日志
                            </Button>
                          )}
                          {rowErrors && (
                            <Button
                              className="agent-settings-row-error"
                              variant="destructive"
                              aria-label={`查看 ${AGENT_PROVIDERS[provider].name} 错误详情`}
                              aria-haspopup="dialog"
                              onClick={() =>
                                setErrorDetails({
                                  title: `${AGENT_PROVIDERS[provider].name} 错误详情`,
                                  detail: rowErrors,
                                })
                              }
                            >
                              错误
                            </Button>
                          )}
                        </div>
                      </div>
                    </Field>
                  )
                })}
              </Card>
            </section>
            <AgentHookSettings initialStatuses={hookStatuses} initialError={hookError} />
          </FieldGroup>
        )}
      </LoadingContent>
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
