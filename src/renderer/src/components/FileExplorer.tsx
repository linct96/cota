import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronRight, ChevronsDownUp, Folder, FolderOpen, Link, RefreshCw } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { FileAction } from '../../../shared/file-explorer'
import {
  EMPTY_EXPLORER,
  explorerRows,
  useFileExplorer,
  type ExplorerRow,
} from '../lib/file-explorer-store'
import { useSourceControl } from '../lib/source-control-store'
import { useFileWatch } from '../lib/use-file-watch'
import { useWorkspace } from '../store'
import { FileTypeIcon } from './FileTypeIcon'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu'

export function FileExplorer({
  workspace,
  active,
}: {
  workspace: ProjectWorkspace
  active: boolean
}) {
  const session = useFileExplorer((state) => state.sessions[workspace.id] || EMPTY_EXPLORER)
  const explorerOptions = useWorkspace((state) => state.preferences.fileExplorer)
  const folderPath = useWorkspace((state) =>
    workspace.kind === 'git-worktree'
      ? state.worktreeRecords.find((record) => record.id === workspace.worktreeId)?.path
      : workspace.projectPath,
  )
  const folderName =
    folderPath?.split(/[\\/]/).filter(Boolean).pop() || folderPath || workspace.name
  const scroll = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(session.scrollTop)
  const tree = useRef<HTMLDivElement>(null)
  const [restart, setRestart] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const visibleSession = {
    ...session,
    directories: Object.fromEntries(
      Object.entries(session.directories).map(([path, directory]) => [
        path,
        {
          ...directory,
          entries: directory.entries
            ?.filter((entry) => explorerOptions.showIgnored || !entry.ignored)
            .map((entry) =>
              !explorerOptions.followSymlinks && entry.symlink
                ? { ...entry, kind: 'link' as const }
                : entry,
            ),
        },
      ]),
    ),
  }
  const rows = explorerRows(visibleSession)
  const directories = [
    '',
    ...rows
      .filter((row) => row.kind === 'directory' && session.expanded[row.path])
      .map((row) => row.path),
  ]
  const directoryKey = JSON.stringify(directories)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const root = session.directories['']
  const rootLoaded = !!root?.entries
  const focusPath = rows.some((row) => row.path === session.selected)
    ? session.selected
    : rows[0]?.path
  const watchError = useFileWatch(
    target,
    directories,
    active,
    refresh,
    `${restart}:${JSON.stringify(explorerOptions)}`,
  )

  function refresh(paths = directories) {
    for (const path of paths) void useFileExplorer.getState().load(target, path)
  }
  const refreshActive = useEffectEvent(() => refresh())
  useEffect(() => {
    if (active) refreshActive()
  }, [active, target, explorerOptions])
  useEffect(() => {
    if (!active) return
    const current = useFileExplorer.getState().sessions[workspace.id]
    const watched: string[] = JSON.parse(directoryKey)
    for (const path of watched) {
      if (!current?.directories[path]) void useFileExplorer.getState().load(target, path)
    }
  }, [active, workspace.id, directoryKey, target])
  useLayoutEffect(() => {
    if (active && rootLoaded && scroll.current) {
      scrollTop.current = useFileExplorer.getState().sessions[workspace.id]?.scrollTop || 0
      scroll.current.scrollTop = scrollTop.current
    }
    return () => {
      if (active && rootLoaded)
        useFileExplorer.getState().update(workspace.id, { scrollTop: scrollTop.current })
    }
  }, [active, workspace.id, rootLoaded])

  function toggle(path: string, open: boolean) {
    useFileExplorer
      .getState()
      .update(workspace.id, { expanded: { ...session.expanded, [path]: open } })
  }
  function activate(row: ExplorerRow) {
    if (row.kind === 'directory') toggle(row.path, !session.expanded[row.path])
    else useSourceControl.getState().update(workspace.id, { file: row.path, preview: true })
  }
  function focus(path?: string) {
    const elements = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    Array.from(elements || [])
      .find((entry) => entry.dataset.path === path)
      ?.focus()
  }
  function act(path: string, action: FileAction) {
    setActionError(undefined)
    void window.desktop
      .fileAction(target, path, action)
      .then(unwrap)
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <section
      className="file-explorer flex min-h-0 flex-1 flex-col"
      aria-label={`${folderName} 文件浏览`}
    >
      <header className="file-explorer-header flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <h2
          className="file-explorer-title min-w-0 flex-1 truncate px-1 text-xs font-medium"
          title={folderPath || workspace.name}
        >
          {folderName}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="file-explorer-refresh"
          title="刷新文件树并重新连接监听"
          aria-label="刷新文件树"
          onClick={() => {
            refresh()
            setRestart((value) => value + 1)
          }}
        >
          <RefreshCw className="file-explorer-refresh-icon" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="file-explorer-collapse"
          title="全部折叠"
          aria-label="全部折叠目录"
          onClick={() => useFileExplorer.getState().update(workspace.id, { expanded: {} })}
        >
          <ChevronsDownUp className="file-explorer-collapse-icon" />
        </Button>
      </header>
      {(watchError || actionError) && (
        <Alert className="file-explorer-alert m-2 w-auto">
          <AlertDescription className="file-explorer-alert-description">
            {actionError || watchError}
          </AlertDescription>
        </Alert>
      )}
      <div
        ref={scroll}
        className="file-explorer-scroll min-h-0 flex-1 overflow-auto p-1"
        onScroll={(event) => {
          if (active) scrollTop.current = event.currentTarget.scrollTop
        }}
      >
        {root?.error && (
          <Alert variant="destructive" className="file-explorer-root-error mb-1">
            <AlertDescription className="file-explorer-root-error-description">
              {root.error} 请刷新重试；已有列表可能已过期。
            </AlertDescription>
          </Alert>
        )}
        {rootLoaded && !rows.length && !root.error && (
          <Empty className="file-explorer-empty rounded-none">
            <EmptyHeader className="file-explorer-empty-header">
              <EmptyTitle className="file-explorer-empty-title">目录为空</EmptyTitle>
              <EmptyDescription className="file-explorer-empty-description">
                此工作区还没有可浏览的文件。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div
          ref={tree}
          role="tree"
          tabIndex={-1}
          aria-label={`${folderName} 文件树`}
          aria-busy={!rootLoaded && !root?.error}
          className="file-explorer-tree flex min-w-0 flex-col gap-0.5"
          onKeyDown={(event) => {
            const element = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
            if (!element || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            const index = rows.findIndex((row) => row.path === element.dataset.path)
            const row = rows[index]
            if (!row) return
            switch (event.key) {
              case 'ArrowDown':
                focus(rows[Math.min(index + 1, rows.length - 1)]?.path)
                break
              case 'ArrowUp':
                focus(rows[Math.max(0, index - 1)]?.path)
                break
              case 'Home':
                focus(rows[0]?.path)
                break
              case 'End':
                focus(rows.at(-1)?.path)
                break
              case 'ArrowRight':
                if (row.kind !== 'directory') return
                if (!session.expanded[row.path]) toggle(row.path, true)
                else if (rows[index + 1]?.parent === row.path) focus(rows[index + 1].path)
                break
              case 'ArrowLeft':
                if (row.kind === 'directory' && session.expanded[row.path]) toggle(row.path, false)
                else focus(row.parent)
                break
              default:
                return
            }
            event.preventDefault()
          }}
        >
          {rows.map((row) => {
            const expanded = row.kind === 'directory' && !!session.expanded[row.path]
            const directory = session.directories[row.path]
            return (
              <Fragment key={row.path}>
                <ContextMenu>
                  <ContextMenuTrigger
                    render={<Button variant="project" />}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-posinset={row.position}
                    aria-setsize={row.siblings}
                    aria-expanded={row.kind === 'directory' ? expanded : undefined}
                    aria-busy={expanded && !directory?.entries && !directory?.error}
                    aria-selected={session.selected === row.path}
                    tabIndex={focusPath === row.path ? 0 : -1}
                    data-path={row.path}
                    data-ignored={row.ignored || undefined}
                    className="file-explorer-row w-full min-w-0 justify-start gap-1.5"
                    style={{ paddingLeft: 6 + row.depth * 12 }}
                    title={row.kind === 'link' ? `${row.path}（符号链接，不跟随）` : row.path}
                    onFocus={() =>
                      useFileExplorer.getState().update(workspace.id, { selected: row.path })
                    }
                    onClick={() => activate(row)}
                  >
                    <ChevronRight
                      className="file-explorer-chevron"
                      data-visible={row.kind === 'directory'}
                      data-expanded={expanded}
                      aria-hidden="true"
                    />
                    {row.kind === 'directory' ? (
                      expanded ? (
                        <FolderOpen className="file-explorer-folder-icon" aria-hidden="true" />
                      ) : (
                        <Folder className="file-explorer-folder-icon" aria-hidden="true" />
                      )
                    ) : row.kind === 'link' ? (
                      <Link className="file-explorer-link-icon" aria-hidden="true" />
                    ) : (
                      <FileTypeIcon path={row.path} />
                    )}
                    <span className="file-explorer-entry-name min-w-0 truncate">{row.name}</span>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    className="file-explorer-context-menu"
                    aria-label={`${row.name} 操作`}
                  >
                    <ContextMenuGroup className="file-explorer-context-actions">
                      <ContextMenuItem
                        className="file-explorer-copy-relative"
                        onClick={() => act(row.path, 'copy-relative')}
                      >
                        复制相对路径
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="file-explorer-copy-absolute"
                        onClick={() => act(row.path, 'copy-absolute')}
                      >
                        复制绝对路径
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="file-explorer-reveal"
                        onClick={() => act(row.path, 'reveal')}
                      >
                        {window.desktop.platform === 'darwin'
                          ? '在 Finder 中显示'
                          : '在文件资源管理器中显示'}
                      </ContextMenuItem>
                    </ContextMenuGroup>
                  </ContextMenuContent>
                </ContextMenu>
                {expanded && (directory?.error || directory?.entries?.length === 0) && (
                  <div
                    role="none"
                    className="file-explorer-directory-status flex min-w-0 items-center gap-1 pr-1 text-xs text-app-muted-foreground"
                    style={{ paddingLeft: 24 + row.depth * 12 }}
                  >
                    <span
                      role={directory?.error ? 'alert' : 'status'}
                      className="file-explorer-directory-message min-w-0 flex-1 break-words"
                    >
                      {directory?.error || '空目录'}
                    </span>
                    {directory?.error && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="file-explorer-directory-retry"
                        aria-label={`重新读取 ${row.path}`}
                        onClick={() => refresh([row.path])}
                      >
                        <RefreshCw className="file-explorer-directory-retry-icon" />
                      </Button>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    </section>
  )
}
