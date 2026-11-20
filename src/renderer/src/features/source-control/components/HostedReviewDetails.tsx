import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  GitCompareArrows,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HostedPipeline, HostedReview } from '../../../../../shared/code-hosting'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { HostedReviewStatus, formatReviewRelativeTime } from './HostedReviewStatus'

const pipelineStatuses = new Map<
  string,
  [label: string, icon: LucideIcon, variant: 'secondary' | 'success' | 'destructive' | 'warning']
>([
  ['created', ['等待中', Clock, 'warning']],
  ['waiting_for_resource', ['等待资源', Clock, 'warning']],
  ['preparing', ['准备中', Clock, 'warning']],
  ['pending', ['等待中', Clock, 'warning']],
  ['running', ['运行中', LoaderCircle, 'secondary']],
  ['success', ['成功', CircleCheck, 'success']],
  ['failed', ['失败', CircleX, 'destructive']],
  ['canceled', ['已取消', Ban, 'secondary']],
  ['skipped', ['已跳过', CircleMinus, 'secondary']],
  ['neutral', ['不影响结果', CircleMinus, 'secondary']],
  ['manual', ['待手动执行', Clock, 'warning']],
  ['scheduled', ['已计划', Clock, 'warning']],
])

function getPipelineStatus(status: string) {
  const normalized = status.toLowerCase()
  const [label, Icon, variant] =
    pipelineStatuses.get(normalized) ?? (['状态未知', CircleHelp, 'secondary'] as const)
  return { normalized, label, Icon, variant }
}

function TimelineNode({
  icon,
  iconClassName,
  children,
}: {
  icon: ReactNode
  iconClassName?: string
  children: ReactNode
}) {
  return (
    <div className="hosted-review-timeline-node pl-6">
      <span
        className={cn(
          'hosted-review-timeline-marker absolute top-0.5 left-0 flex size-4 items-center justify-center rounded-full bg-background',
          iconClassName,
        )}
      >
        {icon}
      </span>
      {children}
    </div>
  )
}

function PipelineStageDots({ stages }: { stages: NonNullable<HostedPipeline['stages']> }) {
  return (
    <span className="hosted-review-pipeline-dots inline-flex items-center gap-1" aria-hidden="true">
      {stages.map((stage) => {
        const { normalized, label, variant } = getPipelineStatus(stage.status)
        return (
          <span
            key={stage.id ?? stage.name}
            className="hosted-review-pipeline-dot size-1.5 rounded-full"
            data-status={normalized}
            data-variant={variant}
            title={`${stage.name}：${label}`}
          />
        )
      })}
    </span>
  )
}

const pipelineModeLabels = {
  live: 'CI 流水线',
  'before-merge': '合并前流水线',
  'after-merge': '合并后流水线',
} as const

