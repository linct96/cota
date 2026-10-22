import { useState } from 'react'
import {
  AGENT_PROVIDERS,
  unwrap,
  type AgentHookStatus,
  type AgentProvider,
} from '../../../shared/contracts'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

const labels: Record<AgentHookStatus['state'], string> = {
  installed: '文件已安装',
  missing: '未安装',
  outdated: '需要更新',
  conflict: '文件冲突',
  error: '检测失败',
}

export function AgentHookSettings() {
  const [statuses, setStatuses] = useState<AgentHookStatus[]>([])
  const [busy, setBusy] = useState<'detect' | AgentProvider>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  async function detect() {
    if (busy) return
    setBusy('detect')
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
          : `已取消${action === 'uninstall' ? '卸载' : '安装'}，未修改配置。`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section
      className="agent-hook-settings flex flex-col gap-4 px-5 py-4"
      aria-labelledby="agent-hook-settings-title"
      aria-busy={!!busy}
    >
      <div className="agent-hook-settings-header flex flex-wrap items-center justify-between gap-3">
        <h4
          id="agent-hook-settings-title"
          className="agent-hook-settings-title text-sm font-medium"
        >
          Agent 状态集成
        </h4>
        <Button
          className="agent-hook-detect"
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={() => void detect()}
        >
          检测安装状态
        </Button>
      </div>
      <p
        id="agent-hook-settings-help"
        className="agent-hook-settings-help text-xs text-app-muted-foreground"
      >
        安装对应 Hooks / Extension 后，新建终端即可显示 Agent 状态，菜单启动与手动启动一致。
        未安装不影响 CLI 使用，任务状态显示“未知”。
      </p>
      <ul className="agent-hook-list flex flex-col gap-4">
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
          return (
            <li
              key={provider}
              className="agent-hook-row flex flex-wrap items-start justify-between gap-3"
            >
              <div className="agent-hook-description flex min-w-0 flex-1 flex-col gap-1">
                <div className="agent-hook-heading flex flex-wrap items-center gap-2">
                  <span className="agent-hook-name text-sm">
                    {AGENT_PROVIDERS[provider].name}
                    {provider === 'pi' ? ' Extension' : ''}
                  </span>
                  <Badge
                    className="agent-hook-status"
                    variant={
                      status?.state === 'error' || status?.state === 'conflict'
                        ? 'destructive'
                        : 'outline'
                    }
                  >
                    {status ? labels[status.state] : '未检测'}
                  </Badge>
                </div>
                {status && (
                  <p className="agent-hook-detail text-xs text-app-muted-foreground">
                    {status.detail}
                  </p>
                )}
                {status?.paths.map((path) => (
                  <p
                    key={path}
                    className="agent-hook-path break-all font-mono text-xs text-app-muted-foreground"
                  >
                    {path}
                  </p>
                ))}
              </div>
              <div className="agent-hook-actions flex items-center gap-2">
                {status?.state !== 'installed' && (
                  <Button
                    className="agent-hook-install"
                    variant="outline"
                    size="sm"
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
                    className="agent-hook-uninstall"
                    variant="outline"
                    size="sm"
                    aria-label={`卸载 ${AGENT_PROVIDERS[provider].name} ${provider === 'pi' ? 'Extension' : 'Hooks'}`}
                    disabled={!!busy}
                    onClick={() => void manage(provider, 'uninstall')}
                  >
                    卸载
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="agent-hook-install-help text-xs text-app-muted-foreground">
        检测只读；安装和卸载均需确认路径，安装或更新时备份已有配置。卸载不创建备份，仅移除 Cota
        集成，保留其他 Hooks，不结束运行中的 Agent。
      </p>
      <p
        id="agent-hook-settings-limits"
        className="agent-hook-settings-limits text-xs text-app-muted-foreground"
      >
        仅接收状态，不采集对话或工具内容。Codex 确认安装时仅信任 Cota Hooks；定义变更后需重新确认。
        不修改 Hooks 功能开关，不绕过 CLI 权限或企业策略。
      </p>
      <div className="agent-hook-feedback" aria-live="polite">
        {notice && <p className="agent-hook-notice text-xs text-app-muted-foreground">{notice}</p>}
        {error && (
          <p className="agent-hook-error text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
