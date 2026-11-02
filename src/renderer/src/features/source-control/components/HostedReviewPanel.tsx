import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { GitPullRequest, Plus, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import {
  unwrap,
  type ProjectWorkspace,
  type WorkspaceTarget,
} from '../../../../../shared/contracts'
import {
  resolveTargetBranchRef,
  type HostedReview,
  type MergeHostedReview,
} from '../../../../../shared/code-hosting'
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
import { HostedReviewItem } from './HostedReviewItem'
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

  return (
    <section
      className="hosted-review-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="分支代码评审"
      aria-busy={loading || action}
    >
      <nav
        className="hosted-review-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2 py-1.5"
        aria-label="代码评审操作"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hosted-review-create"
          disabled={disabled || !snapshot}
          onClick={() => void openCreate()}
        >
          <Plus className="hosted-review-create-icon" data-icon="inline-start" aria-hidden="true" />
          创建 {label}
        </Button>
        <div className="hosted-review-actions flex items-center gap-1">
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="hosted-review-settings"
            aria-label="代码托管设置"
            title="代码托管设置"
            disabled={action}
            onClick={() => void navigate({ to: '/settings', search: { section: 'code-hosting' } })}
          >
            <SettingsIcon className="hosted-review-settings-icon" aria-hidden="true" />
          </Button>
        </div>
      </nav>
      <SourceControlSectionLayout
        defaultOpen={false}
        defaultExpandedSize="50%"
        resizeLabel="调整开放评审与同名来源分支历史区域高度"
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
        <div className="hosted-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-2 py-2 text-xs">
          {(hosting?.error || data?.error || actionError) && (
            <Alert variant="destructive" className="hosted-review-error">
              <AlertDescription className="hosted-review-error-description whitespace-pre-wrap break-words select-text">
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
                    <Alert className="hosted-review-pending">
                      <AlertDescription className="hosted-review-pending-description flex flex-col gap-2">
                        <span className="hosted-review-pending-text">
                          上次创建结果未确认。请先刷新或到网页核对，避免重复创建。
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="hosted-review-unlock self-start"
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
                      </AlertDescription>
                    </Alert>
                  )}
                  {snapshot.activeReviews.length > 0 ? (
                    <div className="hosted-review-active-list flex flex-col gap-1.5">
                      {snapshot.activeReviews.map((review) => {
                        const targetRef = resolveTargetBranchRef(
                          snapshot.context,
                          references,
                          review.targetBranch,
                        )
                        return (
                          <div
                            key={review.number}
                            className="hosted-review-active-item flex flex-col gap-1"
                          >
                            <HostedReviewItem
                              review={review}
                              label={label}
                              disabled={disabled}
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
                                  unwrap(
                                    await window.desktop.codeHosting.open(target, review.number),
                                  )
                                })
                              }
                            />
                            {review.head !== snapshot.context.head && (
                              <div className="hosted-review-unpushed flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1 text-muted-foreground">
                                <span className="hosted-review-unpushed-text min-w-0 flex-1">
                                  本地 HEAD 与评审版本不同，请先推送再刷新。
                                  {!targetRef && '目标分支尚未获取，请先 Fetch 后再比较。'}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="hosted-review-compare-button shrink-0"
                                  disabled={disabled || !targetRef}
                                  title={
                                    !targetRef
                                      ? '目标仓库的分支引用尚未获取，请先 Fetch 后再比较。'
                                      : undefined
                                  }
                                  onClick={() => {
                                    if (targetRef)
                                      useSourceControl.getState().update(workspace.id, {
                                        mode: 'compare',
                                        baseRef: targetRef,
                                      })
                                  }}
                                >
                                  比较差异
                                </Button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <Empty className="hosted-review-empty flex-none py-6">
                      <EmptyHeader className="hosted-review-empty-header">
                        <EmptyMedia variant="icon" className="hosted-review-empty-media">
                          <GitPullRequest className="hosted-review-empty-icon" aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle className="hosted-review-empty-title">
                          暂无开放的 {label}
                        </EmptyTitle>
                        <EmptyDescription className="hosted-review-empty-description">
                          当前分支没有开放的 {label}。已合并或关闭的记录保留在历史中。
                        </EmptyDescription>
                      </EmptyHeader>
                      {!snapshot.creationBlocked && (
                        <EmptyContent className="hosted-review-empty-content">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="hosted-review-empty-create"
                            disabled={disabled}
                            onClick={() => void openCreate()}
                          >
                            <Plus
                              className="hosted-review-empty-create-icon"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            创建 {label}
                          </Button>
                        </EmptyContent>
                      )}
                    </Empty>
                  )}
                </>
              ) : null}
            </div>
          </LoadingContent>
        </div>
      </SourceControlSectionLayout>
      <AlertDialog
        {...mergeDialog}
        onOpenChange={(open) => {
          if (!open && !action) setMerging(undefined)
        }}
      >
        <AlertDialogContent className="hosted-review-merge-dialog" aria-busy={action}>
          <AlertDialogHeader className="hosted-review-merge-header">
            <AlertDialogTitle className="hosted-review-merge-title">
              合并 {merging?.input ? `#${merging.input.number}` : '评审'}？
            </AlertDialogTitle>
            <AlertDialogDescription className="hosted-review-merge-description">
              将远端来源分支合并到目标分支。此操作会修改远端仓库，不包含本地未推送的修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {merging && (
            <div className="hosted-review-merge-details flex min-w-0 flex-col gap-2">
              <p className="hosted-review-merge-review break-words">{merging.review.title}</p>
              <p className="hosted-review-merge-branches break-all font-mono">
                {merging.input.sourceBranch} → {merging.input.targetBranch}
              </p>
              <p className="hosted-review-merge-head break-all font-mono">
                远端提交：{merging.input.head}
              </p>
              <p className="hosted-review-merge-policy text-muted-foreground">
                GitHub 使用普通合并；GitLab 遵循项目合并规则，不主动压缩提交或删除来源分支。
                平台仍会校验权限、审批和检查；分支自动清理由仓库设置决定。本地分支不变。
              </p>
            </div>
          )}
          {mergeError && (
            <Alert variant="destructive" className="hosted-review-merge-error">
              <AlertDescription className="hosted-review-merge-error-description">
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
              {action ? '合并中…' : '确认合并'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {creating === target && (
        <CreateHostedReviewDialog
          key={JSON.stringify(target)}
          target={target}
          open
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
