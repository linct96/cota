import { useId, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Check, GitBranch, GitBranchPlus, Plus, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { toast } from 'sonner'
import type { GitReferences, GitStatus } from '../../../shared/source-control'
import { createBranchFormSchema } from '../lib/form-schemas'
import { formatRelativeTime } from '../lib/format-relative-time'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxRow,
  ComboboxTrigger,
} from './ui/combobox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'

export function SourceControlBranchPicker({
  status,
  references,
  pending,
  onSwitch,
  onCreate,
  onDelete,
}: {
  status: GitStatus
  references?: GitReferences
  pending: boolean
  onSwitch: (ref: string) => void
  onCreate: (name: string, switchBranch: boolean) => Promise<boolean>
  onDelete: (ref: string) => Promise<boolean>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  const branches =
    references?.branches.filter((branch) => branch.ref.startsWith('refs/heads/')) || []
  // Grid navigation needs both cells in the flat item list, including hidden delete actions.
  const items = branches.flatMap((branch) => [
    { ...branch, action: 'switch' as const },
    { ...branch, action: 'delete' as const },
  ])
  const label = status.branch || `分离 HEAD · ${status.head?.slice(0, 8) || '无提交'}`
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onChange: createBranchFormSchema, onSubmit: createBranchFormSchema },
    onSubmitMeta: { switchBranch: true },
    onSubmit: async ({ value, meta }) => {
      const name = value.name.trim()
      if (
        !status.head ||
        !references ||
        pending ||
        deleting ||
        branches.some((branch) => branch.label === name)
      )
        return
      setError(undefined)
      try {
        if (await onCreate(name, meta.switchBranch)) {
          setOpen(false)
          toast.success(
            meta.switchBranch ? `已创建并切换到「${name}」` : `已创建本地分支「${name}」`,
          )
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
  })
  const search = useStore(form.store, (state) => state.values.name)
  const creating = useStore(form.store, (state) => state.isSubmitting)
  const busy = creating || deleting
  const name = search.trim()
  const showCreate = !!name && !branches.some((branch) => branch.label === name)
  const validName = createBranchFormSchema.safeParse({ name }).success

  async function deleteBranch(branch: GitReferences['branches'][number]) {
    if (pending || busy) return
    setDeleting(true)
    setError(undefined)
    try {
      if (await onDelete(branch.ref)) toast.success(`已删除本地分支「${branch.label}」`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Combobox<(typeof items)[number]>
      grid
      items={items}
      value={
        items.find((branch) => branch.label === status.branch && branch.action === 'switch') || null
      }
      itemToStringLabel={(branch) => branch.label}
      isItemEqualToValue={(a, b) => a.ref === b.ref && a.action === b.action}
      disabled={!references}
      open={open}
      inputValue={search}
      onInputValueChange={(value, details) => {
        if (busy || details.reason !== 'input-change') return
        form.setFieldValue('name', value)
        setError(undefined)
      }}
      onOpenChange={(next, details) => {
        if (busy) {
          details.cancel()
          return
        }
        if (next) {
          form.reset()
          setError(undefined)
        }
        setOpen(next)
      }}
      onValueChange={(branch, details) => {
        if (branch?.action === 'delete') {
          details.cancel()
          void deleteBranch(branch)
        } else if (branch && branch.label !== status.branch && !pending && !busy) {
          onSwitch(branch.ref)
        }
      }}
    >
      <ComboboxTrigger
        className="source-control-branch min-w-0 max-w-[min(13rem,calc(100%-6.5rem))] shrink justify-start gap-1 px-1.5"
        render={<Button variant="ghost" size="sm" />}
        disabled={pending || busy}
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
          <ComboboxList className="source-control-branch-list min-h-0">
            {(branch: (typeof items)[number]) => {
              if (branch.action === 'delete') return null
              const current = branch.label === status.branch
              const BranchIcon = current ? Check : GitBranch
              const occupied = !!branch.worktreePath && !current
              const protectedBranch = current || !!branch.worktreePath
              const commitDate = new Date(branch.date).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })
              const commitDescription = `${commitDate} · ${branch.subject || '（无提交标题）'}`
              return (
                <ComboboxRow
                  className="source-control-branch-option-row group/branch flex items-stretch"
                  key={branch.ref}
                >
                  <ComboboxItem
                    className="source-control-branch-option min-w-0 flex-1"
                    value={branch}
                    showIndicator={false}
                    disabled={occupied || pending || busy}
                    title={occupied ? `已被 Worktree 占用：${branch.worktreePath}` : branch.label}
                  >
                    <BranchIcon className="source-control-branch-option-icon" aria-hidden="true" />
                    <span className="source-control-branch-option-content flex min-w-0 flex-1 flex-col text-left">
                      <span className="source-control-branch-option-label truncate">
                        {branch.label}
                      </span>
                      <span
                        className="source-control-branch-option-description truncate text-2xs text-app-muted-foreground"
                        title={commitDescription}
                      >
                        {formatRelativeTime(branch.date)} · {branch.subject || '（无提交标题）'}
                      </span>
                    </span>
                  </ComboboxItem>
                  <ComboboxPrimitive.Item
                    value={{ ...branch, action: 'delete' }}
                    render={<Button variant="secondary" size="icon" />}
                    nativeButton
                    className={cn(
                      'source-control-branch-delete mr-2 self-center bg-transparent opacity-0 group-hover/branch:opacity-100 group-focus-within/branch:opacity-100 group-has-[[data-highlighted]]/branch:opacity-100 data-disabled:invisible',
                      occupied && 'hidden',
                    )}
                    disabled={protectedBranch || pending || busy}
                    aria-label={`删除本地分支「${branch.label}」`}
                    title="删除本地分支（不强制删除未合并分支）"
                  >
                    <Trash2 className="source-control-branch-delete-icon" aria-hidden="true" />
                  </ComboboxPrimitive.Item>
                </ComboboxRow>
              )
            }}
          </ComboboxList>
          {showCreate && (
            <Field className="source-control-branch-create shrink-0 gap-1 p-1">
              <div className="source-control-branch-create-row source-control-branch-option-row flex items-stretch">
                <Button
                  type="button"
                  variant="ghost"
                  className="source-control-branch-create-button source-control-branch-option h-auto min-h-7 min-w-0 flex-1 justify-start gap-2 border-0 py-1 text-left font-normal has-data-[icon=inline-start]:pl-2"
                  disabled={!validName || !status.head || !references || pending || busy}
                  aria-busy={creating}
                  aria-describedby={!status.head ? `${id}-help` : undefined}
                  title={`创建并切换到「${name}」`}
                  onClick={() => void form.handleSubmit()}
                >
                  <GitBranchPlus
                    className="source-control-branch-create-icon"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  <span className="source-control-branch-create-content flex min-w-0 flex-1 flex-col text-left">
                    <span className="source-control-branch-create-label truncate">
                      创建分支「{name}」
                    </span>
                    <span className="source-control-branch-create-description truncate text-2xs text-app-muted-foreground">
                      基于当前分支创建并切换
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="source-control-branch-create-only mr-2 self-center bg-transparent"
                  disabled={!validName || !status.head || !references || pending || busy}
                  aria-busy={creating}
                  aria-describedby={!status.head ? `${id}-help` : undefined}
                  aria-label={`仅创建分支「${name}」，不签出`}
                  title="仅创建，不签出"
                  onClick={() => void form.handleSubmit({ switchBranch: false })}
                >
                  <Plus className="source-control-branch-create-only-icon" aria-hidden="true" />
                </Button>
              </div>
              {!status.head && (
                <FieldDescription
                  id={`${id}-help`}
                  className="source-control-branch-create-help px-2"
                >
                  当前分支还没有提交，暂不能创建分支。
                </FieldDescription>
              )}
            </Field>
          )}
          {error && (
            <Alert
              variant="destructive"
              className="source-control-branch-operation-error shrink-0"
              role="alert"
            >
              <AlertDescription className="source-control-branch-operation-error-detail max-h-24 overflow-auto whitespace-pre-wrap break-words select-text">
                {error}
              </AlertDescription>
            </Alert>
          )}
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
                      disabled={pending || busy}
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
        </form>
      </ComboboxContent>
    </Combobox>
  )
}
