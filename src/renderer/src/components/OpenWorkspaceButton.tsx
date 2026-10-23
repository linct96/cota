import { useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ChevronDown, FolderOpen, Settings2 } from 'lucide-react'
import { unwrap, type ProjectWorkspace, type WorkspaceOpener } from '../../../shared/contracts'
import { preferredWorkspaceOpener } from '../../../shared/open-with'
import { useWorkspace } from '../store'
import { OpenerIcon } from './OpenWithIcons'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

function openerDisplayName(opener: WorkspaceOpener): string {
  return window.desktop.platform === 'darwin' &&
    (opener.id === 'system-file-manager' || opener.id === 'finder')
    ? '访达'
    : opener.name
}

export function OpenWorkspaceButton({ workspace }: { workspace: ProjectWorkspace }) {
  const router = useRouter()
  const opener = useWorkspace(preferredWorkspaceOpener)
  const openers = useWorkspace((state) => state.workspaceOpeners)
  const unavailable = useWorkspace(
    (state) =>
      !!state.removingWorkspace ||
      state.creatingWorktree ||
      (workspace.kind === 'git-worktree' &&
        state.worktreeScans[workspace.projectPath]?.entries.find(
          (entry) => entry.record.id === workspace.worktreeId,
        )?.status !== 'ready'),
  )
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const label = opener
    ? `使用 ${openerDisplayName(opener)} 打开当前工作区`
    : '请先在设置中配置打开方式'

  async function openDirectory(selectedOpener = opener) {
    if (busy.current || unavailable || !selectedOpener) return
    busy.current = true
    setPending(true)
    try {
      unwrap(
        await window.desktop.openWorkspaceWith(
          {
            projectPath: workspace.projectPath,
            workspaceId: workspace.id,
          },
          selectedOpener.id,
        ),
      )
    } catch (error) {
      // Launch errors are presented by Main through the shared confirmation channel.
      console.warn(error)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <ButtonGroup className="workspace-open-control mr-1 shrink-0" aria-label="打开工作区目录">
      <Button
        variant="outline"
        size="sm"
        className="workspace-open-button"
        aria-label={label}
        aria-busy={pending}
        disabled={unavailable || !opener || pending}
        onClick={() => void openDirectory()}
      >
        {opener ? (
          <>
            <OpenerIcon {...opener} />
            <span className="workspace-open-name max-w-32 truncate">
              {openerDisplayName(opener)}
            </span>
          </>
        ) : (
          <FolderOpen className="workspace-open-placeholder-icon" />
        )}
      </Button>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void useWorkspace.getState().refreshWorkspaceOpeners().catch(console.warn)
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="workspace-open-menu-trigger"
              disabled={unavailable || pending}
              aria-label="选择打开方式"
            />
          }
        >
          <ChevronDown className="workspace-open-chevron" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="workspace-open-menu min-w-44">
          <DropdownMenuGroup className="workspace-open-options" aria-label="打开方式">
            {openers.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                className="workspace-open-option"
                aria-label={`使用 ${openerDisplayName(entry)} 打开当前工作区`}
                disabled={unavailable || pending}
                onClick={() => void openDirectory(entry)}
              >
                <OpenerIcon {...entry} />
                {openerDisplayName(entry)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="workspace-open-menu-separator" />
          <DropdownMenuGroup className="workspace-open-management">
            <DropdownMenuItem
              className="workspace-open-manage"
              onClick={() =>
                void router.navigate({ to: '/settings', search: { section: 'open-with' } })
              }
            >
              <Settings2 className="workspace-open-manage-icon" />
              管理打开方式…
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
