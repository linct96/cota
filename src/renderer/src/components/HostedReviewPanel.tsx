import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ExternalLink,
  GitPullRequest,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react'
import { unwrap, type ProjectWorkspace, type WorkspaceTarget } from '../../../shared/contracts'
import {
  resolveTargetBranchRef,
  type HostedReview,
  type HostedReviewHistory,
  type HostingSnapshot,
} from '../../../shared/code-hosting'
import type { GitReferences, GitStatus } from '../../../shared/source-control'
import { useSourceControl } from '../lib/source-control-store'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { cn } from '../lib/utils'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CreateHostedReviewDialog } from './CreateHostedReviewDialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty'
import { SourceControlSection, SourceControlSectionLayout } from './SourceControlSection'

const checkLabels = {
  pending: '检查等待中',
  running: '检查进行中',
  success: '检查通过',
  failure: '检查失败',
  unknown: '检查状态未知',
  none: '无检查记录',
}

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
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const hosting = useSourceControl((state) => state.sessions[workspace.id]?.hosting)
  const refreshHostingContext = useSourceControl((state) => state.refreshHostingContext)
  const context = hosting?.context
  const identity = JSON.stringify([target, status?.branch, status?.head, status?.tracking, context])
  const [result, setResult] = useState<{
    identity: string
    snapshot?: HostingSnapshot
    error?: string
  }>()
  const [inspecting, setInspecting] = useState(false)
  const loading = inspecting || (active && (!hosting || (hosting.loading && !context)))
  const refreshLoading = useLoadingIndicator(loading)
  const [action, setAction] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [creating, setCreating] = useState<WorkspaceTarget>()
  const epoch = useRef(0)
  const busy = useRef(false)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const data = result?.identity === identity ? result : undefined
  const snapshot = data?.snapshot
  const label = context?.source ? (context.source.provider === 'gitlab' ? 'MR' : 'PR') : 'PR/MR'
  const disabled = pending || loading || action || !active

  useEffect(() => {
    const version = ++epoch.current
    let reading = false
    let lastRead = 0
    async function read() {
      if (reading || busy.current || pending || !active || document.hidden) return
      lastRead = Date.now()
      if (!context || context.reason) {
        setInspecting(false)
        return
      }
      reading = true
      setInspecting(true)
      try {
        const snapshot = unwrap(await window.desktop.codeHosting.inspect(target))
        if (version === epoch.current) setResult({ identity, snapshot })
      } catch (cause) {
        if (version === epoch.current)
          setResult({
            identity,
            error: cause instanceof Error ? cause.message : '代码托管读取失败，请刷新。',
          })
      } finally {
        reading = false
        if (version === epoch.current) setInspecting(false)
      }
    }
    const reload = async () => {
      if (reading || busy.current || pending || !active || document.hidden) return
      void refreshHostingContext(target)
      await read()
    }
    refresh.current = reload
    const onFocus = () => {
      if (Date.now() - lastRead >= 60000) void reload()
    }
    void read()
    const timer = setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      epoch.current = version + 1
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [target, identity, context, active, pending, refreshHostingContext])

  async function run(operation: () => Promise<void>) {
    if (busy.current || disabled) return
    busy.current = true
    setAction(true)
    setActionError(undefined)
    const version = epoch.current
    try {
      await operation()
    } catch (cause) {
      if (version === epoch.current)
        setActionError(cause instanceof Error ? cause.message : '操作失败，请重试。')
    } finally {
      busy.current = false
      setAction(false)
    }
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
        className="hosted-review-navigation flex min-w-0 shrink-0 items-center justify-between gap-2 px-2 py-1.5"
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
          创建 {label}…
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
                          已在网页核对，解除保护…
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
                            创建 {label}…
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

function HostedReviewItem({
  review,
  label,
  disabled,
  onOpen,
}: {
  review: HostedReview
  label: string
  disabled: boolean
  onOpen: () => void
}) {
  return (
    <div className="hosted-review-item flex min-w-0 flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={onOpen}
        title={`${label} #${review.number} · ${review.title}`}
        className="hosted-review-open group/hosted-review-item h-auto w-full min-w-0 flex-col items-stretch justify-start gap-1 px-2 py-1.5 text-left"
      >
        <span className="hosted-review-summary flex min-w-0 items-center gap-1.5">
          <GitPullRequest
            className="hosted-review-item-icon size-3.5 shrink-0 text-app-muted-foreground"
            aria-hidden="true"
          />
          <span className="hosted-review-number shrink-0 font-mono text-app-muted-foreground">
            #{review.number}
          </span>
          <span className="hosted-review-title min-w-0 flex-1 truncate font-medium">
            {review.title}
          </span>
          <Badge variant="secondary" className="hosted-review-state shrink-0">
            {review.state === 'merged'
              ? '已合并'
              : review.state === 'closed'
                ? '已关闭'
                : review.draft
                  ? '草稿'
                  : '开放'}
          </Badge>
          <ExternalLink
            className="hosted-review-open-icon size-3 shrink-0 text-app-muted-foreground opacity-60 transition-opacity group-hover/hosted-review-item:opacity-100"
            aria-hidden="true"
          />
        </span>
        <span className="hosted-review-meta flex min-w-0 items-center justify-between gap-2 pl-5 text-app-muted-foreground">
          <span
            className="hosted-review-branches min-w-0 truncate font-mono"
            title={`${review.sourceBranch} → ${review.targetBranch}`}
          >
            {review.sourceBranch} → {review.targetBranch}
          </span>
          {review.state === 'open' ? (
            <Badge
              variant={review.checks === 'failure' ? 'destructive' : 'outline'}
              className="hosted-review-checks shrink-0"
            >
              {checkLabels[review.checks]}
            </Badge>
          ) : (
            <span className="hosted-review-ended shrink-0 tabular-nums">
              {review.state === 'merged' ? '合并于' : '关闭于'}{' '}
              {new Date(
                review.mergedAt || review.closedAt || review.updatedAt,
              ).toLocaleDateString()}
            </span>
          )}
        </span>
      </Button>
      {review.checksError && (
        <output className="hosted-review-checks-error px-2 text-muted-foreground">
          {review.checksError}
        </output>
      )}
    </div>
  )
}

function HostedReviewHistoryPanel({
  snapshot,
  target,
  active,
  disabled,
  label,
  open,
  onOpenChange,
  onOpen,
}: {
  snapshot: HostingSnapshot
  target: { projectPath: string; workspaceId: string }
  active: boolean
  disabled: boolean
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: (number: number) => void
}) {
  const [history, setHistory] = useState<HostedReviewHistory>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; page: number }>()
  const load = useRef<(page: number) => Promise<void>>(async () => {})
  useEffect(() => {
    let disposed = false
    let reading = false
    async function read(page: number) {
      if (reading || !open || !active) return
      reading = true
      setLoading(true)
      setError(undefined)
      try {
        const next = unwrap(
          await window.desktop.codeHosting.history(target, snapshot.context.key, page),
        )
        if (!disposed)
          setHistory((previous) => ({
            ...next,
            items:
              page === 1
                ? next.items
                : [
                    ...new Map(
                      [...(previous?.items || []), ...next.items].map((review) => [
                        review.number,
                        review,
                      ]),
                    ).values(),
                  ],
          }))
      } catch (cause) {
        if (!disposed)
          setError({
            page,
            message: cause instanceof Error ? cause.message : '历史读取失败，请重试。',
          })
      } finally {
        reading = false
        if (!disposed) setLoading(false)
      }
    }
    load.current = read
    void read(1)
    return () => {
      disposed = true
    }
  }, [open, active, target, snapshot.context.key, snapshot.fetchedAt])
  return (
    <SourceControlSection
      open={open}
      onOpenChange={onOpenChange}
      disabled={!active}
      title={
        <>
          <span className="hosted-review-history-label">同名来源分支历史</span>
          {history && (
            <Badge variant="secondary" className="hosted-review-history-count">
              {history.items.length}
            </Badge>
          )}
        </>
      }
    >
      <div className="hosted-review-history-content flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 py-3 text-xs">
        <p className="hosted-review-history-note px-2 text-muted-foreground">
          包含同仓库、同名来源分支的已合并与已关闭记录；同名重建的分支也可能包含在内。
        </p>
        <LoadingContent pending={loading} label="评审历史读取中..." showLabel>
          <div className="hosted-review-history-list flex flex-col gap-1">
            {history?.items.map((review) => (
              <HostedReviewItem
                key={review.number}
                review={review}
                label={label}
                disabled={disabled || loading}
                onOpen={() => onOpen(review.number)}
              />
            ))}
            {history && !history.items.length && (
              <p className="hosted-review-history-empty px-2 text-muted-foreground">
                {history.nextPage ? '本页没有匹配记录，可继续加载。' : '暂无匹配的历史记录。'}
              </p>
            )}
          </div>
        </LoadingContent>
        {error && (
          <Alert variant="destructive" className="hosted-review-history-error">
            <AlertDescription className="hosted-review-history-error-description">
              {error.message}
            </AlertDescription>
          </Alert>
        )}
        {(error || history?.nextPage) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hosted-review-history-more self-start"
            disabled={loading || !active}
            onClick={() => void load.current(error?.page || history?.nextPage || 1)}
          >
            {error ? '重试读取历史' : '加载更多'}
          </Button>
        )}
      </div>
    </SourceControlSection>
  )
}

export function HostedReviewCreateButton({
  workspace,
  pending,
  defaults,
}: {
  workspace: ProjectWorkspace
  pending: boolean
  defaults?: ComponentProps<typeof CreateHostedReviewDialog>['defaults']
}) {
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const [open, setOpen] = useState(false)
  const provider = useSourceControl(
    (state) => state.sessions[workspace.id]?.hosting?.context?.source?.provider,
  )
  const label = provider ? (provider === 'gitlab' ? 'MR' : 'PR') : 'PR/MR'

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="source-control-comparison-create-review ml-auto"
        disabled={pending}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <GitPullRequest
          className="source-control-comparison-create-review-icon"
          data-icon="inline-start"
          aria-hidden="true"
        />
        创建 {label}
      </Button>
      {open && (
        <CreateHostedReviewDialog
          target={target}
          open
          defaults={defaults}
          onOpenChange={setOpen}
          onCreated={() => setOpen(false)}
        />
      )}
    </>
  )
}
