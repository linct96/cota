import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap, type Result, type WorkspaceTarget } from '../../../shared/contracts'
import {
  createHostedReviewSchema,
  prepareHostedReviewSchema,
  hostingBranchesExpired,
  type CreateHostedReview,
  type HostedReview,
  type HostedReviewCreationContext,
  type HostedReviewPreparation,
} from '../../../shared/code-hosting'
import { useSourceControl } from '../lib/source-control-store'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { cn } from '../lib/utils'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { BranchPicker } from './BranchPicker'
import { Textarea } from './ui/textarea'

export function CreateHostedReviewDialog({
  target,
  open,
  defaults: openingDefaults,
  onOpenChange,
  onCreated,
}: {
  target: WorkspaceTarget
  open: boolean
  defaults?: Partial<
    Pick<CreateHostedReview, 'sourceBranch' | 'targetBranch' | 'title' | 'description' | 'draft'>
  >
  onOpenChange: (open: boolean) => void
  onCreated: (review: HostedReview) => void
}) {
  const [defaults] = useState(openingDefaults)
  const [creation, setCreation] = useState<HostedReviewCreationContext>()
  const [initializing, setInitializing] = useState(true)
  const [branchRevision, setBranchRevision] = useState(0)
  const [branchRefreshing, setBranchRefreshing] = useState(false)
  const [branchError, setBranchError] = useState<string>()
  const branchRefreshingVisible = useLoadingIndicator(branchRefreshing)
  const creationKey = creation?.context.key
  const creationAccount = creation?.account
  const [initializationRevision, setInitializationRevision] = useState(0)
  const provider = useSourceControl(
    (state) => state.sessions[target.workspaceId]?.hosting?.context?.source?.provider,
  )
  const label = provider ? (provider === 'gitlab' ? 'MR' : 'PR') : 'PR/MR'
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [unlocking, setUnlocking] = useState(false)
  const mounted = useRef(true)
  const branchAccessInvalidated = useRef(false)
  const titleEdited = useRef(!!defaults?.title)
  const descriptionEdited = useRef(!!defaults?.description)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const form = useForm({
    defaultValues: {
      key: '',
      account: '',
      sourceBranch: '',
      targetBranch: '',
      title: defaults?.title ?? '',
      description: defaults?.description ?? '',
      draft: defaults?.draft ?? false,
    },
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: createHostedReviewSchema },
    onSubmit: async ({ value }) => {
      if (
        unlocking ||
        !creation ||
        !creation.sourceBranches.some((branch) => branch.name === value.sourceBranch) ||
        !creation.targetBranches.some((branch) => branch.name === value.targetBranch)
      )
        return
      setError(undefined)
      try {
        const response = await window.desktop.codeHosting.create(target, {
          ...value,
          sourceBranch: value.sourceBranch.trim(),
          targetBranch: value.targetBranch.trim(),
          title: value.title.trim(),
        })
        if (!mounted.current) return
        invalidateUnavailableBranches(response)
        const review = unwrap(response)
        onCreated(review)
        toast.success(`${label} #${review.number} 已就绪`)
      } catch (cause) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : '创建失败，输入已保留，请核对后重试。')
          setPreparation(undefined)
          setRevision((value) => value + 1)
        }
      }
    },
  })
  const submitting = useStore(form.store, (state) => state.isSubmitting)
  const canSubmit = useStore(form.store, (state) => state.canSubmit)
  const submittingVisible = useLoadingIndicator(submitting)
  const busy = submitting || unlocking
  const fieldsDisabled = busy || !creation
  const sourceBranch = useStore(form.store, (state) => state.values.sourceBranch)
  const targetBranch = useStore(form.store, (state) => state.values.targetBranch)
  const branchKey = JSON.stringify([sourceBranch, targetBranch])
  const branchesAvailable =
    !!creation &&
    creation.sourceBranches.some((branch) => branch.name === sourceBranch) &&
    creation.targetBranches.some((branch) => branch.name === targetBranch)
  const [preparation, setPreparation] = useState<{
    key: string
    result?: HostedReviewPreparation
    error?: string
  }>()
  const [preparingKey, setPreparingKey] = useState<string>()
  const preflight = preparation?.key === branchKey ? preparation : undefined
  const preparing =
    open &&
    !!creation &&
    !!sourceBranch &&
    !!targetBranch &&
    (!preflight || preparingKey === branchKey)

  function invalidateUnavailableBranches(response: Result<unknown>) {
    if (
      !response.ok &&
      ((response.hostingFailure &&
        ['auth', 'forbidden', 'not-found'].includes(response.hostingFailure)) ||
        (response.code &&
          ['INVALID_INPUT', 'NOT_GIT_REPO', 'REPOSITORY_UNAVAILABLE'].includes(response.code)))
    ) {
      branchAccessInvalidated.current = true
      setCreation(
        (current) =>
          current && { ...current, sourceBranches: [], targetBranches: [], branchesStale: true },
      )
      setPreparation(undefined)
    }
  }

  useEffect(() => {
    if (!open) return
    let disposed = false
    // oxlint-disable-next-line react/set-state-in-effect
    setInitializing(true)
    setCreation(undefined)
    setBranchRevision(0)
    branchAccessInvalidated.current = false
    setBranchError(undefined)
    setBranchRefreshing(false)
    setPreparation(undefined)
    setPreparingKey(undefined)
    setError(undefined)
    titleEdited.current = !!defaults?.title
    descriptionEdited.current = !!defaults?.description
    form.reset()
    window.desktop.codeHosting
      .creationContext(target)
      .then(unwrap)
      .then((next) => {
        if (disposed) return
        const preferredSource = defaults?.sourceBranch ?? next.context.sourceBranch ?? ''
        const preferredTarget = defaults?.targetBranch ?? next.defaultBranch
        form.reset(
          {
            key: next.context.key,
            account: next.account,
            sourceBranch: next.sourceBranches.some((branch) => branch.name === preferredSource)
              ? preferredSource
              : '',
            targetBranch: next.targetBranches.some((branch) => branch.name === preferredTarget)
              ? preferredTarget
              : '',
            title: defaults?.title ?? '',
            description: defaults?.description ?? '',
            draft: defaults?.draft ?? false,
          },
          { keepDefaultValues: true },
        )
        setCreation(next)
        if (next.branchesStale || hostingBranchesExpired(next.branchesFetchedAt))
          setBranchRevision((value) => value + 1)
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : '远端分支读取失败，请重试。')
      })
      .finally(() => {
        if (!disposed) setInitializing(false)
      })
    return () => {
      disposed = true
    }
  }, [open, target, initializationRevision, defaults, form])
  useEffect(() => {
    if (!open || !creationKey || !creationAccount || !branchRevision || document.hidden) return
    let disposed = false
    setBranchRefreshing(true)
    setBranchError(undefined)
    window.desktop.codeHosting
      .refreshBranches(target, { key: creationKey, account: creationAccount })
      .then((response) => {
        if (disposed) return
        invalidateUnavailableBranches(response)
        const lists = unwrap(response)
        setCreation((current) => current && { ...current, ...lists })
        if (branchAccessInvalidated.current) {
          branchAccessInvalidated.current = false
          titleEdited.current = true
          descriptionEdited.current = true
          setRevision((value) => value + 1)
        }
      })
      .catch((cause) => {
        if (!disposed)
          setBranchError(
            cause instanceof Error ? cause.message : '分支刷新失败，保留上次列表，请重试。',
          )
      })
      .finally(() => {
        if (!disposed) setBranchRefreshing(false)
      })
    return () => {
      disposed = true
    }
  }, [open, target, creationKey, creationAccount, branchRevision])

  const branchesStale = !!creation?.branchesStale
  const branchesFetchedAt = creation?.branchesFetchedAt
  useEffect(() => {
    if (!open || !creationKey || branchesFetchedAt === undefined) return
    const resume = () => {
      if (
        !document.hidden &&
        !branchRefreshing &&
        (branchesStale || hostingBranchesExpired(branchesFetchedAt))
      )
        setBranchRevision((value) => value + 1)
    }
    document.addEventListener('visibilitychange', resume)
    return () => document.removeEventListener('visibilitychange', resume)
  }, [open, creationKey, branchesStale, branchesFetchedAt, branchRefreshing])

  useEffect(() => {
    if (!open || !creationKey || !creationAccount) return
    let disposed = false
    const input = prepareHostedReviewSchema.safeParse({
      key: creationKey,
      account: creationAccount,
      sourceBranch,
      targetBranch,
    })
    if (!input.success) return
    const prepare = async () => {
      setPreparingKey(branchKey)
      try {
        const response = await window.desktop.codeHosting.prepare(target, input.data)
        if (!disposed) {
          invalidateUnavailableBranches(response)
          const result = unwrap(response)
          setPreparation({ key: branchKey, result })
          if (result.defaultTitle && !titleEdited.current && !form.state.isSubmitting)
            form.setFieldValue('title', result.defaultTitle)
          if (
            result.defaultDescription !== undefined &&
            !descriptionEdited.current &&
            !form.state.isSubmitting
          )
            form.setFieldValue('description', result.defaultDescription)
        }
      } catch (cause) {
        if (!disposed)
          setPreparation({
            key: branchKey,
            error: cause instanceof Error ? cause.message : '创建预检失败，请重试。',
          })
      } finally {
        if (!disposed) setPreparingKey(undefined)
      }
    }
    void prepare()
    return () => {
      disposed = true
    }
  }, [
    open,
    target,
    creationKey,
    creationAccount,
    sourceBranch,
    targetBranch,
    branchKey,
    revision,
    form,
  ])
  async function unlockCreation() {
    if (busy || !creation) return
    setUnlocking(true)
    try {
      unwrap(
        await window.desktop.codeHosting.clearCreation(target, creation.context.key, sourceBranch),
      )
      if (mounted.current) {
        setPreparation(undefined)
        setRevision((value) => value + 1)
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '解除保护失败，请重试。')
    } finally {
      if (mounted.current) setUnlocking(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (form.state.isSubmitting || unlocking) details.cancel()
        else {
          setError(undefined)
          onOpenChange(next)
        }
      }}
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
            onClick={() => setBranchRevision((value) => value + 1)}
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
            {(['sourceBranch', 'targetBranch'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  const branches =
                    (name === 'sourceBranch'
                      ? creation?.sourceBranches
                      : creation?.targetBranches) || []
                  const fieldLabel = name === 'sourceBranch' ? '源分支（远端）' : '目标分支（远端）'
                  const repository =
                    name === 'sourceBranch' ? creation?.context.source : creation?.context.target
                  const remote = creation?.context.remotes.find(
                    ({ repository: candidate }) =>
                      candidate &&
                      repository &&
                      candidate.provider === repository.provider &&
                      candidate.host === repository.host &&
                      candidate.path === repository.path,
                  )?.name
                  const options = branches.map((branch) => ({
                    value: branch.name,
                    label: remote ? `${remote}/${branch.name}` : branch.name,
                    date: branch.date,
                  }))
                  return (
                    <Field
                      className={`create-hosted-review-${name}-field`}
                      data-invalid={invalid}
                      data-disabled={fieldsDisabled}
                    >
                      <FieldLabel
                        htmlFor={`review-${name}`}
                        className={`create-hosted-review-${name}-label`}
                      >
                        {fieldLabel}
                      </FieldLabel>
                      <BranchPicker
                        variant="default"
                        filterOptions={{ branchType: false, sortByDate: true }}
                        name={field.name}
                        required
                        items={[{ label: '远端分支', type: 'remote', items: options }]}
                        value={options.find((branch) => branch.value === field.state.value) ?? null}
                        placeholder={initializing ? '正在拉取远端分支...' : '请选择远端分支'}
                        disabled={fieldsDisabled || !branches.length}
                        className={`create-hosted-review-${name}-trigger`}
                        triggerProps={{
                          id: `review-${name}`,
                          onBlur: field.handleBlur,
                          'aria-label': fieldLabel,
                          'aria-invalid': invalid,
                          'aria-describedby': `review-${name}-${invalid ? 'error' : 'description'}`,
                        }}
                        onValueChange={(branch) => {
                          if (branch === null || branch.value === field.state.value) return
                          field.handleChange(branch.value)
                          setPreparation(undefined)
                          setPreparingKey(undefined)
                          if (!titleEdited.current) form.setFieldValue('title', '')
                          if (!descriptionEdited.current) form.setFieldValue('description', '')
                        }}
                      />
                      <div className={`create-hosted-review-${name}-feedback grid`}>
                        <FieldDescription
                          id={`review-${name}-description`}
                          className={cn(
                            `create-hosted-review-${name}-description col-start-1 row-start-1`,
                            invalid && 'invisible',
                          )}
                          aria-hidden={invalid}
                        >
                          {!creation && !initializing
                            ? '远端分支读取失败，请重试。'
                            : creation && !branches.length
                              ? '暂无远端分支，请先推送后重新打开。'
                              : name === 'sourceBranch'
                                ? '选择要合并的远端分支。'
                                : '选择接收改动的远端分支。'}
                        </FieldDescription>
                        {invalid && (
                          <FieldError
                            id={`review-${name}-error`}
                            className={`create-hosted-review-${name}-error col-start-1 row-start-1`}
                            errors={field.state.meta.errors}
                          />
                        )}
                      </div>
                    </Field>
                  )
                }}
              </form.Field>
            ))}
            {(['title', 'description'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  const props = {
                    id: `review-${name}`,
                    name: field.name,
                    value: field.state.value,
                    disabled: fieldsDisabled,
                    required: name === 'title',
                    onBlur: field.handleBlur,
                    onChange: (
                      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                    ) => {
                      if (name === 'title') titleEdited.current = true
                      else descriptionEdited.current = true
                      field.handleChange(event.target.value)
                    },
                    'aria-invalid': invalid,
                    'aria-describedby': `review-${name}-description${invalid ? ` review-${name}-error` : ''}`,
                  }
                  return (
                    <Field
                      className={`create-hosted-review-${name}-field sm:col-span-2`}
                      data-invalid={invalid}
                      data-disabled={fieldsDisabled}
                    >
                      <FieldLabel
                        htmlFor={props.id}
                        className={`create-hosted-review-${name}-label`}
                      >
                        {name === 'title' ? '标题' : '描述'}
                      </FieldLabel>
                      {name === 'description' ? (
                        <Textarea
                          {...props}
                          className="create-hosted-review-description-input h-28 field-sizing-fixed"
                          maxLength={65000}
                        />
                      ) : (
                        <Input
                          {...props}
                          className="create-hosted-review-title-input"
                          maxLength={240}
                        />
                      )}
                      <FieldDescription
                        id={`review-${name}-description`}
                        className={`create-hosted-review-${name}-description`}
                      >
                        {name === 'title' ? '简要说明本次改动。' : '可选，支持 Markdown。'}
                      </FieldDescription>
                      {invalid && (
                        <FieldError
                          id={`review-${name}-error`}
                          className={`create-hosted-review-${name}-error`}
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            ))}
            <form.Field name="draft">
              {(field) => (
                <Field
                  className="create-hosted-review-draft-field flex-row items-center sm:col-span-2"
                  data-disabled={fieldsDisabled}
                >
                  <Checkbox
                    id="review-draft"
                    className="create-hosted-review-draft-input"
                    checked={field.state.value}
                    disabled={fieldsDisabled}
                    onCheckedChange={field.handleChange}
                    onBlur={field.handleBlur}
                  />
                  <FieldLabel htmlFor="review-draft" className="create-hosted-review-draft-label">
                    创建为草稿
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
          </FieldGroup>
          <div
            className={cn(
              'create-hosted-review-preflight flex min-h-5 flex-col gap-2',
              (initializing || preparing) && 'invisible',
            )}
            aria-live="polite"
            inert={initializing || preparing}
          >
            {preflight?.result?.message && (
              <p
                className={cn(
                  'create-hosted-review-preflight-message text-xs',
                  preflight.result.status === 'blocked'
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {preflight.result.message}
              </p>
            )}
            {preflight?.error && (
              <p className="create-hosted-review-preflight-error text-xs text-destructive">
                {preflight.error}
              </p>
            )}
            {(preflight?.error || preflight?.result?.status === 'unknown') && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="create-hosted-review-retry self-start"
                disabled={busy || preparing}
                onClick={() => {
                  setPreparation(undefined)
                  setRevision((value) => value + 1)
                }}
              >
                重新检查
              </Button>
            )}
            {preflight?.result?.creationBlocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="create-hosted-review-unlock self-start"
                disabled={busy}
                onClick={() => void unlockCreation()}
              >
                已在网页核对，解除保护…
              </Button>
            )}
            {preflight?.result?.existingReviews.map((review) => (
              <Button
                key={review.number}
                type="button"
                variant="outline"
                size="sm"
                className="create-hosted-review-existing min-w-0 justify-between"
                disabled={busy}
                onClick={async () => {
                  try {
                    unwrap(
                      await window.desktop.codeHosting.open(target, review.number, sourceBranch),
                    )
                  } catch (cause) {
                    if (mounted.current)
                      setError(cause instanceof Error ? cause.message : '打开评审失败，请刷新。')
                  }
                }}
              >
                <span className="create-hosted-review-existing-title truncate">
                  打开 {label} #{review.number} · {review.title}
                </span>
                <ExternalLink className="create-hosted-review-existing-icon shrink-0" />
              </Button>
            ))}
          </div>
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
                    onClick={() => setInitializationRevision((value) => value + 1)}
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
              onClick={() => onOpenChange(false)}
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
