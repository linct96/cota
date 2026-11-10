import { useMemo } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, CloudDownload, RefreshCw, Upload } from 'lucide-react'
import { useSourceControl } from '@/state/source-control-store'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceControlBranchPicker } from './SourceControlBranchPicker'
import type { SourceControlChangesPanelProps } from './source-control-changes-types'

export function SourceControlNetworkActions({
  workspace,
  pending,
  syncing,
  references,
  mutate,
  selectedRemote,
}: Pick<
  SourceControlChangesPanelProps,
  'workspace' | 'pending' | 'syncing' | 'references' | 'mutate'
> & { selectedRemote: string }) {
  const status = useSourceControl((state) => state.sessions[workspace.id]?.status)
  const disabled = pending || !status
  const syncLoading = useLoadingIndicator(syncing)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const hasTracking = !!status?.tracking
  const networkDisabled = disabled || !references
  const mergePending = !!status?.merge
  const pushDisabled =
    networkDisabled ||
    mergePending ||
    !status.branch ||
    (hasTracking
      ? !references.remotes.includes(status.tracking!.remote)
      : !selectedRemote || !!status.upstream)
  const hasConflicts = status?.entries.some((entry) => entry.area === 'conflict')
  const syncDisabled = pushDisabled || !status.head || !status.tracking || hasConflicts
  async function remoteAction(action: 'fetch' | 'pull' | 'push' | 'publish' | 'sync') {
    if (action === 'fetch') return mutate({ ...target, action, remote: selectedRemote })
    if (!status?.branch || !status.head) return
    const identity = { branch: status.branch, head: status.head }
    if (action === 'publish')
      return mutate({ ...target, ...identity, action, remote: selectedRemote })
    if (status.tracking)
      return mutate({ ...target, ...identity, action, tracking: status.tracking })
  }
  return (
    <div className="source-control-context min-w-0 flex-none px-2 py-1.5">
      <div className="source-control-branch-row flex min-w-0 items-center justify-between gap-1">
        {status && (
          <>
            <SourceControlBranchPicker
              mode="switch"
              status={status}
              references={references}
              pending={pending}
              onSelect={(ref) => {
                void mutate({
                  ...target,
                  action: 'switch-branch',
                  ref,
                  branch: status.branch,
                  head: status.head,
                })
              }}
              onDelete={(ref) =>
                mutate({
                  ...target,
                  action: 'delete-branch',
                  ref,
                  branch: status.branch,
                  head: status.head,
                })
              }
              onCreate={(name, switchBranch) =>
                status.head
                  ? mutate({
                      ...target,
                      action: switchBranch ? 'create-and-switch-branch' : 'create-branch',
                      name,
                      branch: status.branch,
                      head: status.head,
                    })
                  : Promise.resolve(false)
              }
            />
            <ButtonGroup className="source-control-network-buttons shrink-0" aria-label="远端操作">
              <Button
                variant="outline"
                size="sm"
                className="source-control-sync"
                disabled={syncDisabled || syncLoading}
                title={mergePending ? '请先解决冲突并完成当前合并提交，再同步。' : undefined}
                aria-busy={syncing || syncLoading}
                aria-label={syncing || syncLoading ? '正在同步' : undefined}
                onClick={() => void remoteAction('sync')}
              >
                <RefreshCw
                  className={cn(
                    'source-control-sync-icon',
                    syncLoading && 'motion-safe:animate-spin',
                  )}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                同步
                {status.upstream && (status.ahead > 0 || status.behind > 0) && (
                  <span className="source-control-sync-counts flex shrink-0 items-center gap-0.5 tabular-nums">
                    {status.ahead > 0 && (
                      <>
                        <ArrowUp className="source-control-ahead-icon" aria-hidden="true" />
                        {status.ahead}
                      </>
                    )}
                    {status.behind > 0 && (
                      <>
                        <ArrowDown className="source-control-behind-icon" aria-hidden="true" />
                        {status.behind}
                      </>
                    )}
                  </span>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="source-control-network-menu-trigger"
                  render={<Button variant="outline" size="icon-sm" />}
                  aria-label="更多远端操作"
                  disabled={disabled}
                >
                  <ChevronDown className="source-control-network-menu-icon" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="source-control-network-menu" align="end">
                  <DropdownMenuGroup className="source-control-network-menu-actions">
                    <DropdownMenuItem
                      className="source-control-pull"
                      disabled={syncDisabled}
                      title={
                        hasConflicts
                          ? '请先解决现有合并冲突。'
                          : mergePending
                            ? '请先完成当前合并提交，再拉取。'
                            : '从上游拉取，仅允许快进，不自动 stash；本地更改可能被覆盖时由 Git 拒绝合并。'
                      }
                      onClick={() => void remoteAction('pull')}
                    >
                      <ArrowDown className="source-control-pull-icon" />
                      拉取
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="source-control-push"
                      disabled={pushDisabled || !status.head}
                      title={
                        mergePending
                          ? '请先完成当前合并提交，再推送。'
                          : status.tracking
                            ? `推送至 ${status.tracking.remote}/${status.tracking.branch}`
                            : `发布到 ${selectedRemote}/${status.branch || ''}`
                      }
                      onClick={() => void remoteAction(hasTracking ? 'push' : 'publish')}
                    >
                      <Upload className="source-control-push-icon" />
                      {hasTracking ? '推送' : '发布分支'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="source-control-fetch"
                      disabled={networkDisabled || !selectedRemote}
                      title={`从 ${selectedRemote || '远端'} 获取分支，不改工作文件`}
                      onClick={() => void remoteAction('fetch')}
                    >
                      <CloudDownload className="source-control-fetch-icon" />
                      Fetch
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </>
        )}
      </div>
    </div>
  )
}
