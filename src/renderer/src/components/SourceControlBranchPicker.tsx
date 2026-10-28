import { useId, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { GitBranch, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { GitReferences, GitStatus } from '../../../shared/source-control'
import { createBranchFormSchema } from '../lib/form-schemas'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Separator } from './ui/separator'

export function SourceControlBranchPicker({
  status,
  references,
  pending,
  onSwitch,
  onCreate,
}: {
  status: GitStatus
  references?: GitReferences
  pending: boolean
  onSwitch: (ref: string) => void
  onCreate: (name: string) => Promise<boolean>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const branches =
    references?.branches.filter((branch) => branch.ref.startsWith('refs/heads/')) || []
  const label = status.branch || `分离 HEAD · ${status.head?.slice(0, 8) || '无提交'}`
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onChange: createBranchFormSchema, onSubmit: createBranchFormSchema },
    onSubmit: async ({ value }) => {
      const name = value.name.trim()
      if (
        !status.head ||
        !references ||
        pending ||
        branches.some((branch) => branch.label === name)
      )
        return
      setError(undefined)
      try {
        if (await onCreate(name)) {
          setOpen(false)
          toast.success(`已创建并切换到「${name}」`)
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
  })
  const search = useStore(form.store, (state) => state.values.name)
  const creating = useStore(form.store, (state) => state.isSubmitting)
  const name = search.trim()
  const showCreate = !!name && !branches.some((branch) => branch.label === name)
  const validName = createBranchFormSchema.safeParse({ name }).success

  return (
    <Combobox
      items={branches}
      value={branches.find((branch) => branch.label === status.branch) || null}
      itemToStringLabel={(branch) => branch.label}
      disabled={!references}
      open={open}
      inputValue={search}
      onInputValueChange={(value, details) => {
        if (creating || details.reason !== 'input-change') return
        form.setFieldValue('name', value)
        setError(undefined)
      }}
      onOpenChange={(next, details) => {
        if (creating) {
          details.cancel()
          return
        }
        if (next) {
          form.reset()
          setError(undefined)
        }
        setOpen(next)
      }}
      onValueChange={(branch) => {
        if (branch && branch.label !== status.branch && !pending && !creating) onSwitch(branch.ref)
      }}
    >
      <ComboboxTrigger
        className="source-control-branch min-w-0 max-w-[min(13rem,calc(100%-6.5rem))] shrink justify-start gap-1 px-1.5"
        render={<Button variant="ghost" size="sm" />}
        disabled={pending || creating}
        aria-label={`切换分支，当前${label}`}
        title={`切换本地分支 · ${label}`}
      >
        <GitBranch className="source-control-branch-icon shrink-0" />
        <span className="source-control-branch-name min-w-0 truncate">{label}</span>
      </ComboboxTrigger>
      <ComboboxContent className="source-control-branch-picker flex flex-col">
        <form
          className="source-control-branch-form flex min-h-0 flex-col overflow-hidden"
          noValidate
          onSubmit={(event) => {
            // Enter in search selects an existing branch, never implicitly creates one.
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <FieldGroup className="source-control-branch-search shrink-0 p-1">
            <form.Field name="name">
              {(field) => {
                const invalid = !!name && !field.state.meta.isValid
                return (
                  <Field className="source-control-branch-search-field" data-invalid={invalid}>
                    <FieldLabel
                      className="source-control-branch-search-label sr-only"
                      htmlFor={`${id}-search`}
                    >
                      搜索分支或输入新分支名
                    </FieldLabel>
                    <ComboboxInput
                      id={`${id}-search`}
                      className="source-control-branch-search-input"
                      placeholder="搜索分支或输入新分支名…"
                      disabled={pending || creating}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                      aria-describedby={`${id}-error`}
                    />
                    <FieldError
                      id={`${id}-error`}
                      className="source-control-branch-search-error"
                      errors={invalid ? field.state.meta.errors : []}
                    />
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
          <ComboboxEmpty className="source-control-branch-empty">没有匹配的本地分支</ComboboxEmpty>
          <ComboboxList className="source-control-branch-list min-h-0">
            {(branch: GitReferences['branches'][number]) => {
              const occupied = !!branch.worktreePath && branch.label !== status.branch
              return (
                <ComboboxItem
                  className="source-control-branch-option"
                  key={branch.ref}
                  value={branch}
                  disabled={occupied || pending || creating}
                  title={occupied ? `已被 Worktree 占用：${branch.worktreePath}` : branch.label}
                >
                  <GitBranch className="source-control-branch-option-icon" />
                  <span className="source-control-branch-option-label min-w-0 flex-1 truncate">
                    {branch.label}
                  </span>
                  {occupied && (
                    <span className="source-control-branch-occupied shrink-0 text-app-muted-foreground">
                      已占用
                    </span>
                  )}
                </ComboboxItem>
              )
            }}
          </ComboboxList>
          {showCreate && (
            <>
              <Separator className="source-control-branch-create-separator" />
              <Field className="source-control-branch-create shrink-0 gap-1 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="source-control-branch-create-button w-full min-w-0 justify-start"
                  disabled={!validName || !status.head || !references || pending || creating}
                  aria-busy={creating}
                  aria-describedby={!status.head ? `${id}-help` : undefined}
                  title={`创建并切换到「${name}」`}
                  onClick={() => void form.handleSubmit()}
                >
                  <Plus className="source-control-branch-create-icon" data-icon="inline-start" />
                  <span className="source-control-branch-create-label min-w-0 truncate">
                    创建并切换到「{name}」
                  </span>
                </Button>
                {!status.head && (
                  <FieldDescription
                    id={`${id}-help`}
                    className="source-control-branch-create-help px-2"
                  >
                    当前分支还没有提交，暂不能创建分支。
                  </FieldDescription>
                )}
              </Field>
            </>
          )}
          {error && (
            <Alert
              variant="destructive"
              className="source-control-branch-create-error shrink-0"
              role="alert"
            >
              <AlertDescription className="source-control-branch-create-error-detail max-h-24 overflow-auto whitespace-pre-wrap break-words select-text">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </form>
      </ComboboxContent>
    </Combobox>
  )
}
