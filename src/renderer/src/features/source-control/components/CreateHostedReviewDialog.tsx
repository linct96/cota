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
import {
  useHostedReviewCreation,
  type CreateHostedReviewDialogProps,
} from '../hooks/use-hosted-review-creation'
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
        className="create-hosted-review-dialog max-h-[85vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!busy}
        initialFocus={false}
      >
        <DialogHeader className="create-hosted-review-header">
          <DialogTitle className="create-hosted-review-title">创建 {label}</DialogTitle>
        </DialogHeader>
        <form
          className="create-hosted-review-form flex flex-col gap-4"
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="create-hosted-review-refresh-branches self-end"
            disabled={busy || !creation || branchRefreshing}
            onClick={() => refreshBranches()}
          >
            {branchRefreshingVisible && (
              <LoaderCircle
                className="create-hosted-review-refresh-spinner motion-safe:animate-spin"
                data-icon="inline-start"
              />
            )}
            刷新远端分支
          </Button>
          <FieldGroup className="create-hosted-review-fields grid grid-cols-1 sm:grid-cols-2">
            <HostedReviewBranchFields
              form={form}
              creation={creation}
              fieldsDisabled={fieldsDisabled}
              initializing={initializing}
              branchChanged={branchChanged}
            />
            <HostedReviewDetailsFields
              form={form}
              fieldsDisabled={fieldsDisabled}
              markTextEdited={markTextEdited}
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
          {(branchError || (creation && sourceBranch && targetBranch && !branchesAvailable)) && (
            <Alert variant="destructive" className="create-hosted-review-branches-error">
              <AlertDescription className="create-hosted-review-branches-error-description">
                {branchError || '所选分支已不在远端分支列表中，请重新选择或刷新；已保留表单输入。'}
              </AlertDescription>
            </Alert>
          )}
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
          <DialogFooter className="create-hosted-review-footer">
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
                  aria-hidden="true"
                />
              )}
              创建 {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
