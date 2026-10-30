import { useMemo } from 'react'
import { Check, ChevronRight, FileDiff, Minus, Plus, Undo2 } from 'lucide-react'
import { gitFileKey, type GitArea, type GitChange } from '../../../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { useWorkspace } from '@/state/workspace'
import { buildGitChangeTree } from '@/features/source-control/lib/source-control-tree'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SourceControlFileStats } from './SourceControlFileStats'
import { SourceFileExplorer } from './SourceFileExplorer'
import { FileTreeActions, FileTreeFile } from '@/components/ui/file-tree'
import { FileTypeIcon } from '@/features/files/components/FileTypeIcon'
import type { SourceControlChangesPanelProps } from './source-control-changes-types'

const groups: { area: GitArea; label: string }[] = [
  { area: 'conflict', label: '合并冲突' },
  { area: 'staged', label: '已暂存' },
  { area: 'unstaged', label: '未暂存' },
  { area: 'untracked', label: '未跟踪' },
]
const labels: Record<string, string> = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '重命名',
  C: '复制',
  T: '类型变更',
  '?': '未跟踪',
}

export function SourceControlFileGroups({
  workspace,
  pending,
  mutate,
}: Pick<SourceControlChangesPanelProps, 'workspace' | 'pending' | 'mutate'>) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const status = session.status
  const selectedDiff = session.activePinnedDiff || (session.preview ? session.selection : undefined)
  const changeGroups = useMemo(
    () =>
      groups.map((group) => {
        const entries = (status?.entries || []).filter((entry) => entry.area === group.area)
        return { ...group, entries, nodes: buildGitChangeTree(entries) }
      }),
    [status?.entries],
  )
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const disabled = pending || !status
  const stageable =
    status?.entries.filter(
      (entry) => (entry.area === 'unstaged' || entry.area === 'untracked') && !entry.submodule,
    ) || []
  const filesAction = (action: 'stage' | 'unstage' | 'discard', entries: GitChange[]) =>
    void mutate({ ...target, action, files: entries.map(({ path, area }) => ({ path, area })) })
  return (
    <>
      <nav
        className="source-control-changes-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2 py-1.5"
        aria-label="更改操作"
      >
        <Button
          variant="ghost"
          size="sm"
          className="source-control-view-all"
          disabled={disabled || !status?.entries.length}
          onClick={() => useSourceControl.getState().openChanges(workspace.id)}
        >
          <FileDiff className="source-control-view-all-icon" data-icon="inline-start" />
          查看全部变更
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="source-control-stage-all"
          disabled={disabled || !stageable.length}
          title="暂存所有未暂存和未跟踪文件，不含冲突文件与子模块"
          onClick={() => filesAction('stage', stageable)}
        >
          <Plus className="source-control-stage-all-icon" data-icon="inline-start" />
          暂存全部
        </Button>
      </nav>
      <div className="source-control-files min-h-0 flex-1 overflow-auto px-2 py-2">
        {status && status.entries.length === 0 && (
          <Empty className="source-control-clean">
            <EmptyHeader className="source-control-clean-header">
              <EmptyMedia variant="icon" className="source-control-clean-media">
                <Check className="source-control-clean-icon" />
              </EmptyMedia>
              <EmptyTitle className="source-control-clean-title">工作区干净</EmptyTitle>
              <EmptyDescription className="source-control-clean-description">
                没有未提交的更改。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {changeGroups.map(({ area, label, entries, nodes }) => {
          if (!entries.length) return null
          const targets = entries.filter((entry) => !entry.submodule)
          return (
            <Collapsible defaultOpen key={area} className="source-control-group mb-2">
              <div className="source-control-group-header flex items-center gap-1 px-1 py-1">
                <CollapsibleTrigger className="source-control-group-trigger group/source-control-group flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium">
                  <ChevronRight
                    className="source-control-group-toggle-icon size-3 shrink-0 group-aria-expanded/source-control-group:rotate-90"
                    aria-hidden="true"
                  />
                  <span className="source-control-group-label">{label}</span>
                  <Badge variant="secondary" className="source-control-group-count">
                    {entries.length}
                  </Badge>
                </CollapsibleTrigger>
                {(area === 'unstaged' || area === 'untracked') && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="source-control-group-discard"
                    aria-label={`放弃 ${targets.length} 个${label}文件的更改`}
                    title="放弃该组全部更改（需确认）"
                    disabled={disabled || !targets.length}
                    onClick={() => filesAction('discard', targets)}
                  >
                    <Undo2 className="source-control-discard-icon" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="source-control-group-stage"
                  aria-label={`${area === 'staged' ? '取消暂存' : '暂存'}${targets.length} 个${label}文件`}
                  title={
                    area === 'staged'
                      ? '取消暂存该组全部文件'
                      : area === 'conflict'
                        ? '暂存以标记已解决'
                        : '暂存该组全部文件'
                  }
                  disabled={disabled || !targets.length}
                  onClick={() => filesAction(area === 'staged' ? 'unstage' : 'stage', targets)}
                >
                  {area === 'staged' ? (
                    <Minus className="source-control-unstage-icon" />
                  ) : (
                    <Plus className="source-control-stage-icon" />
                  )}
                </Button>
              </div>
              <CollapsibleContent className="source-control-group-files flex flex-col gap-0.5">
                <SourceFileExplorer
                  nodes={nodes}
                  label={`${label}文件树`}
                  selectedPath={selectedDiff?.area === area ? selectedDiff.path : undefined}
                  renderDirectoryActions={(directoryEntries, path) => {
                    const targets = directoryEntries.filter((entry) => !entry.submodule)
                    return (
                      <>
                        {(area === 'unstaged' || area === 'untracked') && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="source-control-directory-discard"
                            aria-label={`放弃 ${path} 下 ${targets.length} 个${label}文件的更改`}
                            title="放弃该目录及子目录的更改（需确认）"
                            disabled={disabled || !targets.length}
                            onClick={() => filesAction('discard', targets)}
                          >
                            <Undo2 className="source-control-directory-discard-icon" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="source-control-directory-stage"
                          aria-label={`${area === 'staged' ? '取消暂存' : '暂存'} ${path} 下 ${targets.length} 个${label}文件`}
                          title={
                            area === 'staged'
                              ? '取消暂存该目录及子目录的文件'
                              : area === 'conflict'
                                ? '暂存该目录及子目录的文件以标记已解决'
                                : '暂存该目录及子目录的文件'
                          }
                          disabled={disabled || !targets.length}
                          onClick={() =>
                            filesAction(area === 'staged' ? 'unstage' : 'stage', targets)
                          }
                        >
                          {area === 'staged' ? (
                            <Minus className="source-control-directory-unstage-icon" />
                          ) : (
                            <Plus className="source-control-directory-stage-icon" />
                          )}
                        </Button>
                      </>
                    )
                  }}
                  renderFile={(entry, name, itemProps) => {
                    const key = gitFileKey(entry)
                    return (
                      <div
                        key={key}
                        className="source-control-file-row flex min-w-0 items-center gap-1 pr-1"
                        data-selected={selectedDiff && gitFileKey(selectedDiff) === key}
                      >
                        <FileTreeFile
                          {...itemProps}
                          path={entry.path}
                          className="source-file-explorer-item source-control-file-open min-w-0 flex-1 justify-start gap-1.5"
                          title={`${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
                          onClick={() =>
                            useWorkspace.getState().openDiff(workspace.id, {
                              path: entry.path,
                              area: entry.area,
                            })
                          }
                        >
                          <ChevronRight
                            className="source-file-explorer-chevron invisible size-3"
                            aria-hidden="true"
                          />
                          <FileTypeIcon path={entry.path} submodule={entry.submodule} />
                          <span className="source-control-file-path min-w-0 flex-1 truncate text-left">
                            {name}
                          </span>
                          {entry.submodule && (
                            <span className="source-control-submodule text-app-muted-foreground">
                              子模块
                            </span>
                          )}
                        </FileTreeFile>
                        <FileTreeActions className="source-control-file-trailing grid items-center">
                          <div className="source-control-file-summary col-start-1 row-start-1 flex items-center justify-end gap-1.5">
                            <SourceControlFileStats stats={entry.stats} />
                            <span
                              className="source-control-file-status shrink-0 font-mono text-app-muted-foreground"
                              aria-label={labels[entry.status] || '冲突'}
                              title={labels[entry.status] || '冲突'}
                            >
                              {entry.status === '?' ? 'U' : entry.status}
                            </span>
                          </div>
                          <div className="source-control-file-actions col-start-1 row-start-1 flex items-center justify-self-end gap-0.5">
                            {(area === 'unstaged' || area === 'untracked') && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="source-control-file-discard"
                                aria-label={`放弃 ${entry.path} 的更改`}
                                title="放弃更改（需确认）"
                                disabled={disabled || entry.submodule}
                                onClick={() => filesAction('discard', [entry])}
                              >
                                <Undo2 className="source-control-file-discard-icon" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="source-control-file-stage"
                              aria-label={`${area === 'staged' ? '取消暂存' : '添加暂存'} ${entry.path}`}
                              title={area === 'staged' ? '取消暂存' : '添加暂存'}
                              disabled={disabled || entry.submodule}
                              onClick={() =>
                                filesAction(area === 'staged' ? 'unstage' : 'stage', [entry])
                              }
                            >
                              {area === 'staged' ? (
                                <Minus className="source-control-file-unstage-icon" />
                              ) : (
                                <Plus className="source-control-file-stage-icon" />
                              )}
                            </Button>
                          </div>
                        </FileTreeActions>
                      </div>
                    )
                  }}
                />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </>
  )
}
