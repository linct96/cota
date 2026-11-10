import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { toast } from 'sonner'
import { unwrap } from '../../../../../shared/contracts'
import type { Result, WorkspaceTarget } from '../../../../../shared/contracts'
import {
  createHostedReviewSchema,
  hostingBranchesExpired,
  prepareHostedReviewSchema,
} from '../../../../../shared/code-hosting'
import type {
  CreateHostedReview,
  HostedReview,
  HostedReviewCreationContext,
  HostedReviewPreparation,
} from '../../../../../shared/code-hosting'
import { useSourceControl } from '@/state/source-control-store'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'

export interface CreateHostedReviewDialogProps {
  target: WorkspaceTarget
  open: boolean
  defaults?: Partial<
    Pick<CreateHostedReview, 'sourceBranch' | 'targetBranch' | 'title' | 'description' | 'draft'>
  >
  onOpenChange: (open: boolean) => void
  onCreated: (review: HostedReview) => void
}

export function useHostedReviewCreation({
  target,
  open,
  defaults: openingDefaults,
  onOpenChange,
  onCreated,
}: CreateHostedReviewDialogProps) {
  const [defaults] = useState(openingDefaults)
  const [closing, setClosing] = useState(false)
  const created = useRef<HostedReview | undefined>(undefined)
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
        !open ||
        closing ||
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
        created.current = review
        setClosing(true)
      } catch (cause) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : '创建失败，输入已保留，请核对后重试。')
          setPreparation(undefined)
          setRevision((inputValue) => inputValue + 1)
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
    // Synchronize the loading indicator with this external branch request.
    // oxlint-disable-next-line react/set-state-in-effect
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
  function requestClose() {
    setClosing(true)
  }
  function finishClose(next: boolean) {
    if (next) return
    const review = created.current
    created.current = undefined
    setError(undefined)
    setClosing(false)
    if (review) {
      onCreated(review)
      toast.success(`${label} #${review.number} 已就绪`)
    } else onOpenChange(false)
  }
  function refreshBranches() {
    setBranchRevision((value) => value + 1)
  }
  function retryInitialization() {
    setInitializationRevision((value) => value + 1)
  }
  function retryPreparation() {
    setPreparation(undefined)
    setRevision((value) => value + 1)
  }
  function branchChanged() {
    setPreparation(undefined)
    setPreparingKey(undefined)
    if (!titleEdited.current) form.setFieldValue('title', '')
    if (!descriptionEdited.current) form.setFieldValue('description', '')
  }
  function markTextEdited(name: 'title' | 'description') {
    if (name === 'title') titleEdited.current = true
    else descriptionEdited.current = true
  }
  async function openReview(number: number) {
    try {
      unwrap(await window.desktop.codeHosting.open(target, number, sourceBranch))
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '打开评审失败，请刷新。')
    }
  }
  return {
    form,
    label,
    visible: open && !closing,
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
  }
}
export type HostedReviewCreation = ReturnType<typeof useHostedReviewCreation>
