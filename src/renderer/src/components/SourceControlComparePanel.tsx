import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { unwrap, type ProjectWorkspace } from '../../../shared/contracts'
import type { GitComparison, GitReferences } from '../../../shared/source-control'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '../lib/source-control-store'
import { SourceControlBranchPicker } from './SourceControlBranchPicker'
import { HostedReviewCreateButton } from './HostedReviewPanel'
import { ComparisonCommits, ReviewFiles } from './SourceControlReview'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from './ui/empty'
import { Field } from './ui/field'
import { SourceControlSectionLayout } from './SourceControlSection'

export function SourceControlComparePanel({
  workspace,
  active,
  references,
  pending,
  onCreateBranch,
}: {
  workspace: ProjectWorkspace
  active: boolean
  references?: GitReferences
  pending: boolean
  onCreateBranch: (name: string, head: string) => Promise<boolean>
}) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const [result, setResult] = useState<{ key: string; comparison: GitComparison }>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
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
  const comparisonKey = `branch:${baseRef}:${head}`
  const comparison = !error && result?.key === comparisonKey ? result.comparison : undefined
  const comparisonRefresh = session.refreshed

  useEffect(() => {
    if (!active) return
    // Clear the previous IPC request's loading/error state before starting this comparison.
    // oxlint-disable-next-line react/set-state-in-effect
    setError(undefined)
    setLoading(false)
    if (!baseRef || !head) return
    let disposed = false
    setLoading(true)
    window.desktop
      .gitCompare(target, { kind: 'branch', ref: baseRef })
      .then(unwrap)
      .then((next) => {
        if (!disposed) setResult({ key: comparisonKey, comparison: next })
      })
      .catch((error) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, baseRef, head, comparisonRefresh, comparisonKey, target])

  return (
    <section
      className="source-control-compare-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="比较"
      aria-busy={loading}
    >
      <div className="source-control-comparison-refs flex min-w-0 shrink-0 items-center gap-2 px-2 py-1.5">
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
          comparison &&
          active && (
            <ComparisonCommits
              key={`${workspace.id}:${baseRef}:${comparison.base}:${comparison.head}`}
              workspace={workspace}
              comparison={comparison}
              open={open}
              onOpenChange={onOpenChange}
            />
          )
        }
      >
        <div className="source-control-review-body flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain px-2 py-3">
          {error && (
            <Alert variant="destructive" className="source-control-review-error">
              <AlertDescription className="source-control-review-error-detail whitespace-pre-wrap break-words select-text">
                {error}
              </AlertDescription>
            </Alert>
          )}
          <LoadingContent pending={loading} label="正在加载比较">
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
