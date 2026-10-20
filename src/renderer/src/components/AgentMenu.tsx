import { useRef, useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import {
  AGENT_PROVIDERS,
  MAX_TERMINALS,
  unwrap,
  type AgentAvailability,
  type AgentProvider,
} from '../../../shared/contracts'
import { useWorkspace } from '../store'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
} from './ui/context-menu'

export function AgentMenu({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const [availability, setAvailability] = useState<AgentAvailability[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  const atLimit = useWorkspace((state) => state.tabs.length >= MAX_TERMINALS)
  const detect = async () => {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    setError(undefined)
    setAvailability([])
    try {
      setAvailability(unwrap(await window.desktop.detectAgents()))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setLoading(false)
    }
  }
  return (
    <ContextMenuSub
      onOpenChange={(open) => {
        if (open) void detect()
      }}
    >
      <ContextMenuSubTrigger className="workspace-new-agent-trigger" disabled={disabled || atLimit}>
        <Bot className="workspace-new-agent-icon" />
        新建 Agent{atLimit ? '（终端已达上限）' : ''}
      </ContextMenuSubTrigger>
      <ContextMenuContent className="workspace-agent-menu" aria-label="新建 Agent">
        <ContextMenuGroup className="workspace-agent-providers">
          {(Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((provider) => {
            const result = availability.find((entry) => entry.provider === provider)
            const available = !!result?.executable
            return (
              <ContextMenuItem
                key={provider}
                className="workspace-agent-provider-item gap-2"
                disabled={disabled || atLimit || loading || !available}
                title={result?.error || result?.executable}
                onClick={() => useWorkspace.getState().newTerminal(provider, workspaceId)}
              >
                <AgentIcon
                  provider={provider}
                  size={14}
                  className="workspace-agent-provider-icon size-3.5 shrink-0"
                />
                <span className="workspace-agent-provider-name flex-1">
                  {AGENT_PROVIDERS[provider].name}
                </span>
                <span className="workspace-agent-provider-version text-muted-foreground">
                  {loading ? '检测中…' : available ? result.version || '版本未知' : '未检测到'}
                </span>
              </ContextMenuItem>
            )
          })}
          <ContextMenuItem
            className="workspace-agent-detect-item"
            closeOnClick={false}
            disabled={loading}
            onClick={() => void detect()}
          >
            <RefreshCw className="workspace-agent-detect-icon" />
            重新检测 CLI
          </ContextMenuItem>
        </ContextMenuGroup>
        <p
          className="workspace-agent-help max-w-64 px-2 py-1.5 text-xs text-muted-foreground"
          role={error ? 'alert' : undefined}
        >
          {error ||
            '状态需要先在“设置 → 常规 → Agent 状态集成”安装对应 Hooks / Extension。未安装或版本不支持时显示“未知”，不影响 CLI 使用。'}
        </p>
      </ContextMenuContent>
    </ContextMenuSub>
  )
}
