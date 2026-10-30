import { Bot } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import { AGENT_PROVIDERS, MAX_TERMINALS } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { useAgentClis } from '../lib/agent-cli-store'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
} from './ui/context-menu'

export function AgentMenu({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const cache = useAgentClis((state) => state.cache)
  const error = useAgentClis((state) => state.error)
  const atLimit = useWorkspace((state) => state.tabs.length >= MAX_TERMINALS)
  const available = cache?.entries.filter((entry) => entry.executable) ?? []
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="workspace-new-agent-trigger" disabled={disabled || atLimit}>
        <Bot className="workspace-new-agent-icon" />
        新建 Agent{atLimit ? '（终端已达上限）' : ''}
      </ContextMenuSubTrigger>
      <ContextMenuContent className="workspace-agent-menu" aria-label="新建 Agent">
        <ContextMenuGroup className="workspace-agent-providers">
          {available.map(({ provider, executable, version }) => (
            <ContextMenuItem
              key={provider}
              className="workspace-agent-provider-item gap-2"
              disabled={disabled || atLimit}
              title={executable}
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
              <span className="workspace-agent-provider-version text-app-muted-foreground">
                {version || '版本未知'}
              </span>
            </ContextMenuItem>
          ))}
          {available.length === 0 && (
            <ContextMenuItem className="workspace-agent-empty-item" disabled>
              {error
                ? 'Agent CLI 缓存读取失败，请前往设置'
                : cache
                  ? '未安装 Agent CLI，请前往设置'
                  : 'Agent CLI 缓存读取中…'}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenuSub>
  )
}
