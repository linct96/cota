import { useEffect, useMemo, useRef, useState } from 'react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { GitMutation } from '../../../shared/source-control'
import { useGitBranches } from '../lib/git-branches-store'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { createSourceControlRefreshQueue } from '../lib/source-control-refresh'
import { useSourceControlWatch } from '../lib/use-source-control-watch'
import { useCommitMessageGeneration } from '../lib/use-commit-message-generation'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { SourceControlChangesPanel } from './SourceControlChangesPanel'
import { SourceControlComparePanel } from './SourceControlComparePanel'
import { SourceControlHistoryPanel } from './SourceControlHistoryPanel'
import { HostedReviewPanel } from './HostedReviewPanel'

export function SourceControlPanel({
  workspace,
  active,
  selected,
}: {
  workspace: ProjectWorkspace
  active: boolean
  selected: boolean
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const update = useSourceControl((state) => state.update)
  const refreshHostingContext = useSourceControl((state) => state.refreshHostingContext)
  const [error, setError] = useState<string>()
  const [readError, setReadError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const { references, error: referencesError } = useGitBranches(target, active)
  const [dialogError, setDialogError] = useState<string>()
  const currentError = error || readError || referencesError
  useEffect(() => {
    // Preserve asynchronous IPC errors in the dismissible dialog until the user closes it.
    // oxlint-disable-next-line react/set-state-in-effect
    if (currentError) setDialogError(currentError)
  }, [currentError])
  const readTask = useRef<Promise<void> | undefined>(undefined)
  const writing = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const status = session.status
  const generation = useCommitMessageGeneration(target)

  async function refresh() {
    if (writing.current) return
    try {
      const next = unwrap(await window.desktop.gitStatus(target))
      if (!mounted.current) return
      update(workspace.id, { status: next, refreshed: Date.now() })
      void refreshHostingContext(target)
      setReadError(undefined)
    } catch (error) {
      if (mounted.current) {
        update(workspace.id, { status: undefined })
        setReadError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  // Queue initialization stores callbacks; refs are only read when the queue runs.
  // oxlint-disable-next-line react/refs
  const [refreshQueue] = useState(() =>
    createSourceControlRefreshQueue(
      () => (readTask.current = refresh()),
      () => mounted.current && activeRef.current && !document.hidden && !writing.current,
    ),
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      refreshQueue.cancel()
    }
  }, [refreshQueue])
  useEffect(() => () => refreshQueue.cancel(), [active, refreshQueue])
  useSourceControlWatch(target, active, refreshQueue.request)

  async function mutate(input: GitMutation) {
    if (writing.current) return false
    writing.current = true
    setPending(true)
    setSyncing(input.action === 'sync')
    setError(undefined)
    try {
      await generation.cancel()
      // Keep background reads silent without overlapping them with writes.
      await readTask.current
      if (!mounted.current) return false
      const done = unwrap(await window.desktop.gitMutate(input))
      if (
        done &&
        input.action === 'commit' &&
        useSourceControl.getState().sessions[workspace.id]?.draft === input.message
      )
        update(workspace.id, { draft: '' })
      if (!mounted.current) return false
      if (done && (input.action === 'switch-branch' || input.action === 'create-and-switch-branch'))
        update(workspace.id, {
          selection: undefined,
          preview: false,
          activePinnedDiff: undefined,
        })
      return done
    } catch (error) {
      if (
        input.action === 'create-branch' ||
        input.action === 'create-and-switch-branch' ||
        input.action === 'delete-branch'
      )
        throw error
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      // Refresh partial writes too, without hiding a commit/hook failure behind a successful status read.
      try {
        if (mounted.current) {
          const next = unwrap(await window.desktop.gitStatus(target))
          if (mounted.current) {
            update(workspace.id, { status: next, refreshed: Date.now() })
            void refreshHostingContext(target)
            setReadError(undefined)
          }
        }
      } catch (error) {
        if (mounted.current) {
          update(workspace.id, { status: undefined })
          setReadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        writing.current = false
        if (mounted.current) {
          setPending(false)
          setSyncing(false)
        }
        refreshQueue.flush()
      }
    }
  }

  return (
    <section
      className="source-control-panel flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={`${workspace.name} 源代码管理`}
      aria-busy={pending || (!status && !error && !readError)}
    >
      <Tabs
        value={session.mode}
        onValueChange={(value) => {
          if (
            value === 'changes' ||
            value === 'history' ||
            value === 'compare' ||
            value === 'review'
          )
            update(workspace.id, { mode: value })
        }}
        className="source-control-sections flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="source-control-header flex shrink-0 flex-col">
          <TabsList
            variant="line"
            className="source-control-section-tabs"
            aria-label="源代码管理视图"
          >
            <TabsTrigger className="source-control-changes-tab" value="changes">
              更改
            </TabsTrigger>
            <TabsTrigger className="source-control-compare-tab" value="compare">
              比较
            </TabsTrigger>
            <TabsTrigger className="source-control-hosted-review-tab" value="review">
              评审
            </TabsTrigger>
            <TabsTrigger className="source-control-history-tab" value="history">
              历史
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="changes"
          keepMounted
          className="source-control-changes-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <SourceControlChangesPanel
            workspace={workspace}
            pending={pending}
            syncing={syncing}
            references={references}
            generation={generation}
            writing={writing}
            mutate={mutate}
            onError={setError}
          />
        </TabsContent>
        <TabsContent
          value="compare"
          className="source-control-compare-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <SourceControlComparePanel
            workspace={workspace}
            active={active && selected && session.mode === 'compare'}
            references={references}
            pending={pending}
            onCreateBranch={(name, head) =>
              mutate({ ...target, action: 'create-branch', name, head })
            }
          />
        </TabsContent>
        <TabsContent
          value="review"
          keepMounted
          className="source-control-hosted-review-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <HostedReviewPanel
            workspace={workspace}
            active={active && selected && session.mode === 'review'}
            status={status}
            references={references}
            pending={pending || syncing}
          />
        </TabsContent>
        <TabsContent
          value="history"
          className="source-control-history-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <SourceControlHistoryPanel
            workspace={workspace}
            active={active && selected && session.mode === 'history'}
          />
        </TabsContent>
      </Tabs>
      <AlertDialog
        open={active && !!dialogError}
        onOpenChange={(open) => {
          if (!open) setDialogError(undefined)
        }}
      >
        <AlertDialogContent className="source-control-error-dialog">
          <AlertDialogHeader className="source-control-error-header min-w-0">
            <AlertDialogTitle className="source-control-error-title">操作未完成</AlertDialogTitle>
            <AlertDialogDescription className="source-control-error-detail max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words select-text">
              {dialogError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="source-control-error-footer">
            <AlertDialogCancel className="source-control-error-dismiss">知道了</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
