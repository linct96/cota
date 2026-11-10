import { useEffect, useMemo, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronUp,
  GitCommitHorizontal,
  GitMerge,
  LoaderCircle,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react'
import { EMPTY_SOURCE_CONTROL, useSourceControl } from '@/state/source-control-store'
import { commitMessageFormSchema } from '@/features/source-control/lib/form-schemas'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import type { SourceControlChangesPanelProps } from './source-control-changes-types'

// 渲染提交表单，并在提交时校验输入。
export function SourceControlCommitForm({
  workspace,
  pending,
  generation,
  writing,
  mutate,
  onError: setError,
  selectedRemote,
}: Pick<
  SourceControlChangesPanelProps,
  'workspace' | 'pending' | 'generation' | 'writing' | 'mutate' | 'onError'
> & { selectedRemote: string }) {
  const session = useSourceControl((state) => state.sessions[workspace.id] || EMPTY_SOURCE_CONTROL)
  const update = useSourceControl((state) => state.update)
  const status = session.status
  const [messageExpandedOverride, setMessageExpanded] = useState<boolean>()
  const messageExpanded = messageExpandedOverride ?? !!status?.merge
  const mounted = useRef(true)
  const isMounted = () => mounted.current
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const form = useForm({
    defaultValues: { message: session.draft },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: commitMessageFormSchema },
    onSubmitMeta: { push: false },
    onSubmit: async ({ value, meta }) => {
      if (
        !value.message.trim() ||
        !status ||
        (!status.merge && !status.entries.some((entry) => entry.area === 'staged')) ||
        status.entries.some((entry) => entry.area === 'conflict')
      )
        return
      const message = value.message.trim()
      form.setFieldValue('message', message)
      update(workspace.id, { draft: message })
      const committed = await mutate({
        ...target,
        action: 'commit',
        message,
        indexVersion: status.indexVersion,
      })
      if (committed && isMounted() && form.getFieldValue('message') === message)
        form.reset({ message: '' })
      if (!committed || !meta.push || !isMounted()) return
      const current = useSourceControl.getState().sessions[workspace.id]?.status
      if (
        !current?.head ||
        !current.branch ||
        current.branch !== status.branch ||
        current.tracking?.remote !== status.tracking?.remote ||
        current.tracking?.branch !== status.tracking?.branch ||
        current.upstream !== status.upstream
      ) {
        setError('提交已成功，但未能确认最新分支或上游状态，未执行推送。请刷新后重试推送。')
        return
      }
      const identity = { ...target, branch: current.branch, head: current.head }
      const pushed = await mutate(
        current.tracking
          ? { ...identity, action: 'push', tracking: current.tracking }
          : { ...identity, action: 'publish', remote: selectedRemote },
      )
      if (isMounted()) {
        if (pushed) toast.success('提交并推送成功', { description: workspace.name })
        else toast.warning('提交已成功，未完成推送。', { description: workspace.name })
      }
    },
  })

  const mergeKey = status?.merge?.heads.join('\n')
  const mergeMessage = status?.merge?.message
  useEffect(() => {
    if (!mergeKey || !mergeMessage || form.getFieldValue('message').trim()) return
    form.setFieldValue('message', mergeMessage)
    update(workspace.id, { draft: mergeMessage })
  }, [form, mergeKey, mergeMessage, update, workspace.id])

  const disabled = pending || !status
  const hasConflicts = status?.entries.some((entry) => entry.area === 'conflict')
  const hasStaged = status?.entries.some((entry) => entry.area === 'staged')
  const commitDisabled = disabled || hasConflicts || (!status.merge && !hasStaged)
  return (
    <Collapsible
      className="source-control-commit flex shrink-0 flex-col gap-2 px-2 py-1.5"
      open={messageExpanded}
      onOpenChange={setMessageExpanded}
      render={
        <form
          className="source-control-commit-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        />
      }
    >
      {status?.merge && (
        <Alert className="source-control-merge-status" aria-live="polite">
          <GitMerge className="source-control-merge-status-icon" />
          <AlertTitle className="source-control-merge-status-title">
            {hasConflicts ? '合并存在冲突' : '合并待提交'}
          </AlertTitle>
          <AlertDescription className="source-control-merge-status-description">
            {hasConflicts
              ? '请在编辑器中解决冲突并暂存，然后完成合并。'
              : '请审阅合并结果并完成合并提交，再同步。'}
          </AlertDescription>
        </Alert>
      )}
      <CollapsibleContent className="source-control-commit-content" keepMounted>
        <FieldGroup className="source-control-commit-fields">
          <form.Field name="message">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field
                  className="source-control-commit-field"
                  data-disabled={pending}
                  data-invalid={invalid}
                >
                  <FieldLabel
                    className="source-control-commit-label sr-only"
                    htmlFor={`commit-${workspace.id}`}
                  >
                    提交信息
                  </FieldLabel>
                  <Textarea
                    id={`commit-${workspace.id}`}
                    name={field.name}
                    aria-label="提交信息"
                    className="source-control-commit-message max-h-32 select-text"
                    placeholder="描述本次更改…"
                    maxLength={20000}
                    value={field.state.value}
                    aria-invalid={invalid}
                    aria-describedby={`commit-description-${workspace.id}${invalid ? ` commit-error-${workspace.id}` : ''}`}
                    disabled={pending}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      update(workspace.id, { draft: event.target.value })
                    }}
                  />
                  <FieldDescription
                    id={`commit-description-${workspace.id}`}
                    className="source-control-commit-description"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {generation.state === 'running'
                      ? '正在使用 Pi 生成提交信息…'
                      : generation.state === 'stopping'
                        ? '正在停止生成…'
                        : status?.merge
                          ? '完成当前合并提交；未暂存的更改不会提交。'
                          : '仅提交已暂存的更改。'}
                  </FieldDescription>
                  {invalid && (
                    <FieldError
                      id={`commit-error-${workspace.id}`}
                      className="source-control-commit-error"
                      errors={field.state.meta.errors}
                    />
                  )}
                </Field>
              )
            }}
          </form.Field>
        </FieldGroup>
        {generation.feedback && (
          <Alert
            className="source-control-generation-feedback"
            variant={generation.feedback.error ? 'destructive' : 'default'}
          >
            <AlertDescription className="source-control-generation-feedback-description">
              {generation.feedback.message}
            </AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
      <div className="source-control-commit-actions flex min-w-0 items-center justify-between gap-1">
        <CollapsibleTrigger
          className="source-control-commit-toggle"
          render={<Button type="button" variant="ghost" size="icon-sm" />}
          aria-label={messageExpanded ? '收起提交信息' : '展开提交信息'}
          title={messageExpanded ? '收起提交信息' : '展开提交信息'}
        >
          {messageExpanded ? (
            <ChevronDown className="source-control-commit-collapse-icon" />
          ) : (
            <ChevronUp className="source-control-commit-expand-icon" />
          )}
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="source-control-generate-message ml-auto"
          aria-label={generation.state === 'idle' ? '使用 Pi 生成提交信息' : '停止生成提交信息'}
          title={generation.state === 'idle' ? '使用 Pi 生成提交信息' : '停止生成提交信息'}
          disabled={
            generation.state === 'stopping' ||
            (generation.state === 'idle' && (commitDisabled || !hasStaged))
          }
          onClick={() => {
            setMessageExpanded(true)
            if (generation.state !== 'idle') {
              void generation.cancel().catch(() => {})
            } else if (status && !writing.current) {
              void generation.generate(status.indexVersion, (message) => {
                form.setFieldValue('message', message)
                update(workspace.id, { draft: message })
              })
            }
          }}
        >
          {generation.state === 'stopping' ? (
            <LoaderCircle className="source-control-generating-icon animate-spin" />
          ) : generation.state === 'running' ? (
            <Square className="source-control-stop-generation-icon" />
          ) : (
            <Sparkles className="source-control-generate-message-icon" />
          )}
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting || !state.values.message.trim()}>
          {(unavailable) => (
            <ButtonGroup className="source-control-commit-buttons shrink-0" aria-label="提交操作">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="source-control-commit-button"
                disabled={commitDisabled || unavailable}
              >
                <GitCommitHorizontal
                  className="source-control-commit-icon"
                  data-icon="inline-start"
                />
                {status?.merge ? '完成合并' : '提交'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="source-control-commit-menu-trigger"
                  render={<Button type="button" variant="outline" size="icon-sm" />}
                  aria-label="更多提交操作"
                  disabled={commitDisabled || unavailable}
                >
                  <ChevronDown className="source-control-commit-menu-icon" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="source-control-commit-menu" align="end">
                  <DropdownMenuGroup className="source-control-commit-menu-actions">
                    <DropdownMenuItem
                      className="source-control-commit-and-push"
                      disabled={commitDisabled || unavailable}
                      onClick={() => void form.handleSubmit({ push: true })}
                    >
                      <Upload className="source-control-commit-and-push-icon" />
                      {status?.merge ? '完成合并并推送' : '提交并推送'}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          )}
        </form.Subscribe>
      </div>
    </Collapsible>
  )
}
