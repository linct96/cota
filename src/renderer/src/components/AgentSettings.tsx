import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { AGENT_PROVIDERS, unwrap, type AgentProvider } from '../../../shared/contracts'
import { AGENT_CLI_PACKAGES, type AgentCliStatus } from '../../../shared/agent-cli'
import { AgentIcon } from './AgentIcon'
import { AgentHookSettings } from './AgentHookSettings'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { FieldDescription, FieldError } from './ui/field'

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([])
  const [busy, setBusy] = useState<string | undefined>('detect')
  const [error, setError] = useState<string>()
  const [output, setOutput] = useState<string>()
  const pending = useRef(false)
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
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  async function inspect(updates: boolean) {
    if (pending.current) return
    pending.current = true
    setBusy(updates ? 'updates' : 'detect')
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
  async function install(provider: AgentProvider) {
    if (pending.current) return
    pending.current = true
    setBusy(provider)
    setError(undefined)
    setOutput(undefined)
    try {
      const result = unwrap(await window.desktop.installAgentCli(provider))
      setAgents((previous) =>
        previous.map((entry) => (entry.provider === provider ? result.status : entry)),
      )
      setOutput(result.output || '安装完成。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(undefined)
    }
  }
  return (
    <section className="agent-settings flex flex-col gap-6" aria-labelledby="agent-settings-title">
      <div className="agent-settings-heading flex flex-col gap-2">
        <h3 id="agent-settings-title" className="agent-settings-title text-base font-semibold">
          智能体
        </h3>
        <FieldDescription className="agent-settings-description">
          检测本机 Agent CLI，查看安装位置和版本。快捷安装与更新使用官方 npm 包，需要 Node.js 22.19
          或更新版本及 npm。
        </FieldDescription>
        <div className="agent-settings-tools flex flex-wrap gap-2">
          <Button
            className="agent-settings-detect"
            variant="outline"
            disabled={!!busy}
            onClick={() => void inspect(false)}
          >
            <RefreshCw className="agent-settings-detect-icon" data-icon="inline-start" />
            {busy === 'detect' ? '检测中…' : '重新检测'}
          </Button>
          <Button
            className="agent-settings-check-updates"
            variant="outline"
            disabled={!!busy}
            onClick={() => void inspect(true)}
          >
            {busy === 'updates' ? '检查中…' : '检查更新'}
          </Button>
        </div>
      </div>
      <div className="agent-settings-list flex flex-col divide-y rounded-lg border">
        {(Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) => {
          const agent = agents.find((entry) => entry.provider === provider)
          const installed = !!agent?.executable
          return (
            <article
              key={provider}
              className="agent-settings-item flex min-w-0 flex-col gap-3 p-4"
              aria-label={AGENT_PROVIDERS[provider].name}
            >
              <div className="agent-settings-item-heading flex flex-wrap items-center justify-between gap-3">
                <div className="agent-settings-item-identity flex items-center gap-2">
                  <AgentIcon provider={provider} size={18} className="agent-settings-item-icon" />
                  <h4 className="agent-settings-item-name text-sm font-semibold">
                    {AGENT_PROVIDERS[provider].name}
                  </h4>
                  <Badge className="agent-settings-item-status" variant="secondary">
                    {busy === 'detect'
                      ? '检测中'
                      : installed
                        ? agent.version || '已安装 · 版本未知'
                        : '未安装'}
                  </Badge>
                </div>
                <Button
                  className="agent-settings-install"
                  variant={installed ? 'outline' : 'default'}
                  disabled={!!busy || agent?.installing}
                  onClick={() => void install(provider)}
                >
                  <Download className="agent-settings-install-icon" data-icon="inline-start" />
                  {busy === provider || agent?.installing
                    ? '安装中…'
                    : installed
                      ? '更新到最新版'
                      : '快捷安装'}
                </Button>
              </div>
              <FieldDescription className="agent-settings-cli-path break-all select-text">
                {agent?.executable || agent?.error || '等待检测…'}
              </FieldDescription>
              <code className="agent-settings-install-command break-all text-xs text-muted-foreground select-text">
                npm install -g {provider === 'pi' ? '--ignore-scripts ' : ''}
                {AGENT_CLI_PACKAGES[provider]}@latest
              </code>
              {agent?.latestVersion && (
                <output className="agent-settings-latest-version text-xs">
                  最新版本 {agent.latestVersion}
                  {agent.updateAvailable
                    ? ' · 可更新'
                    : installed && agent.version
                      ? ' · 当前已是最新或更新版本'
                      : ''}
                </output>
              )}
              <FieldError className="agent-settings-update-error">{agent?.updateError}</FieldError>
            </article>
          )
        })}
      </div>
      <FieldError className="agent-settings-error">{error}</FieldError>
      {output && (
        <details className="agent-settings-install-output rounded-lg border p-3">
          <summary className="agent-settings-output-summary cursor-pointer text-sm">
            安装结果
          </summary>
          <pre className="agent-settings-output-text mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs select-text">
            {output}
          </pre>
        </details>
      )}
      <AgentHookSettings />
    </section>
  )
}
