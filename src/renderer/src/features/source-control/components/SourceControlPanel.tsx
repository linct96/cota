import { useEffect, useMemo, useRef, useState } from 'react'
import { unwrap } from '../../../../../shared/contracts'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import type { GitFailureDetails, GitMutation } from '../../../../../shared/source-control'
import { useGitBranches } from '@/state/git-branches-store'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { createSourceControlRefreshQueue } from '@/features/source-control/lib/source-control-refresh'
import { useSourceControlWatch } from '@/features/source-control/hooks/use-source-control-watch'
import { useCommitMessageGeneration } from '@/features/source-control/hooks/use-commit-message-generation'
import { useDialogState } from '@/hooks/use-dialog-state'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SourceControlChangesPanel } from './SourceControlChangesPanel'
import { SourceControlComparePanel } from './SourceControlComparePanel'
import { SourceControlHistoryPanel } from './SourceControlHistoryPanel'
import { HostedReviewPanel } from './HostedReviewPanel'

type SourceControlError = {
  message: string
  git?: GitFailureDetails
}

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
  const [error, setError] = useState<SourceControlError>()
  const [readError, setReadError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const {
    references: currentReferences,
    snapshot,
    error: referencesError,
  } = useGitBranches(target, active)
  const [branchView, setBranchView] = useState({ references: currentReferences, snapshot })
  // Keep the last available snapshot when the hidden view releases its subscription.
  if (
    currentReferences &&
    (branchView.references !== currentReferences || branchView.snapshot !== snapshot)
  )
    setBranchView({ references: currentReferences, snapshot })
  const references = currentReferences || branchView.references
  const branchTips = snapshot?.branches || branchView.snapshot?.branches
  const [dialogError, setDialogError, errorDialog] = useDialogState<SourceControlError>()
  const currentError = error?.message || readError || referencesError
  useEffect(() => {
    // Preserve asynchronous IPC errors in the dismissible dialog until the user closes it.
    // oxlint-disable-next-line react/set-state-in-effect
    if (currentError) setDialogError(error || { message: currentError })
  }, [currentError, error, setDialogError])
  const readTask = useRef<Promise<void> | undefined>(undefined)
  const writing = useRef(false)
  const mounted = useRef(true)
  const isMounted = () => mounted.current
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
      if (!isMounted()) return
      update(workspace.id, { status: next, refreshed: Date.now() })
      void refreshHostingContext(target)
      setReadError(undefined)
    } catch (cause) {
      if (isMounted()) {
        update(workspace.id, { status: undefined })
        setReadError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  // Queue initialization stores callbacks; refs are only read when the queue runs.
  // oxlint-disable-next-line react/refs
  const [refreshQueue] = useState(() =>
    createSourceControlRefreshQueue(
      () => (readTask.current = refresh()),
      () => isMounted() && activeRef.current && !document.hidden && !writing.current,
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

  async function mutate(input: GitMutation, throwOnError = false) {
    if (writing.current) return false
    writing.current = true
    setPending(true)
    setSyncing(input.action === 'sync')
    setError(undefined)
    let failure: GitFailureDetails | undefined
    try {
      await generation.cancel()
      // Keep background reads silent without overlapping them with writes.
      await readTask.current
      if (!isMounted()) return false
      const result = await window.desktop.gitMutate(input)
      if (!result.ok) failure = result.details?.git
      const done = unwrap(result)
      if (
        done &&
        input.action === 'commit' &&
        useSourceControl.getState().sessions[workspace.id]?.draft === input.message
      )
        update(workspace.id, { draft: '' })
      if (!isMounted()) return false
      if (done && (input.action === 'switch-branch' || input.action === 'create-and-switch-branch'))
        update(workspace.id, {
          selection: undefined,
          preview: false,
          activePinnedDiff: undefined,
        })
      return done
    } catch (cause) {
      if (
        throwOnError ||
        input.action === 'create-branch' ||
        input.action === 'create-and-switch-branch' ||
        input.action === 'delete-branch'
      )
        throw cause
      if (isMounted())
        setError({ message: cause instanceof Error ? cause.message : String(cause), git: failure })
      return false
    } finally {
      // Refresh partial writes too, without hiding a commit/hook failure behind a successful status read.
      try {
        if (isMounted()) {
          const next = unwrap(await window.desktop.gitStatus(target))
          if (isMounted()) {
            update(workspace.id, { status: next, refreshed: Date.now() })
            void refreshHostingContext(target)
            setReadError(undefined)
          }
        }
      } catch (cause) {
        if (isMounted()) {
          update(workspace.id, { status: undefined })
          setReadError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        writing.current = false
        if (isMounted()) {
          setPending(false)
          setSyncing(false)
        }
        refreshQueue.flush()
      }
    }
  }

  const dirtyWorktree = dialogError?.git?.kind === 'dirty-worktree'

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
            onError={(message) => setError({ message })}
          />
        </TabsContent>
        <TabsContent
          value="compare"
          keepMounted
          className="source-control-compare-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <SourceControlComparePanel
            workspace={workspace}
            active={active && selected && session.mode === 'compare'}
            references={references}
            branchTips={branchTips}
            pending={pending}
            onFetch={(remote) => mutate({ ...target, action: 'fetch', remote }, true)}
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
          keepMounted
          className="source-control-history-content flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden"
        >
          <SourceControlHistoryPanel
            workspace={workspace}
            active={active && selected && session.mode === 'history'}
          />
        </TabsContent>
      </Tabs>
      <AlertDialog
        {...errorDialog}
        open={active && errorDialog.open}
        onOpenChange={(open) => {
          if (!open) setDialogError(undefined)
        }}
      >
        <AlertDialogContent className="source-control-error-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader className="source-control-error-header min-w-0 place-items-start text-left">
            <AlertDialogTitle className="source-control-error-title">
              {dirtyWorktree ? '请先处理本地改动' : '操作未完成'}
            </AlertDialogTitle>
            <AlertDialogDescription className="source-control-error-detail max-h-32 w-full overflow-auto whitespace-pre-wrap break-words select-text">
              {dirtyWorktree
                ? '请提交相关更改，或使用 git stash 保存后重试。'
                : dialogError?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialogError?.git && (
            <Tabs defaultValue="log" className="source-control-error-diagnostics min-h-0 min-w-0">
              <TabsList className="source-control-error-diagnostic-tabs" aria-label="Git 诊断">
                <TabsTrigger className="source-control-error-log-tab" value="log">
                  Git 日志
                </TabsTrigger>
                <TabsTrigger className="source-control-error-output-tab" value="output">
                  命令输出
                </TabsTrigger>
              </TabsList>
              <div className="source-control-error-diagnostic-panels h-[min(35vh,18rem)] min-w-0">
                <TabsContent
                  className="source-control-error-log-panel h-full overflow-auto rounded-md border bg-muted p-3"
                  value="log"
                >
                  <pre className="source-control-error-log font-mono whitespace-pre-wrap break-words select-text">
                    {dialogError.git.log}
                  </pre>
                </TabsContent>
                <TabsContent
                  className="source-control-error-output-panel h-full overflow-auto rounded-md border bg-muted p-3"
                  value="output"
                >
                  <pre className="source-control-error-output font-mono whitespace-pre-wrap break-words select-text">
                    {`> ${dialogError.git.command}\n\n${dialogError.git.output || '命令未返回输出。'}`}
                  </pre>
                </TabsContent>
              </div>
            </Tabs>
          )}
          <AlertDialogFooter className="source-control-error-footer">
            <AlertDialogCancel className="source-control-error-dismiss self-end" variant="default">
              关闭
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
