import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, GitMerge, GitPullRequest, Lock, RefreshCw } from 'lucide-react'
import { unwrap } from '../../../../../shared/contracts'
import type { ProjectWorkspace, WorkspaceTarget } from '../../../../../shared/contracts'
import { resolveTargetBranchRef } from '../../../../../shared/code-hosting'
import type { HostedReview, MergeHostedReview } from '../../../../../shared/code-hosting'
import type { GitReferences, GitStatus } from '../../../../../shared/source-control'
import { useSourceControl } from '@/state/source-control-store'
import { cn } from '@/lib/utils'
import { useDialogState } from '@/hooks/use-dialog-state'
import { LoadingContent } from '@/components/LoadingContent'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CreateHostedReviewDialog } from './CreateHostedReviewDialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { SourceControlSectionLayout } from './SourceControlSection'
import { useHostedReview } from '../hooks/use-hosted-review'
import { HostedReviewDetails } from './HostedReviewDetails'
import { HostedReviewHistoryPanel } from './HostedReviewHistoryPanel'

export function HostedReviewPanel({
  workspace,
  active,
  status,
  references,
  pending,
}: {
  workspace: ProjectWorkspace
  active: boolean
  status?: GitStatus
  references?: GitReferences
  pending: boolean
}) {
  const navigate = useNavigate()
  const {
    target,
    hosting,
    context,
    data,
    snapshot,
    label,
    loading,
    refreshLoading,
    action,
    actionError,
    disabled,
    refresh,
    run,
  } = useHostedReview({ workspace, active, status, pending })
  const review = snapshot?.latestReview
  const targetRef = review
    ? resolveTargetBranchRef(snapshot.context, references, review.targetBranch)
    : undefined
  const repoPath = snapshot?.context.target?.path || context?.target?.path
  const [creating, setCreating] = useState<WorkspaceTarget>()
  const [merging, setMerging, mergeDialog] = useDialogState<{
    target: WorkspaceTarget
    review: HostedReview
    input: MergeHostedReview
  }>()
  const [mergeError, setMergeError] = useState<string>()

  async function confirmMerge() {
    if (!merging || merging.target !== target) return
    setMergeError(undefined)
    await run(async () => {
      try {
        unwrap(await window.desktop.codeHosting.merge(merging.target, merging.input))
        setMerging(undefined)
      } catch (cause) {
        setMergeError(cause instanceof Error ? cause.message : '合并失败，请刷新或在网页核对。')
      }
    })
    await refresh.current()
  }

  function openCreate() {
    if (!disabled) setCreating(target)
  }

  function compareTarget() {
    if (!targetRef) return
    useSourceControl.getState().update(workspace.id, {
      mode: 'compare',
      baseRef: targetRef,
    })
  }

  return (
    <section
      className="hosted-review-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="分支代码评审"
      aria-busy={loading || action}
    >
      <nav
        className="hosted-review-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2.5 py-1.5"
        aria-label="代码评审操作"
      >
        <span
          className="hosted-review-repository min-w-0 truncate font-mono text-2xs text-app-muted-foreground [unicode-bidi:plaintext]"
          title={repoPath || undefined}
        >
          {repoPath || '代码评审'}
        </span>
        <div className="hosted-review-actions flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="hosted-review-create"
            disabled={disabled || !snapshot}
            aria-label={`创建 ${label}`}
            title={`创建 ${label}`}
            onClick={openCreate}
          >
            <GitPullRequest
              className="hosted-review-create-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            新建
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="hosted-review-refresh"
            aria-label="刷新 PR/MR"
            title="刷新 PR/MR"
            disabled={disabled}
            onClick={() => void refresh.current()}
          >
            <RefreshCw
              className={cn(
                'hosted-review-refresh-icon',
                refreshLoading && 'motion-safe:animate-spin',
              )}
              aria-hidden="true"
            />
          </Button>
        </div>
      </nav>
      <SourceControlSectionLayout
        resizeLabel="调整最新评审与历史评审记录区域高度"
        section={
          snapshot
            ? (open, onOpenChange) => (
                <HostedReviewHistoryPanel
                  key={`${snapshot.context.key}:${snapshot.account}`}
                  snapshot={snapshot}
                  target={target}
                  active={active}
                  disabled={disabled}
                  label={label}
                  open={open}
                  onOpenChange={onOpenChange}
                  onOpen={(number) =>
                    void run(async () => {
                      unwrap(await window.desktop.codeHosting.open(target, number))
                    })
                  }
                />
              )
            : undefined
        }
      >
        <div className="hosted-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 text-xs">
          {(hosting?.error || data?.error || actionError) && (
            <Alert variant="destructive" className="hosted-review-error">
              <AlertDescription className="hosted-review-error-description whitespace-pre-wrap wrap-anywhere select-text">
                {actionError || hosting?.error || data?.error}
              </AlertDescription>
            </Alert>
          )}
          <LoadingContent pending={loading && !data} label="代码评审读取中...">
            <div className="hosted-review-content flex min-h-0 flex-1 flex-col gap-3">
              {context?.reason ? (
                <Empty className="hosted-review-unbound">
                  <EmptyHeader className="hosted-review-unbound-header">
                    <EmptyMedia variant="icon" className="hosted-review-unbound-media">
                      <GitPullRequest className="hosted-review-unbound-icon" aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle className="hosted-review-unbound-title">暂不可用</EmptyTitle>
                    <EmptyDescription className="hosted-review-unbound-description">
                      {context.reason}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="hosted-review-unbound-content">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="hosted-review-unbound-settings"
                      disabled={action}
                      onClick={() =>
                        void navigate({ to: '/settings', search: { section: 'code-hosting' } })
                      }
                    >
                      前往代码托管设置
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : snapshot ? (
                <>
                  {snapshot.creationBlocked && (
                    <div
                      role="alert"
                      className="hosted-review-pending flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/8 p-2.5 text-xs"
                    >
                      <div className="hosted-review-pending-header flex items-start gap-2 text-destructive">
                        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="hosted-review-pending-text min-w-0">
                          上次创建结果未确认，已启用防重复保护。请先刷新或在网页核对。
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="hosted-review-unlock self-start bg-background"
                        disabled={disabled}
                        onClick={() =>
                          void run(async () => {
                            unwrap(
                              await window.desktop.codeHosting.clearCreation(
                                target,
                                snapshot.context.key,
                              ),
                            )
                          }).then(() => refresh.current())
                        }
                      >
                        已在网页核对，解除保护
                      </Button>
                    </div>
                  )}
                  {review ? (
                    <div className="hosted-review-latest flex min-w-0 flex-col gap-3">
                      <HostedReviewDetails
                        review={review}
                        label={label}
                        account={snapshot.account}
                        unpushed={review.state === 'open' && review.head !== snapshot.context.head}
                        targetRef={targetRef}
                        disabled={disabled}
                        onCompare={compareTarget}
                        onMerge={() => {
                          setMergeError(undefined)
                          setMerging({
                            target,
                            review,
                            input: {
                              key: snapshot.context.key,
                              account: snapshot.account,
                              number: review.number,
                              sourceBranch: review.sourceBranch,
                              targetBranch: review.targetBranch,
                              head: review.head,
                            },
                          })
                        }}
                        onOpen={() =>
                          void run(async () => {
                            unwrap(await window.desktop.codeHosting.open(target, review.number))
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="hosted-review-empty flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-6 text-center">
                      <div className="hosted-review-empty-media flex size-8 items-center justify-center rounded-full bg-muted text-foreground">
                        <GitPullRequest
                          className="hosted-review-empty-icon size-4"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="hosted-review-empty-copy flex min-w-0 max-w-full flex-col gap-0.5">
                        <p className="hosted-review-empty-title text-xs font-medium text-foreground">
                          当前分支尚未发起评审
                        </p>
                        {snapshot.context.branch && (
                          <p
                            className="hosted-review-empty-branch truncate font-mono text-2xs text-muted-foreground [unicode-bidi:plaintext]"
                            title={snapshot.context.branch}
                          >
                            {snapshot.context.branch}
                          </p>
                        )}
                      </div>
                      {!snapshot.creationBlocked && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="hosted-review-empty-create w-full"
                          disabled={disabled}
                          onClick={openCreate}
                        >
                          <GitPullRequest
                            className="hosted-review-empty-create-icon"
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                          创建 {label}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </LoadingContent>
        </div>
      </SourceControlSectionLayout>
      <AlertDialog
        {...mergeDialog}
        open={active && mergeDialog.open}
        onOpenChange={(open) => {
          if (!open && !action) setMerging(undefined)
        }}
      >
        <AlertDialogContent
          className="hosted-review-merge-dialog max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
          aria-busy={action}
        >
          <AlertDialogHeader className="hosted-review-merge-header min-w-0 place-items-start text-left">
            <AlertDialogTitle className="hosted-review-merge-title flex items-center gap-2">
              <GitMerge className="size-4 shrink-0" aria-hidden="true" />
              <span>
                合并 {label}
                {merging ? ` #${merging.input.number}` : ''}？
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription className="hosted-review-merge-description">
              将在远端合并当前评审，本地分支不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {merging && (
            <div className="hosted-review-merge-details flex min-w-0 flex-col gap-2.5 text-xs/relaxed">
              <p className="hosted-review-merge-review font-medium wrap-anywhere">
                {merging.review.title}
              </p>
              <p
                className="hosted-review-merge-branches flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-2xs"
                aria-label={`将 ${merging.input.sourceBranch} 合并到 ${merging.input.targetBranch}`}
              >
                <span className="hosted-review-merge-source min-w-0 truncate text-foreground [unicode-bidi:plaintext]">
                  {merging.input.sourceBranch}
                </span>
                <ArrowRight
                  className="hosted-review-merge-direction size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="hosted-review-merge-target min-w-0 truncate text-app-muted-foreground [unicode-bidi:plaintext]">
                  {merging.input.targetBranch}
                </span>
              </p>
            </div>
          )}
          {mergeError && (
            <Alert variant="destructive" className="hosted-review-merge-error">
              <AlertDescription className="hosted-review-merge-error-description whitespace-pre-wrap wrap-anywhere">
                {mergeError}
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter className="hosted-review-merge-footer">
            <AlertDialogCancel className="hosted-review-merge-cancel" disabled={action}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="hosted-review-merge-confirm"
              disabled={disabled || !merging || merging.target !== target || !!mergeError}
              onClick={() => void confirmMerge()}
            >
              {action ? '合并中' : '确认合并'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {creating === target && (
        <CreateHostedReviewDialog
          key={JSON.stringify(target)}
          target={target}
          open={active}
          onOpenChange={(open) => {
            if (!open) setCreating(undefined)
          }}
          onCreated={() => {
            setCreating(undefined)
            void refresh.current()
          }}
        />
      )}
    </section>
  )
}