function ReviewPipeline({
  pipeline,
  mode,
}: {
  pipeline: HostedPipeline
  mode: 'live' | 'before-merge' | 'after-merge'
}) {
  const [open, setOpen] = useState(mode === 'live')
  const title = pipelineModeLabels[mode]
  const latestStage = pipeline.stages?.at(-1)
  const { Icon, normalized, label, variant } = getPipelineStatus(
    pipeline.status || latestStage?.status || 'unknown',
  )
  const totalStages = pipeline.stages?.length ?? 0
  const passedStages =
    pipeline.stages?.filter((s) => s.status.toLowerCase() === 'success').length ?? 0

  const statusIcon = (
    <Icon
      className={cn(
        'hosted-review-pipeline-stage-icon size-3.5 shrink-0 text-app-muted-foreground',
        normalized === 'running' && 'motion-safe:animate-spin',
      )}
      data-status={normalized}
      data-variant={variant}
      aria-hidden="true"
    />
  )

  return (
    <TimelineNode icon={statusIcon}>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        render={<section aria-label={title} />}
        className="hosted-review-pipeline min-w-0"
      >
        <h4 className="hosted-review-pipeline-title text-xs font-medium text-foreground">
          <CollapsibleTrigger className="hosted-review-pipeline-trigger group/pipeline -mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-background-hover">
            <span className="hosted-review-pipeline-label-group flex min-w-0 items-center gap-1.5">
              <span className="hosted-review-pipeline-label truncate">{title}</span>
              {totalStages > 0 && (
                <span className="hosted-review-pipeline-progress shrink-0 text-2xs font-normal text-app-muted-foreground tabular-nums">
                  {passedStages}/{totalStages}
                </span>
              )}
            </span>
            <span className="hosted-review-pipeline-summary-right flex shrink-0 items-center gap-1.5">
              {!open && pipeline.stages?.length ? (
                <>
                  <span className="hosted-review-pipeline-sr-status sr-only">{label}</span>
                  <PipelineStageDots stages={pipeline.stages} />
                </>
              ) : (
                <output
                  className="hosted-review-pipeline-summary-label text-2xs font-medium text-app-muted-foreground"
                  data-status={normalized}
                  data-variant={variant}
                  aria-label={`${title}状态：${label}`}
                >
                  {label}
                </output>
              )}
              <ChevronRight
                className="hosted-review-pipeline-chevron size-3 shrink-0 text-app-muted-foreground group-aria-expanded/pipeline:rotate-90 motion-safe:transition-transform motion-safe:duration-200"
                aria-hidden="true"
              />
            </span>
          </CollapsibleTrigger>
        </h4>

        <CollapsibleContent className="hosted-review-pipeline-content h-(--collapsible-panel-height) overflow-hidden motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out data-starting-style:h-0 data-ending-style:h-0">
          {pipeline.stages?.length ? (
            <ol
              className="hosted-review-pipeline-stages mt-1.5 flex flex-col gap-0.5 rounded-md border border-border bg-muted/35 p-1"
              aria-label={`${title}阶段`}
            >
              {pipeline.stages.map((stage) => {
                const stageStatus = getPipelineStatus(stage.status)
                const {
                  Icon: StageIcon,
                  normalized: stageNorm,
                  label: stageLabel,
                  variant: stageVar,
                } = stageStatus
                return (
                  <li
                    key={stage.id ?? stage.name}
                    className="hosted-review-pipeline-stage flex items-center justify-between gap-2 rounded-xs px-1.5 py-1 text-xs"
                  >
                    <span className="hosted-review-pipeline-stage-info flex min-w-0 items-center gap-1.5">
                      <StageIcon
                        className={cn(
                          'hosted-review-pipeline-stage-icon size-3 shrink-0 text-app-muted-foreground',
                          stageNorm === 'running' && 'motion-safe:animate-spin',
                        )}
                        data-status={stageNorm}
                        data-variant={stageVar}
                        aria-hidden="true"
                      />
                      <span className="hosted-review-pipeline-stage-name min-w-0 truncate font-mono text-2xs select-text [unicode-bidi:plaintext]">
                        {stage.name}
                      </span>
                    </span>
                    <span
                      className="hosted-review-pipeline-summary-label shrink-0 text-2xs text-app-muted-foreground"
                      data-status={stageNorm}
                      data-variant={stageVar}
                    >
                      {stageLabel}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="hosted-review-pipeline-unavailable mt-1 text-2xs text-app-muted-foreground">
              {pipeline.stages ? '无阶段记录' : '无法读取阶段明细'}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </TimelineNode>
  )
}

function formatDateTime(value: string): string | undefined {
  if (!Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

export function HostedReviewDetails({
  review,
  label,
  account,
  unpushed,
  targetRef,
  disabled,
  onOpen,
  onMerge,
  onCompare,
}: {
  review: HostedReview
  label: string
  account?: string
  unpushed: boolean
  targetRef?: string
  disabled: boolean
  onOpen: () => void
  onMerge: () => void
  onCompare: () => void
}) {
  const createdRel = formatReviewRelativeTime(review.createdAt)
  const closedAt = review.closedAt || review.updatedAt
  const closedTime = formatDateTime(closedAt)
  const mergedAt =
    review.mergedAt && Number.isFinite(Date.parse(review.mergedAt)) ? review.mergedAt : undefined
  const mergedTime = mergedAt ? formatDateTime(mergedAt) : undefined
  const canMerge = review.state === 'open' && !review.draft
  const checksFailed = review.checks === 'failure'
  const sectionTitle = review.state === 'open' ? '合并就绪检查' : '状态详情'

  function renderChecksNode() {
    if (review.checks === 'success') {
      return (
        <TimelineNode icon={<CircleCheck className="size-3.5 text-success" aria-hidden="true" />}>
          <div className="hosted-review-readiness-row py-0.5 text-xs font-medium text-success">
            <span className="truncate">远端检查已通过</span>
          </div>
        </TimelineNode>
      )
    }
    if (review.checks === 'running') {
      return (
        <TimelineNode
          icon={
            <LoaderCircle
              className="size-3.5 text-(--dot-status-working) motion-safe:animate-spin"
              aria-hidden="true"
            />
          }
        >
          <div className="hosted-review-readiness-row py-0.5 text-xs text-foreground">
            <span className="truncate">远端检查运行中…</span>
          </div>
        </TimelineNode>
      )
    }
    if (review.checks === 'pending') {
      return (
        <TimelineNode icon={<Clock className="size-3.5 text-warning" aria-hidden="true" />}>
          <div className="hosted-review-readiness-row py-0.5 text-xs text-warning">
            <span className="truncate">远端检查等待中</span>
          </div>
        </TimelineNode>
      )
    }
    if (review.checks === 'failure') {
      return (
        <TimelineNode icon={<CircleX className="size-3.5 text-destructive" aria-hidden="true" />}>
          <div className="hosted-review-readiness-row flex items-center justify-between gap-2 text-xs text-destructive">
            <span className="min-w-0 truncate font-medium">远端检查失败</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="hosted-review-checks-detail h-5.5 shrink-0 px-1.5 text-2xs text-foreground"
              disabled={disabled}
              onClick={onOpen}
            >
              详情
            </Button>
          </div>
        </TimelineNode>
      )
    }
    if (review.checks === 'unknown') {
      return (
        <TimelineNode icon={<CircleHelp className="size-3.5 text-warning" aria-hidden="true" />}>
          <div className="hosted-review-readiness-row flex flex-col gap-0.5 py-0.5 text-xs">
            <span className="truncate text-warning">检查状态未确认</span>
            {review.checksError && (
              <output className="hosted-review-details-checks-error text-2xs text-muted-foreground wrap-anywhere">
                {review.checksError}
              </output>
            )}
          </div>
        </TimelineNode>
      )
    }
    return (
      <TimelineNode icon={<Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />}>
        <div className="hosted-review-readiness-row py-0.5 text-xs text-muted-foreground">
          <span className="truncate">无远端检查项</span>
        </div>
      </TimelineNode>
    )
  }

  function renderTimelineNodes() {
    if (review.state === 'open') {
      return (
        <>
          <TimelineNode
            icon={
              unpushed ? (
                <Upload className="size-3.5 text-warning" aria-hidden="true" />
              ) : (
                <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
              )
            }
          >
            {unpushed ? (
              <div className="hosted-review-unpushed flex items-center justify-between gap-2 text-xs text-warning">
                <span className="hosted-review-unpushed-text min-w-0 truncate font-medium">
                  本地有未推送提交
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="hosted-review-compare-inline h-5.5 shrink-0 px-1.5 text-2xs text-foreground"
                  disabled={disabled || !targetRef}
                  title={
                    !targetRef
                      ? '目标仓库的分支引用尚未获取，请先 Fetch 后再比较。'
                      : '与目标分支比较差异'
                  }
                  onClick={onCompare}
                >
                  比较
                </Button>
              </div>
            ) : (
              <div className="hosted-review-synced py-0.5 text-xs text-app-muted-foreground">
                <span className="min-w-0 truncate">本地与远端提交一致</span>
              </div>
            )}
          </TimelineNode>

          {review.pipeline ? (
            <ReviewPipeline key={review.url} pipeline={review.pipeline} mode="live" />
          ) : (
            renderChecksNode()
          )}

          {review.draft && (
            <TimelineNode
              icon={
                <GitPullRequestDraft
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              }
            >
              <div className="hosted-review-draft-notice py-0.5 text-xs text-muted-foreground">
                <span className="truncate">草稿状态</span>
              </div>
            </TimelineNode>
          )}
        </>
      )
    }

    if (review.state === 'merged') {
      return (
        <>
          {review.preMergePipeline && (
            <ReviewPipeline
              key={`${review.url}:before-merge`}
              pipeline={review.preMergePipeline}
              mode="before-merge"
            />
          )}
          <TimelineNode
            icon={<GitMerge className="size-3 text-success" aria-hidden="true" />}
            iconClassName="bg-success/12"
          >
            <div className="hosted-review-ended flex min-w-0 flex-col gap-0.5 py-0.5">
              <div className="hosted-review-merged-row flex items-center justify-between gap-2 text-xs">
                <span
                  className="hosted-review-merged-summary min-w-0 truncate font-medium text-foreground"
                  title={mergedTime && `合并于 ${mergedTime}`}
                >
                  已合并至{' '}
                  <code className="hosted-review-merged-branch rounded bg-muted px-1 py-0.5 font-mono text-2xs font-normal text-foreground [unicode-bidi:plaintext]">
                    {review.targetBranch}
                  </code>
                </span>
                {mergedAt && (
                  <time
                    className="hosted-review-merged-rel shrink-0 text-2xs text-app-muted-foreground tabular-nums"
                    dateTime={mergedAt}
                    title={mergedTime}
                  >
                    {formatReviewRelativeTime(mergedAt)}
                  </time>
                )}
              </div>
              {(review.authorUsername || mergedTime) && (
                <div className="hosted-review-merged-metadata flex min-w-0 items-center gap-1.5 text-2xs whitespace-nowrap text-app-muted-foreground">
                  {review.authorUsername && (
                    <span
                      className="hosted-review-author truncate font-mono"
                      title={review.authorUsername}
                    >
                      <span className="hosted-review-author-label sr-only">发起人：</span>
                      @${review.authorUsername}
                    </span>
                  )}
                  {review.authorUsername && mergedTime && (
                    <span
                      className="hosted-review-merged-separator shrink-0 opacity-50"
                      aria-hidden="true"
                    >
                      ·
                    </span>
                  )}
                  {mergedAt && mergedTime && (
                    <time
                      className="hosted-review-merged-time shrink-0 tabular-nums"
                      dateTime={mergedAt}
                    >
                      <span className="hosted-review-merged-time-label sr-only">合并时间：</span>
                      {mergedTime}
                    </time>
                  )}
                </div>
              )}
            </div>
          </TimelineNode>
          {review.pipeline && (
            <ReviewPipeline key={review.url} pipeline={review.pipeline} mode="after-merge" />
          )}
        </>
      )
    }

    return (
      <TimelineNode
        icon={<GitPullRequestClosed className="size-3 text-destructive" aria-hidden="true" />}
        iconClassName="bg-destructive/12"
      >
        <div className="hosted-review-ended flex min-w-0 flex-col gap-0.5 py-0.5">
          <span
            className="min-w-0 truncate text-xs font-medium text-foreground tabular-nums"
            title={closedTime ? `关闭于 ${closedTime}` : undefined}
          >
            已于 {formatReviewRelativeTime(closedAt)} 关闭
          </span>
          {closedTime && (
            <time
              className="hosted-review-closed-time text-2xs text-app-muted-foreground tabular-nums"
              dateTime={closedAt}
            >
              {closedTime}
            </time>
          )}
        </div>
      </TimelineNode>
    )
  }

  return (
    <article className="hosted-review-details flex min-w-0 flex-col gap-3">
      <header className="hosted-review-details-header flex min-w-0 flex-col gap-1.5">
        <div className="hosted-review-details-meta-top flex min-w-0 items-center justify-between gap-2">
          <div className="hosted-review-details-status flex min-w-0 flex-wrap items-center gap-1.5">
            <HostedReviewStatus review={review} />
            <span className="hosted-review-details-number font-mono text-2xs text-muted-foreground tabular-nums">
              #{review.number}
            </span>
            <span className="text-2xs text-muted-foreground/50" aria-hidden="true">
              ·
            </span>
            <time
              className="hosted-review-details-created-time text-2xs text-muted-foreground tabular-nums"
              dateTime={review.createdAt}
              title={`创建于 ${new Date(review.createdAt).toLocaleString()}`}
            >
              {createdRel}
            </time>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="hosted-review-details-link shrink-0"
            disabled={disabled}
            aria-label={`在网页打开 ${label} #${review.number}`}
            title={`在网页打开 ${label} #${review.number}`}
            onClick={onOpen}
          >
            <ArrowUpRight className="hosted-review-details-link-icon" aria-hidden="true" />
          </Button>
        </div>

        <h3 className="hosted-review-details-title text-sm leading-snug font-semibold wrap-anywhere select-text">
          {review.title}
        </h3>

        <p
          className="hosted-review-details-branches flex min-w-0 items-center gap-1 font-mono text-2xs text-app-muted-foreground"
          title={`${review.sourceBranch} → ${review.targetBranch}`}
        >
          <span className="hosted-review-details-source min-w-0 truncate select-text [unicode-bidi:plaintext]">
            {review.sourceBranch}
          </span>
          <ArrowRight
            className="hosted-review-details-direction size-3 shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          />
          <span className="hosted-review-details-target min-w-0 truncate text-foreground select-text [unicode-bidi:plaintext]">
            {review.targetBranch}
          </span>
        </p>
      </header>

      <section
        className="hosted-review-readiness rounded-lg border border-border bg-background px-3 py-2.5"
        aria-label={sectionTitle}
      >
        <div className="hosted-review-timeline flex flex-col gap-2.5">{renderTimelineNodes()}</div>

        {review.state === 'open' && account && (
          <div className="hosted-review-readiness-account-row mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2 text-2xs text-app-muted-foreground">
            <span className="hosted-review-readiness-account-label shrink-0">操作账号</span>
            <span className="hosted-review-readiness-account truncate font-mono">@{account}</span>
          </div>
        )}
      </section>

      {review.state !== 'merged' && (
        <footer className="hosted-review-details-actions flex items-center gap-1.5">
          {canMerge ? (
            <Button
              type="button"
              variant={checksFailed ? 'outline' : 'default'}
              className="hosted-review-details-merge min-w-0 flex-1"
              disabled={disabled || !review.head}
              aria-label={`合并 ${label} #${review.number}`}
              onClick={onMerge}
            >
              <GitMerge
                className="hosted-review-details-merge-icon"
                data-icon="inline-start"
                aria-hidden="true"
              />
              <span className="truncate tabular-nums">
                {checksFailed ? '忽略检查并合并' : `合并 ${label} #${review.number}`}
              </span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="hosted-review-details-open-primary min-w-0 flex-1"
              disabled={disabled}
              onClick={onOpen}
            >
              <span className="truncate tabular-nums">在网页查看 #{review.number}</span>
              <ArrowUpRight
                className="hosted-review-details-open-icon"
                data-icon="inline-end"
                aria-hidden="true"
              />
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            className="hosted-review-compare-button shrink-0"
            disabled={disabled || !targetRef}
            title={
              !targetRef
                ? '目标仓库的分支引用尚未获取，请先 Fetch 后再比较。'
                : '与目标分支比较差异'
            }
            onClick={onCompare}
          >
            <GitCompareArrows
              className="hosted-review-compare-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            比较
          </Button>
        </footer>
      )}
    </article>
  )
}
