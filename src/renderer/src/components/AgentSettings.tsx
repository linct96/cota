import { Fragment, useEffect, useRef, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { AGENT_PROVIDERS, unwrap, type AgentProvider } from '../../../shared/contracts'
import { AGENT_CLI_INSTALL_METHOD_LABELS, type AgentCliStatus } from '../../../shared/agent-cli'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { AgentIcon } from './AgentIcon'
import { AgentHookSettings } from './AgentHookSettings'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Empty, EmptyDescription } from './ui/empty'
import { Field, FieldError, FieldGroup } from './ui/field'
import { Separator } from './ui/separator'
import { Skeleton } from './ui/skeleton'

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([])
  const [busy, setBusy] = useState<string | undefined>('detect')
  const [checkingProviders, setCheckingProviders] = useState<AgentProvider[]>([])
  const [initialPending, setInitialPending] = useState(true)
  const skeletonVisible = useLoadingIndicator(initialPending)
  const showSkeleton = initialPending || skeletonVisible
  const isBusy = !!busy || skeletonVisible
  const [error, setError] = useState<string>()
  const [output, setOutput] = useState<string>()
  const [feedbackProvider, setFeedbackProvider] = useState<AgentProvider>()
  const pending = useRef(false)
  const pendingChecks = useRef(new Set<AgentProvider>())
  const installedAgents = showSkeleton ? [] : agents.filter((agent) => !!agent.executable)
  useEffect(() => {
    let cancelled = false
    pending.current = true
    void window.desktop
      .inspectAgentClis()
      .then(unwrap)
      .then((value) => {
        if (!cancelled) setAgents(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
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
    if (pending.current || pendingChecks.current.size > 0 || showSkeleton) return
    pending.current = true
    setBusy(updates ? 'updates' : 'detect')
    setFeedbackProvider(undefined)
    setError(undefined)
    try {
      setAgents(unwrap(await window.desktop.inspectAgentClis(updates)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(undefined)
    }
  }
  async function checkUpdate(provider: AgentProvider) {
    if (pending.current || pendingChecks.current.has(provider) || showSkeleton) return
    pendingChecks.current.add(provider)
    setCheckingProviders([...pendingChecks.current])
    setAgents((previous) =>
      previous.map((entry) =>
        entry.provider === provider ? { ...entry, updateError: undefined } : entry,
      ),
    )
    try {
      const status = unwrap(await window.desktop.inspectAgentClis(true, provider)).find(
        (entry) => entry.provider === provider,
      )
      if (status)
        setAgents((previous) =>
          previous.map((entry) => (entry.provider === provider ? status : entry)),
        )
    } catch (cause) {
      setAgents((previous) =>
        previous.map((entry) =>
          entry.provider === provider
            ? { ...entry, updateError: cause instanceof Error ? cause.message : String(cause) }
            : entry,
        ),
      )
    } finally {
      pendingChecks.current.delete(provider)
      setCheckingProviders([...pendingChecks.current])
    }
  }
  async function install(provider: AgentProvider) {
    if (pending.current || pendingChecks.current.size > 0 || showSkeleton) return
    pending.current = true
    setBusy(provider)
    setFeedbackProvider(provider)
    setError(undefined)
    setOutput(undefined)
    try {
      const result = unwrap(await window.desktop.installAgentCli(provider))
      setAgents((previous) =>
        previous.map((entry) => (entry.provider === provider ? result.status : entry)),
      )
      setOutput(result.output || '更新完成。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(undefined)
    }
  }
  return (
    <section className="agent-settings flex flex-col gap-6" aria-labelledby="agent-settings-title">
      <div className="agent-settings-heading typeset">
        <h1 id="agent-settings-title" className="agent-settings-title">
          智能体
        </h1>
      </div>
      <FieldGroup className="agent-settings-groups gap-8">
        <section
          className="agent-settings-group flex flex-col gap-3"
          aria-labelledby="agent-cli-settings-title"
          aria-busy={isBusy || checkingProviders.length > 0}
        >
          <div className="agent-settings-group-header flex flex-wrap items-start justify-between gap-3">
            <h4
              id="agent-cli-settings-title"
              className="agent-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
            >
              Agent CLI
            </h4>
            <div className="agent-settings-tools-control flex min-w-0 flex-col gap-2">
              <div className="agent-settings-tools flex flex-wrap gap-2">
                <Button
                  className="agent-settings-check-updates"
                  variant="ghost"
                  size="lg"
                  disabled={isBusy || checkingProviders.length > 0}
                  onClick={() => void inspect(true)}
                >
                  {busy === 'updates' ? '检查中…' : '检查更新'}
                </Button>
                <Button
                  className="agent-settings-detect"
                  variant="outline"
                  size="lg"
                  disabled={isBusy || checkingProviders.length > 0}
                  onClick={() => void inspect(false)}
                >
                  <RefreshCw className="agent-settings-detect-icon" data-icon="inline-start" />
                  {busy === 'detect' ? '检测中…' : '重新检测'}
                </Button>
              </div>
              <FieldError className="agent-settings-error max-w-60 self-end text-right">
                {feedbackProvider === undefined ? error : undefined}
              </FieldError>
            </div>
          </div>
          <Card className="agent-settings-card" aria-busy={isBusy || checkingProviders.length > 0}>
            {showSkeleton && (
              <div
                className="agent-settings-skeleton flex flex-col gap-4 data-[visible=false]:invisible"
                data-visible={skeletonVisible}
                aria-hidden="true"
              >
                {Object.keys(AGENT_PROVIDERS).map((provider, index) => (
                  <Fragment key={provider}>
                    {index > 0 && <Separator className="agent-settings-skeleton-separator" />}
                    <div className="agent-settings-skeleton-row flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5">
                      <div className="agent-settings-skeleton-description flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                        <div className="agent-settings-skeleton-identity flex items-center gap-2">
                          <Skeleton className="agent-settings-skeleton-icon size-4.5" />
                          <Skeleton className="agent-settings-skeleton-name h-5 w-24" />
                          <Skeleton className="agent-settings-skeleton-version h-5 w-12" />
                          <Skeleton className="agent-settings-skeleton-source h-5 w-12" />
                        </div>
                        <Skeleton className="agent-settings-skeleton-path h-4 w-3/4 max-w-80" />
                      </div>
                      <Skeleton className="agent-settings-skeleton-action h-8 w-24 shrink-0" />
                    </div>
                  </Fragment>
                ))}
              </div>
            )}
            {!showSkeleton && !busy && !error && installedAgents.length === 0 && (
              <Empty className="agent-settings-empty">
                <EmptyDescription className="agent-settings-empty-description">
                  未检测到已安装的 Agent CLI
                </EmptyDescription>
              </Empty>
            )}
            {installedAgents.map((agent, index) => {
              const { provider } = agent
              const canCompare = agent.updateAvailable !== undefined
              const upToDate = agent.updateAvailable === false
              const manualUpdate = agent.installMethod === 'unknown'
              const ActionIcon = canCompare ? Download : RefreshCw
              return (
                <Fragment key={provider}>
                  {index > 0 && <Separator className="agent-settings-separator" />}
                  <Field
                    className="agent-settings-item flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
                    aria-labelledby={`agent-cli-${provider}-label`}
                    aria-busy={isBusy || checkingProviders.includes(provider) || agent.installing}
                  >
                    <div className="agent-settings-item-description flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                      <div className="agent-settings-item-identity flex flex-wrap items-center gap-2">
                        <AgentIcon
                          provider={provider}
                          size={18}
                          className="agent-settings-item-icon"
                        />
                        <h5
                          id={`agent-cli-${provider}-label`}
                          className="agent-settings-item-name text-sm leading-5 font-medium"
                        >
                          {AGENT_PROVIDERS[provider].name}
                        </h5>
                        {agent?.version && (
                          <Badge className="agent-settings-item-status" variant="secondary">
                            {agent.version}
                          </Badge>
                        )}
                        {agent.installMethod && agent.installMethod !== 'native' && (
                          <Badge className="agent-settings-install-source" variant="outline">
                            {AGENT_CLI_INSTALL_METHOD_LABELS[agent.installMethod]}
                          </Badge>
                        )}
                        {agent?.updateAvailable && agent.latestVersion && (
                          <Badge className="agent-settings-update-status" variant="warning">
                            {agent.latestVersion} · 可更新
                          </Badge>
                        )}
                      </div>
                      <p className="agent-settings-cli-path break-all select-text text-xs text-muted-foreground">
                        {agent.executable}
                      </p>
                    </div>
                    <div className="agent-settings-item-control flex min-w-0 flex-col gap-2">
                      <div className="agent-settings-item-actions flex min-h-8 flex-wrap items-center gap-2">
                        <Button
                          className="agent-settings-install"
                          variant="outline"
                          size="lg"
                          disabled={
                            isBusy ||
                            checkingProviders.includes(provider) ||
                            (canCompare && checkingProviders.length > 0) ||
                            agent?.installing ||
                            upToDate ||
                            (canCompare && manualUpdate)
                          }
                          onClick={() =>
                            void (canCompare ? install(provider) : checkUpdate(provider))
                          }
                        >
                          <ActionIcon
                            className="agent-settings-install-icon"
                            data-icon="inline-start"
                          />
                          {busy === provider || agent?.installing
                            ? '更新中…'
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
                      </div>
                      {agent?.error && (
                        <p
                          className="agent-settings-detection-error max-w-60 self-end text-right text-xs text-destructive"
                          role="alert"
                        >
                          {agent?.error}
                        </p>
                      )}
                      {agent?.updateError && (
                        <p
                          className="agent-settings-update-error max-w-60 self-end text-right text-xs text-destructive"
                          role="alert"
                        >
                          {agent?.updateError}
                        </p>
                      )}
                      {feedbackProvider === provider && error && (
                        <p
                          className="agent-settings-install-error max-w-60 self-end text-right text-xs text-destructive"
                          role="alert"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  </Field>
                </Fragment>
              )
            })}
            {output && (
              <>
                <Separator className="agent-settings-output-separator" />
                <details className="agent-settings-install-output min-w-0 px-5">
                  <summary className="agent-settings-output-summary cursor-pointer text-sm">
                    更新结果
                  </summary>
                  <pre className="agent-settings-output-text mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs select-text">
                    {output}
                  </pre>
                </details>
              </>
            )}
          </Card>
        </section>
        <AgentHookSettings />
      </FieldGroup>
    </section>
  )
}
