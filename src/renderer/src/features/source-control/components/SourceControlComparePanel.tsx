import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, RefreshCw } from 'lucide-react'
import { unwrap } from '../../../../../shared/contracts'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import type { GitComparison, GitReferences } from '../../../../../shared/source-control'
import type { GitBranchData } from '../../../../../shared/git-branches'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { SourceControlBranchPicker } from './SourceControlBranchPicker'
import { HostedReviewCreateButton } from './HostedReviewCreateButton'
import { ComparisonCommits, ReviewFiles } from './SourceControlReview'
import { LoadingContent } from '@/components/LoadingContent'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field } from '@/components/ui/field'
import { SourceControlSectionLayout } from './SourceControlSection'

export function SourceControlComparePanel({
  workspace,
  active,
  references,
  branchTips,
  pending,
  onFetch,
  onCreateBranch,
}: {
  workspace: ProjectWorkspace
  active: boolean
  references?: GitReferences
  branchTips?: GitBranchData['branches']
  pending: boolean
  onFetch: (remote: string) => Promise<boolean>
  onCreateBranch: (name: string, head: string) => Promise<boolean>
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const [result, setResult] = useState<{ key: string; comparison: GitComparison }>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const loadedKey = useRef<string | undefined>(undefined)
  const [fetchAttempt, setFetchAttempt] = useState(0)
  const [remoteFetch, setRemoteFetch] = useState<{ scope: string; key: string; error?: string }>()
  const fetchTask = useRef<{ key: string; promise: Promise<boolean> } | undefined>(undefined)
  const fetchRemote = useEffectEvent(onFetch)
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const head = session.status?.head
  const branches = references?.branches || []
  const baseRef =
    session.baseRef ??
    (references?.defaultBranchRef ||
      branches.find((entry) => entry.ref === 'refs/remotes/origin/main')?.ref ||
      branches.find((entry) => entry.ref === 'refs/heads/main')?.ref ||
      branches.find((entry) => entry.ref !== `refs/heads/${session.status?.branch}`)?.ref ||
      '')
  const basePrefix = [
    'refs/heads/',
    ...(references?.remotes || [])
      .map((remote) => `refs/remotes/${remote}/`)
      .sort((a, b) => b.length - a.length),
  ].find((prefix) => baseRef.startsWith(prefix))
  const defaultTargetBranch = basePrefix ? baseRef.slice(basePrefix.length) : undefined
  const remote = basePrefix?.startsWith('refs/remotes/')
    ? basePrefix.slice('refs/remotes/'.length, -1)
    : undefined
  const branchesReady = !!branchTips
  const hasHead = !!head
  const baseTip = branchTips?.find((branch) => branch.ref === baseRef)?.oid
  const fetchScope = JSON.stringify([target, baseRef])
  const fetchKey = JSON.stringify([fetchScope, fetchAttempt])
  const fetching = !!remote && hasHead && remoteFetch?.key !== fetchKey
  const fetchError = remoteFetch?.scope === fetchScope ? remoteFetch.error : undefined
  const viewKey = JSON.stringify([baseRef, head])
  const comparisonKey = JSON.stringify([baseRef, baseTip, head, fetchAttempt])
  const comparison = result?.key === viewKey ? result.comparison : undefined

  useEffect(() => {
    if (!active || !remote || !hasHead || !branchesReady) return
    if (fetchTask.current?.key !== fetchKey) {
      if (pending) return
      // Reuse the in-flight request when Fetch itself changes the parent's pending state.
      fetchTask.current = { key: fetchKey, promise: fetchRemote(remote) }
    }
    let disposed = false
    void fetchTask.current.promise
      .then((done) => {
        if (!done) throw new Error('暂未执行 Fetch，请重试。')
        if (!disposed) setRemoteFetch({ scope: fetchScope, key: fetchKey })
      })
      .catch((cause) => {
        if (!disposed)
          setRemoteFetch({
            scope: fetchScope,
            key: fetchKey,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      })
    return () => {
      disposed = true
    }
  }, [active, remote, hasHead, branchesReady, pending, fetchScope, fetchKey])

  useEffect(() => {
    if (!active || fetching || loadedKey.current === comparisonKey) return
    // Only commit identities or an explicit retry invalidate a comparison, not status polling.
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(Boolean(baseRef && head && branchesReady))
    if (!baseRef || !head || !branchesReady) return
    let disposed = false
    window.desktop
      .gitCompare(target, { kind: 'branch', ref: baseRef })
      .then(unwrap)
      .then((next) => {
        if (!disposed) {
          loadedKey.current = comparisonKey
          setResult({ key: viewKey, comparison: next })
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, fetching, baseRef, branchesReady, head, comparisonKey, viewKey, target])

  return (
    <section
      className="source-control-compare-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="比较"
      aria-busy={fetching || loading}
    >
      <div className="source-control-comparison-refs flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1.5">
        <Field className="source-control-base-field w-auto min-w-0 flex-row items-center gap-1">
          <ArrowRight
            className="source-control-comparison-direction size-3 shrink-0 text-app-muted-foreground"
            aria-hidden="true"
          />
          <SourceControlBranchPicker
            mode="compare"
            status={session.status}
            references={references}
            value={baseRef}
            pending={pending}
            onSelect={(ref) => useSourceControl.getState().update(workspace.id, { baseRef: ref })}
            onCreate={(name) => {
              if (!head) return Promise.resolve(false)
              // Freeze even an empty baseline so refreshing refs cannot select the new branch implicitly.
              useSourceControl.getState().update(workspace.id, { baseRef })
              return onCreateBranch(name, head)
            }}
          />
          {remote && fetchError && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="source-control-compare-fetch-retry"
              disabled={!active || pending || fetching}
              aria-label={fetching ? '正在重新获取远端分支' : '重新获取远端分支并比较'}
              aria-busy={fetching}
              title="重新获取远端分支并比较，不修改工作文件"
              onClick={() => setFetchAttempt((attempt) => attempt + 1)}
            >
              <RefreshCw className="source-control-compare-fetch-retry-icon" aria-hidden="true" />
            </Button>
          )}
        </Field>
        <HostedReviewCreateButton
          key={JSON.stringify([workspace.projectPath, workspace.id])}
          workspace={workspace}
          pending={pending || !active}
          defaults={{ targetBranch: defaultTargetBranch }}
        />
      </div>
      <SourceControlSectionLayout
        resizeLabel="调整分支对比与 Commit 对比区域高度"
        section={(open, onOpenChange) =>
          comparison && (
            <ComparisonCommits
              key={`${workspace.id}:${baseRef}:${comparison.base}:${comparison.head}`}
              workspace={workspace}
              active={active}
              comparison={comparison}
              open={open}
              onOpenChange={onOpenChange}
            />
          )
        }
      >
        <div className="source-control-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain px-2 py-3">
          {fetching && comparison && (
            <output className="source-control-compare-fetch-status text-xs text-app-muted-foreground">
              正在获取远端分支，当前显示上次比较结果。
            </output>
          )}
          {remote && fetchError && (
            <Alert variant="destructive" className="source-control-compare-fetch-error">
              <AlertDescription className="source-control-compare-fetch-error-detail whitespace-pre-wrap break-words select-text">
                获取远端分支失败，比较将使用本地缓存，可能不是最新结果。请点击分支右侧的刷新按钮重试。
                {'\n'}
                {fetchError}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="source-control-review-error">
              <AlertDescription className="source-control-review-error-detail whitespace-pre-wrap break-words select-text">
                {error}
              </AlertDescription>
            </Alert>
          )}
          <LoadingContent
            pending={(fetching || loading) && !comparison && hasHead}
            label={fetching ? '正在获取远端分支' : '正在加载比较'}
          >
            {!head && (
              <p className="source-control-compare-unborn p-2 text-xs text-app-muted-foreground">
                当前分支还没有提交，暂不能比较。
              </p>
            )}
            {comparison && (
              <>
                {!comparison.entries.length && (
                  <Empty className="source-control-comparison-empty">
                    <EmptyHeader className="source-control-comparison-empty-header">
                      <EmptyMedia variant="icon" className="source-control-comparison-empty-media">
                        <Check
                          className="source-control-comparison-empty-icon"
                          aria-hidden="true"
                        />
                      </EmptyMedia>
                      <EmptyTitle className="source-control-comparison-empty-title">
                        无文件差异
                      </EmptyTitle>
                      <EmptyDescription className="source-control-comparison-empty-description">
                        当前分支与比较目标之间没有文件差异。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                <ReviewFiles workspaceId={workspace.id} comparison={comparison} />
              </>
            )}
          </LoadingContent>
        </div>
      </SourceControlSectionLayout>
    </section>
  )
}
