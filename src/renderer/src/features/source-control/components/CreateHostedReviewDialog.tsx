import { useEffect, useRef } from 'react'
import { AlertCircle, GitPullRequest, LoaderCircle, RefreshCw, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useHostedReviewCreation } from '../hooks/use-hosted-review-creation'
import type { CreateHostedReviewDialogProps } from '../hooks/use-hosted-review-creation'
import { HostedReviewBranchFields } from './HostedReviewBranchFields'
import { HostedReviewDetailsFields } from './HostedReviewDetailsFields'
import { HostedReviewPreflight, HostedReviewStatusIndicator } from './HostedReviewPreflight'

export function CreateHostedReviewDialog(props: CreateHostedReviewDialogProps) {
  const {
    form,
    label,
    visible,
    busy,
    dirty,
    draft,
    isFork,
    unlocking,
    fieldsDisabled,
    composerDisabled,
    initializing,
    creation,
    branchRefreshing,
    branchRefreshingVisible,
    error,
    branchError,
    branchesUnavailable,
    preflight,
    preparing,
    canCreate,
    submittingVisible,
    requestClose,
    finishClose,
    refreshBranches,
    retryInitialization,
    retryPreparation,
    branchChanged,
    markTextEdited,
    submit,
    unlockCreation,
    openReview,
  } = useHostedReviewCreation(props)

  const formRef = useRef<HTMLFormElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const autoFocused = useRef(false)
  const isMac = window.desktop.platform === 'darwin'

  useEffect(() => {
    const node = formRef.current
    if (!visible || !node) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.isComposing && event.key === 'Enter' && (isMac ? event.metaKey : event.ctrlKey)) {
        event.preventDefault()
        submit()
      }
    }
    node.addEventListener('keydown', handleKeyDown)
    return () => node.removeEventListener('keydown', handleKeyDown)
  }, [visible, isMac, submit])

  useEffect(() => {
    if (!visible) {
      autoFocused.current = false
      return
    }
    if (autoFocused.current || initializing || preparing || composerDisabled) return
    const active = document.activeElement
    const userMovedFocus =
      active instanceof HTMLElement &&
      active !== document.body &&
      active.closest('[data-slot="dialog-content"]') !== null &&
      active.getAttribute('data-slot') !== 'dialog-content'
    if (!userMovedFocus) titleInputRef.current?.focus()
    autoFocused.current = true
  }, [visible, initializing, preparing, composerDisabled])

  const sourcePath = creation?.context.source?.path
  const targetPath = creation?.context.target?.path
  const repositoryLabel =
    isFork && sourcePath && targetPath ? `${sourcePath} → ${targetPath}` : targetPath

  return (
    <Dialog
      open={visible}
      disablePointerDismissal={dirty || busy}
      onOpenChange={(next, details) => {
        if (form.state.isSubmitting || unlocking) details.cancel()
        else if (!next) requestClose()
      }}
      onOpenChangeComplete={finishClose}
    >
      <DialogContent
        className="create-hosted-review-dialog flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[610px]"
        showCloseButton={false}
        initialFocus={false}
      >
        <DialogHeader className="create-hosted-review-header flex h-11 shrink-0 flex-row items-center justify-between gap-3 px-4">
          <div className="create-hosted-review-identity flex min-w-0 items-center gap-2">
            <GitPullRequest
              className="create-hosted-review-title-icon size-4 shrink-0 text-foreground"
              aria-hidden="true"
            />
            <DialogTitle className="create-hosted-review-title shrink-0 font-semibold">
              创建 {label}
            </DialogTitle>
            {repositoryLabel && (
              <>
                <span
                  className="create-hosted-review-identity-separator text-muted-foreground/40"
                  aria-hidden="true"
                >
                  /
                </span>
                <span
                  className="create-hosted-review-repository min-w-0 truncate font-mono text-xs text-app-muted-foreground [unicode-bidi:plaintext]"
                  title={repositoryLabel}
                >
                  {repositoryLabel}
                </span>
              </>
            )}
            {creation?.account && (
              <Badge
                variant="secondary"
                className="create-hosted-review-account shrink-0 font-mono text-app-muted-foreground"
              >
                @{creation.account}
              </Badge>
            )}
          </div>
          {!busy && (
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="create-hosted-review-close shrink-0"
                />
              }
            >
              <XIcon className="create-hosted-review-close-icon" aria-hidden="true" />
              <span className="sr-only">关闭</span>
            </DialogClose>
          )}
        </DialogHeader>

        <form
          ref={formRef}
          className="create-hosted-review-form flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            submit()
          }}
        >
          <section
            className="create-hosted-review-branches flex shrink-0 flex-wrap items-center gap-2 border-y border-border bg-muted/40 px-4 py-2.5 sm:flex-nowrap"
            aria-label="合并方向"
          >
            <HostedReviewBranchFields
              form={form}
              creation={creation}
              isFork={isFork}
              fieldsDisabled={fieldsDisabled}
              initializing={initializing}
              branchChanged={branchChanged}
            />
            <div className="create-hosted-review-branch-controls flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="create-hosted-review-refresh-branches shrink-0"
                aria-label="刷新远端分支"
                title="刷新远端分支"
                disabled={busy || !creation || initializing || branchRefreshing}
                aria-busy={branchRefreshing}
                onClick={() => refreshBranches()}
              >
                <RefreshCw
                  className={cn(
                    'create-hosted-review-refresh-icon',
                    branchRefreshingVisible && 'motion-safe:animate-spin',
                  )}
                  aria-hidden="true"
                />
              </Button>
              <Separator
                orientation="vertical"
                className="create-hosted-review-status-separator h-4"
              />
              <HostedReviewStatusIndicator
                creation={creation}
                preflight={preflight}
                preparing={preparing}
                initializing={initializing}
                branchesUnavailable={branchesUnavailable}
              />
            </div>
          </section>

          <HostedReviewPreflight
            creation={creation}
            preflight={preflight}
            preparing={preparing}
            initializing={initializing}
            busy={busy}
            label={label}
            branchError={branchError}
            branchesUnavailable={branchesUnavailable}
            retryPreparation={retryPreparation}
            unlockCreation={unlockCreation}
            openReview={openReview}
          />

          <div className="create-hosted-review-body flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3.5">
            <HostedReviewDetailsFields
              form={form}
              label={label}
              composerDisabled={composerDisabled}
              markTextEdited={markTextEdited}
              titleInputRef={titleInputRef}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="create-hosted-review-error flex shrink-0 items-center justify-between gap-3 border-t border-destructive/25 bg-destructive/8 px-4 py-2 text-xs text-destructive"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="create-hosted-review-error-description min-w-0 whitespace-pre-wrap wrap-anywhere">
                  {error}
                </span>
              </div>
              {!creation && !initializing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="create-hosted-review-retry-initialization shrink-0 bg-background text-foreground"
                  onClick={() => retryInitialization()}
                >
                  重新读取
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="create-hosted-review-footer flex shrink-0 flex-row items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5 sm:flex-row sm:justify-between">
            <form.Field name="draft">
              {(field) => (
                <Field
                  className="create-hosted-review-draft-field w-auto flex-row items-center gap-2"
                  data-disabled={composerDisabled}
                >
                  <Switch
                    id="review-draft"
                    size="sm"
                    className="create-hosted-review-draft-input"
                    checked={field.state.value}
                    disabled={composerDisabled}
                    onCheckedChange={field.handleChange}
                    onBlur={field.handleBlur}
                  />
                  <FieldLabel
                    htmlFor="review-draft"
                    className={cn(
                      'create-hosted-review-draft-label cursor-pointer text-xs font-medium',
                      field.state.value ? 'text-foreground' : 'text-app-muted-foreground',
                      composerDisabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    创建为草稿
                  </FieldLabel>
                </Field>
              )}
            </form.Field>

            <div className="create-hosted-review-actions flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="create-hosted-review-cancel"
                disabled={busy}
                onClick={() => requestClose()}
              >
                取消
              </Button>
              <Button
                type="submit"
                className="create-hosted-review-submit"
                aria-busy={form.state.isSubmitting}
                disabled={!canCreate}
              >
                {submittingVisible && (
                  <LoaderCircle
                    className="create-hosted-review-spinner motion-safe:animate-spin"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
                <span>{draft ? `创建草稿 ${label}` : `创建 ${label}`}</span>
                <Kbd className="create-hosted-review-submit-shortcut ml-0.5 h-4 min-w-0 bg-primary-foreground/15 px-1 text-primary-foreground/85">
                  {isMac ? '⌘↵' : 'Ctrl+↵'}
                </Kbd>
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
