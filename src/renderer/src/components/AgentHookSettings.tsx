import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  AGENT_PROVIDERS,
  unwrap,
  type AgentHookStatus,
  type AgentProvider,
} from '../../../shared/contracts'
import { AgentIcon } from './AgentIcon'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Field, FieldDescription, FieldError } from './ui/field'

const labels: Record<AgentHookStatus['state'], string> = {
  installed: '已安装',
  missing: '未安装',
  outdated: '需要更新',
  conflict: '文件冲突',
  error: '检测失败',
}

export function AgentHookSettings({
  initialStatuses,
  initialError,
}: {
  initialStatuses: AgentHookStatus[]
  initialError?: string
}) {
  const [statuses, setStatuses] = useState(initialStatuses)
  const [busy, setBusy] = useState<'detect' | AgentProvider | undefined>()
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState<string>()
  const [feedbackProvider, setFeedbackProvider] = useState<AgentProvider>()

  async function detect() {
    if (busy) return
    setBusy('detect')
    setFeedbackProvider(undefined)
    setError(undefined)
    setNotice(undefined)
    try {
      setStatuses(unwrap(await window.desktop.detectAgentHooks()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  async function manage(provider: AgentProvider, action: 'install' | 'uninstall') {
    if (busy) return
    setBusy(provider)
    setFeedbackProvider(provider)
    setError(undefined)
    setNotice(undefined)
    try {
      const status = unwrap(
        await (action === 'uninstall'
          ? window.desktop.uninstallAgentHook(provider)
          : window.desktop.installAgentHook(provider)),
      )
      if (status)
        setStatuses((current) => [...current.filter((item) => item.provider !== provider), status])
      setNotice(
        status
          ? action === 'uninstall' && status.state === 'missing'
            ? `${AGENT_PROVIDERS[provider].name}：已卸载。已运行的 CLI 请重启后生效。`
            : `${AGENT_PROVIDERS[provider].name}：${status.detail}`
          : undefined,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section
      className="agent-hook-settings flex flex-col gap-2.5"
      aria-labelledby="agent-hook-settings-title"
      aria-describedby="agent-hook-settings-description"
      aria-busy={!!busy}
    >
      <div className="agent-hook-settings-header flex flex-wrap items-start justify-between gap-3">
        <div className="agent-hook-settings-heading flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <h2
            id="agent-hook-settings-title"
            className="agent-hook-settings-title settings-section-title"
          >
            Agent 状态集成
          </h2>
          <FieldDescription
            id="agent-hook-settings-description"
            className="agent-hook-settings-description"
          >
            安装 Hooks 或 Extension 后，可在终端标签上查看 Agent
            的运行、等待输入、完成或失败状态。安装后请新建终端生效。
          </FieldDescription>
        </div>
        <div className="agent-hook-detect-control flex min-w-0 flex-col gap-1.5">
          <Button
            className="agent-hook-detect"
            variant="outline"
            disabled={!!busy}
            onClick={() => void detect()}
          >
            <RefreshCw className="agent-hook-detect-icon" data-icon="inline-start" />
            重新检测
          </Button>
          <FieldError className="agent-hook-detect-error max-w-60">
            {feedbackProvider === undefined ? error : undefined}
          </FieldError>
        </div>
      </div>
      <Card size="sm" className="agent-hook-settings-card gap-0 divide-y divide-border py-0">
        {(Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) => {
          const status = statuses.find((item) => item.provider === provider)
          const installLabel =
            provider === 'codex'
              ? status?.state === 'outdated'
                ? '更新并信任'
                : '安装并信任'
              : status?.state === 'outdated'
                ? '更新'
                : '安装'
          const invalidStatus = status?.state === 'error' || status?.state === 'conflict'
          const badgeVariant =
            status?.state === 'installed'
              ? 'success'
              : invalidStatus
                ? 'destructive'
                : status?.state === 'outdated'
                  ? 'warning'
                  : 'secondary'
          return (
            <Field
              key={provider}
              className="agent-hook-row min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30"
              aria-labelledby={`agent-hook-${provider}-label`}
            >
              <div className="agent-hook-description flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <div className="agent-hook-heading flex flex-wrap items-center gap-2">
                  <AgentIcon provider={provider} size={16} className="agent-hook-icon" />
                  <h3
                    id={`agent-hook-${provider}-label`}
                    className="agent-hook-name text-xs leading-5 font-medium text-foreground"
                  >
                    {AGENT_PROVIDERS[provider].name}
                  </h3>
                  <Badge className="agent-hook-status" variant={badgeVariant}>
                    {status ? labels[status.state] : '未检测'}
                  </Badge>
                </div>
                {status?.state === 'outdated' && (
                  <p className="agent-hook-status-detail text-xs text-muted-foreground">
                    {status.detail}
                  </p>
                )}
                {status?.state !== 'missing' &&
                  status?.paths.map((path) => (
                    <p
                      key={path}
                      className="agent-hook-path break-all font-mono text-xs text-muted-foreground select-text"
                    >
                      {path}
                    </p>
                  ))}
              </div>
              <div className="agent-hook-control flex min-w-0 flex-col gap-1.5" aria-live="polite">
                <div className="agent-hook-actions flex min-h-7 flex-wrap items-center gap-1.5">
                  {status?.state !== 'installed' && (
                    <Button
                      className="agent-hook-install"
                      variant="outline"
                      aria-label={`${installLabel} ${AGENT_PROVIDERS[provider].name} ${provider === 'pi' ? 'Extension' : 'Hooks'}`}
                      disabled={
                        !!busy || (!!status && !['missing', 'outdated'].includes(status.state))
                      }
                      onClick={() => void manage(provider, 'install')}
                    >
                      {installLabel}
                    </Button>
                  )}
                  {(status?.state === 'installed' || status?.state === 'outdated') && (
                    <Button
                      className="agent-hook-uninstall text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      variant="ghost"
                      aria-label={`卸载 ${AGENT_PROVIDERS[provider].name} ${provider === 'pi' ? 'Extension' : 'Hooks'}`}
                      disabled={!!busy}
                      onClick={() => void manage(provider, 'uninstall')}
                    >
                      卸载
                    </Button>
                  )}
                </div>
                {invalidStatus && status?.detail && (
                  <p
                    className="agent-hook-status-error max-w-60 text-right text-xs text-destructive"
                    role="alert"
                  >
                    {status?.detail}
                  </p>
                )}
                {feedbackProvider === provider && (notice || error) && (
                  <div className="agent-hook-feedback max-w-60 text-right">
                    {notice && (
                      <p className="agent-hook-notice text-xs text-muted-foreground">{notice}</p>
                    )}
                    {error && (
                      <p className="agent-hook-error text-xs text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Field>
          )
        })}
      </Card>
    </section>
  )
}
