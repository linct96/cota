import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AGENT_PROVIDERS, unwrap } from '../../../../../shared/contracts'
import type { AgentHookStatus, AgentProvider } from '../../../../../shared/contracts'
import type { AgentCliStatus } from '../../../../../shared/agent-cli'
import { cn } from '@/lib/utils'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'
import { AgentIcon } from '@/features/agents/components/AgentIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription } from '@/components/ui/field'

type HookAction = 'install' | 'trust' | 'uninstall'
type HookPending = HookAction | 'detect'
const providers = Object.keys(AGENT_PROVIDERS) as AgentProvider[]

const labels: Record<AgentHookStatus['state'], string> = {
  installed: '已安装',
  missing: '未安装',
  outdated: '需要更新',
  conflict: '文件冲突',
  error: '检测失败',
}

export function AgentHookSettings({
  agents,
  onShowError,
}: {
  agents: AgentCliStatus[]
  onShowError: (title: string, detail: string) => void
}) {
  const [statuses, setStatuses] = useState<AgentHookStatus[]>([])
  const [busy, setBusy] = useState<Partial<Record<AgentProvider, HookPending>>>({})
  const [errors, setErrors] = useState<Partial<Record<AgentProvider, string>>>({})
  const [detectionErrors, setDetectionErrors] = useState<Partial<Record<AgentProvider, string>>>({})
  const [detecting, setDetecting] = useState(false)
  const pending = useRef(new Set<AgentProvider>())
  const refreshRequested = useRef(new Set<AgentProvider>())
  const pendingBatch = useRef(false)
  const detectingVisible = useLoadingIndicator(detecting)
  const trustingVisible = useLoadingIndicator(busy.codex === 'trust')

  const detectProvider = useCallback(async (provider: AgentProvider) => {
    if (pending.current.has(provider)) {
      refreshRequested.current.add(provider)
      return
    }
    pending.current.add(provider)
    setBusy((current) => ({ ...current, [provider]: 'detect' }))
    try {
      do {
        refreshRequested.current.delete(provider)
        try {
          const status = unwrap(await window.desktop.detectAgentHooks(provider)).find(
            (item) => item.provider === provider,
          )
          if (!status) throw new Error('状态集成检测结果无效。')
          setStatuses((current) => [
            ...current.filter((item) => item.provider !== provider),
            status,
          ])
          setDetectionErrors((current) => ({ ...current, [provider]: undefined }))
        } catch (cause) {
          setDetectionErrors((current) => ({
            ...current,
            [provider]: cause instanceof Error ? cause.message : String(cause),
          }))
        }
      } while (refreshRequested.current.has(provider))
    } finally {
      pending.current.delete(provider)
      setBusy((current) => ({ ...current, [provider]: undefined }))
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktop.onAgentCliInstall(({ run, data }) => {
      if (data === undefined && run.status !== 'running') void detectProvider(run.provider)
    })
    void Promise.all(providers.map(detectProvider))
    return unsubscribe
  }, [detectProvider])

  async function detect() {
    if (pendingBatch.current) return
    pendingBatch.current = true
    setDetecting(true)
    try {
      await Promise.all(providers.map(detectProvider))
    } finally {
      pendingBatch.current = false
      setDetecting(false)
    }
  }

  async function manage(provider: AgentProvider, action: HookAction) {
    if (pending.current.has(provider)) return
    pending.current.add(provider)
    setBusy((current) => ({ ...current, [provider]: action }))
    setErrors((current) => ({ ...current, [provider]: undefined }))
    try {
      const status = unwrap(
        await (action === 'uninstall'
          ? window.desktop.uninstallAgentHook(provider)
          : action === 'trust'
            ? window.desktop.trustAgentHook(provider)
            : window.desktop.installAgentHook(provider)),
      )
      if (status) {
        setStatuses((current) => [...current.filter((item) => item.provider !== provider), status])
        if (action === 'install')
          toast.success(
            provider === 'codex'
              ? 'Hooks 已安装，请点击“信任”或在 Codex 中审核。'
              : '状态集成已安装，请新建终端。',
          )
        if (action === 'trust') toast.success('已信任 Hooks，将在新 Codex Agent 生效。')
      }
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [provider]: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      pending.current.delete(provider)
      setBusy((current) => ({ ...current, [provider]: undefined }))
      if (refreshRequested.current.delete(provider)) void detectProvider(provider)
    }
  }

  return (
    <section
      className="agent-hook-settings flex flex-col gap-2.5"
      aria-labelledby="agent-hook-settings-title"
      aria-describedby="agent-hook-settings-description"
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
            安装后可在终端标签查看 Agent 运行状态。
          </FieldDescription>
        </div>
        <div className="agent-hook-detect-control flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            className="agent-hook-detect"
            variant="outline"
            disabled={detecting || detectingVisible}
            aria-busy={detecting || detectingVisible}
            onClick={() => void detect()}
          >
            <RefreshCw
              className={cn(
                'agent-hook-detect-icon',
                detectingVisible && 'motion-safe:animate-spin',
              )}
              data-icon="inline-start"
              aria-hidden="true"
            />
            {detectingVisible ? '检测中…' : '重新检测'}
          </Button>
        </div>
      </div>
      <Card size="sm" className="agent-hook-settings-card gap-0 divide-y divide-border py-0">
        {providers.map((provider) => {
          const status = statuses.find((item) => item.provider === provider)
          const pendingAction = busy[provider]
          const blocked = !!pendingAction || (provider === 'codex' && trustingVisible)
          const TrustIcon = trustingVisible ? LoaderCircle : ShieldCheck
          const installLabel = status?.state === 'outdated' ? '更新' : '安装'
          const invalidStatus = status?.state === 'error' || status?.state === 'conflict'
          const rowError = [
            invalidStatus || status?.trust === 'unknown' ? status.detail : undefined,
            errors[provider],
            detectionErrors[provider],
          ]
            .filter(Boolean)
            .join('\n\n')
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
              aria-busy={!!pendingAction}
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
              </div>
              <div className="agent-hook-control flex min-w-0 flex-col gap-1.5" aria-live="polite">
                <div className="agent-hook-actions flex min-h-7 flex-wrap items-center gap-1.5">
                  {(status?.state === 'installed' || status?.state === 'outdated') && (
                    <Button
                      className="agent-hook-uninstall text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      variant="ghost"
                      aria-label={`卸载 ${AGENT_PROVIDERS[provider].name} ${provider === 'pi' ? 'Extension' : 'Hooks'}`}
                      disabled={blocked}
                      aria-busy={pendingAction === 'uninstall'}
                      onClick={() => void manage(provider, 'uninstall')}
                    >
                      卸载
                    </Button>
                  )}
                  {status?.state !== 'installed' && (
                    <Button
                      className="agent-hook-install"
                      variant="outline"
                      aria-label={`${installLabel} ${AGENT_PROVIDERS[provider].name} ${provider === 'pi' ? 'Extension' : 'Hooks'}`}
                      disabled={
                        blocked ||
                        !agents.find((agent) => agent.provider === provider)?.executable ||
                        (!!status && !['missing', 'outdated'].includes(status.state))
                      }
                      aria-busy={pendingAction === 'install'}
                      onClick={() => void manage(provider, 'install')}
                    >
                      <Download
                        className="agent-hook-install-icon"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      {installLabel}
                    </Button>
                  )}
                  {provider === 'codex' &&
                    status?.state === 'installed' &&
                    (status.trust !== 'trusted' || trustingVisible) && (
                      <Button
                        className="agent-hook-trust"
                        variant="outline"
                        aria-label="信任 Codex Cota Hooks"
                        disabled={blocked}
                        aria-busy={pendingAction === 'trust' || trustingVisible}
                        onClick={() => void manage(provider, 'trust')}
                      >
                        <TrustIcon
                          className={cn(
                            'agent-hook-trust-icon',
                            trustingVisible && 'motion-safe:animate-spin',
                          )}
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        {trustingVisible ? '信任中…' : '信任'}
                      </Button>
                    )}
                  {rowError && (
                    <Button
                      className="agent-hook-row-error"
                      variant="destructive"
                      aria-label={`查看 ${AGENT_PROVIDERS[provider].name} 状态集成错误详情`}
                      aria-haspopup="dialog"
                      onClick={() =>
                        onShowError(`${AGENT_PROVIDERS[provider].name} 状态集成错误详情`, rowError)
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
  )
}
