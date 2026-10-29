import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import {
  AGENT_PROVIDERS,
  unwrap,
  type AgentHookStatus,
  type AgentProvider,
} from '../../../shared/contracts'
import { AGENT_CLI_INSTALL_METHOD_LABELS, type AgentCliStatus } from '../../../shared/agent-cli'
import { AgentIcon } from './AgentIcon'
import { AgentHookSettings } from './AgentHookSettings'
import { LoadingContent } from './LoadingContent'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Empty, EmptyDescription } from './ui/empty'
import { Field, FieldError, FieldGroup } from './ui/field'

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([])
  const [busy, setBusy] = useState<string | undefined>('detect')
  const [checkingProviders, setCheckingProviders] = useState<AgentProvider[]>([])
  const [initialPending, setInitialPending] = useState(true)
  const [hookStatuses, setHookStatuses] = useState<AgentHookStatus[]>([])
  const [hookError, setHookError] = useState<string>()
  const isBusy = !!busy
  const [error, setError] = useState<string>()
  const [output, setOutput] = useState<string>()
  const [feedbackProvider, setFeedbackProvider] = useState<AgentProvider>()
  const pending = useRef(false)
  const pendingChecks = useRef(new Set<AgentProvider>())
  const installedAgents = agents.filter((agent) => !!agent.executable)
  useEffect(() => {
    let cancelled = false
    pending.current = true
    void Promise.all([
      window.desktop
        .inspectAgentClis()
        .then(unwrap)
        .then((value) => {
          if (!cancelled) setAgents(value)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
        }),
      window.desktop
        .detectAgentHooks()
        .then(unwrap)
        .then((value) => {
          if (!cancelled) setHookStatuses(value)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setHookError(cause instanceof Error ? cause.message : String(cause))
        }),
    ]).finally(() => {
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
    if (pending.current || pendingChecks.current.size > 0 || initialPending) return
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
    if (pending.current || pendingChecks.current.has(provider) || initialPending) return
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
    if (pending.current || pendingChecks.current.size > 0 || initialPending) return
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
      <LoadingContent pending={initialPending} label="智能体配置读取中..." showLabel>
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
                  </div>
                  <FieldError className="agent-settings-error max-w-60 self-end text-right">
                    {feedbackProvider === undefined ? error : undefined}
                  </FieldError>
                </div>
              </div>
              <Card
                size="sm"
                className="agent-settings-card gap-0 divide-y divide-border py-0"
                aria-busy={isBusy || checkingProviders.length > 0}
              >
                {!busy && !error && installedAgents.length === 0 && (
                  <Empty className="agent-settings-empty py-8">
                    <EmptyDescription className="agent-settings-empty-description">
                      未检测到已安装的 Agent CLI
                    </EmptyDescription>
                  </Empty>
                )}
                {installedAgents.map((agent) => {
                  const { provider } = agent
                  const canCompare = agent.updateAvailable !== undefined
                  const upToDate = agent.updateAvailable === false
                  const manualUpdate = agent.installMethod === 'unknown'
                  const ActionIcon = canCompare ? Download : RefreshCw
                  return (
                    <Field
                      key={provider}
                      className="agent-settings-item min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30"
                      aria-labelledby={`agent-cli-${provider}-label`}
                      aria-busy={isBusy || checkingProviders.includes(provider) || agent.installing}
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
                          {agent.executable}
                        </p>
                      </div>
                      <div className="agent-settings-item-control flex min-w-0 flex-col gap-1.5">
                        <div className="agent-settings-item-actions flex min-h-7 flex-wrap items-center gap-2">
                          <Button
                            className="agent-settings-install"
                            variant="outline"
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
                  )
                })}
                {output && (
                  <details className="agent-settings-install-output min-w-0 px-4 py-3">
                    <summary className="agent-settings-output-summary cursor-pointer text-xs font-medium text-foreground">
                      更新结果
                    </summary>
                    <pre className="agent-settings-output-text mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap select-text">
                      {output}
                    </pre>
                  </details>
                )}
              </Card>
            </section>
            <AgentHookSettings initialStatuses={hookStatuses} initialError={hookError} />
          </FieldGroup>
        )}
      </LoadingContent>
    </section>
  )
}
