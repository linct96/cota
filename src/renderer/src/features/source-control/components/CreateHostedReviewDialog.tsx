import { LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { useHostedReviewCreation } from '../hooks/use-hosted-review-creation'
import type { CreateHostedReviewDialogProps } from '../hooks/use-hosted-review-creation'
import { HostedReviewBranchFields } from './HostedReviewBranchFields'
import { HostedReviewDetailsFields } from './HostedReviewDetailsFields'
import { HostedReviewPreflight } from './HostedReviewPreflight'

export function CreateHostedReviewDialog(props: CreateHostedReviewDialogProps) {
  const {
    form,
    label,
    visible,
    busy,
    unlocking,
    fieldsDisabled,
    initializing,
    creation,
    branchRefreshing,
    branchRefreshingVisible,
    error,
    branchError,
    sourceBranch,
    targetBranch,
    branchesAvailable,
    preflight,
    preparing,
    canSubmit,
    submittingVisible,
    requestClose,
    finishClose,
    refreshBranches,
    retryInitialization,
    retryPreparation,
    branchChanged,
    markTextEdited,
    unlockCreation,
    openReview,
  } = useHostedReviewCreation(props)
  return (
    <Dialog
      open={visible}
      onOpenChange={(next, details) => {
        if (form.state.isSubmitting || unlocking) details.cancel()
        else if (!next) requestClose()
      }}
      onOpenChangeComplete={finishClose}
    >
      <DialogContent
        className="create-hosted-review-dialog flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={!busy}
        initialFocus={false}
      >
        <DialogHeader className="create-hosted-review-header shrink-0 px-5 pt-5 pb-4 pr-10">
          <DialogTitle className="create-hosted-review-title">创建 {label}</DialogTitle>
        </DialogHeader>
        <form
          className="create-hosted-review-form flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (
              fieldsDisabled ||
              !branchesAvailable ||
              initializing ||
              preparing ||
              preflight?.result?.status !== 'ready'
            )
              return
            void form.handleSubmit()
          }}
        >
          <div className="create-hosted-review-body flex min-h-0 flex-col gap-5 overflow-y-auto px-5 pb-5">
            <section
              className="create-hosted-review-branches flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
              aria-label="合并方向"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="create-hosted-review-refresh-branches self-end"
                disabled={busy || !creation || initializing || branchRefreshing}
                aria-busy={branchRefreshing}
                onClick={() => refreshBranches()}
              >
                {branchRefreshingVisible && (
                  <LoaderCircle
                    className="create-hosted-review-refresh-spinner motion-safe:animate-spin"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
                刷新远端分支
              </Button>
              <FieldGroup className="create-hosted-review-branch-fields grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HostedReviewBranchFields
                  form={form}
                  creation={creation}
                  fieldsDisabled={fieldsDisabled}
                  initializing={initializing}
                  branchChanged={branchChanged}
                />
              </FieldGroup>
              <HostedReviewPreflight
                preflight={preflight}
                preparing={preparing}
                initializing={initializing}
                busy={busy}
                label={label}
                retryPreparation={retryPreparation}
                unlockCreation={unlockCreation}
                openReview={openReview}
              />
              {(branchError ||
                (creation && sourceBranch && targetBranch && !branchesAvailable)) && (
                <Alert variant="destructive" className="create-hosted-review-branches-error">
                  <AlertDescription className="create-hosted-review-branches-error-description">
                    {branchError ||
                      '所选分支已不在远端分支列表中，请重新选择或刷新；已保留表单输入。'}
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <FieldGroup className="create-hosted-review-details-fields">
              <HostedReviewDetailsFields
                form={form}
                fieldsDisabled={fieldsDisabled}
                markTextEdited={markTextEdited}
              />
            </FieldGroup>
          </div>
          <DialogFooter className="create-hosted-review-footer shrink-0 flex-col border-t px-5 py-3 sm:flex-col">
            {error && (
              <Alert variant="destructive" className="create-hosted-review-error">
                <AlertDescription className="create-hosted-review-error-description">
                  {error}
                  {!creation && !initializing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="create-hosted-review-retry-initialization self-start"
                      onClick={() => retryInitialization()}
                    >
                      重新读取
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <div className="create-hosted-review-actions flex justify-end gap-2">
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
                disabled={
                  !canSubmit ||
                  fieldsDisabled ||
                  !branchesAvailable ||
                  initializing ||
                  preparing ||
                  preflight?.result?.status !== 'ready'
                }
              >
                {submittingVisible && (
                  <LoaderCircle
                    className="create-hosted-review-spinner motion-safe:animate-spin"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
                创建 {label}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
