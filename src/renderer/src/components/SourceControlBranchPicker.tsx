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
import { ComboboxItem, ComboboxRow } from './ui/combobox'
import { BranchPicker, BranchPickerSearch } from './BranchPicker'
import { Field, FieldDescription, FieldError } from './ui/field'

export function SourceControlBranchPicker({
  mode,
  status,
  references,
  value,
  pending,
  onSelect,
  onCreate,
  onDelete,
}: {
  mode: 'switch' | 'compare'
  status?: GitStatus
  references?: GitReferences
  value?: string
  pending: boolean
  onSelect: (ref: string) => void
  onCreate: (name: string, switchBranch: boolean) => Promise<boolean>
  onDelete?: (ref: string) => Promise<boolean>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  const allBranches = references?.branches || []
  const switching = mode === 'switch'
  const canDelete = switching && !!onDelete
  const branches = allBranches.filter((branch) => branch.ref.startsWith('refs/heads/'))
  // Grid navigation needs both cells in each group's item list, including hidden delete actions.
  const items = allBranches.flatMap((branch) => {
    const item = { ...branch, value: branch.ref, action: 'select' as const }
    return canDelete && branch.ref.startsWith('refs/heads/')
      ? [item, { ...branch, value: branch.ref, action: 'delete' as const }]
      : [item]
  })
  const branchGroups = [
    {
      label: '本地分支',
      type: 'local' as const,
      items: items.filter((branch) => branch.ref.startsWith('refs/heads/')),
    },
    {
      label: '远端分支',
      type: 'remote' as const,
      items: items.filter((branch) => branch.ref.startsWith('refs/remotes/')),
    },
  ]
  const currentRef = status?.branch ? `refs/heads/${status.branch}` : undefined
  const selectedRef = value ?? currentRef
  const selectedBranch = items.find(
    (branch) => branch.ref === selectedRef && branch.action === 'select',
  )
  const label = switching
    ? status?.branch || `分离 HEAD · ${status?.head?.slice(0, 8) || '无提交'}`
    : selectedBranch?.label || '选择本地或远端分支'
  const CreateIcon = switching ? GitBranchPlus : Plus
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onChange: createBranchFormSchema, onSubmit: createBranchFormSchema },
    onSubmitMeta: { switchBranch: switching },
    onSubmit: async ({ value, meta }) => {
      const name = value.name.trim()
      if (
        !status?.head ||
        !references ||
        pending ||
        deleting ||
        branches.some((branch) => branch.label === name)
      )
        return
      setError(undefined)
      try {
        const switchBranch = switching && meta.switchBranch
        if (await onCreate(name, switchBranch)) {
          setOpen(false)
          toast.success(switchBranch ? `已创建并切换到「${name}」` : `已创建本地分支「${name}」`)
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
  const showCreate =
    !!name && (switching || !!status?.head) && !branches.some((branch) => branch.label === name)
  const validName = createBranchFormSchema.safeParse({ name }).success

  async function deleteBranch(branch: GitReferences['branches'][number]) {
    if (!canDelete || !onDelete || pending || busy) return
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
    <form.Field name="name">
      {(field) => {
        const invalid = !!name && !field.state.meta.isValid
        return (
          <BranchPicker<(typeof items)[number]>
            grid
            variant="ghost"
            defaultShowLocal={mode !== 'compare'}
            items={branchGroups}
            value={selectedBranch || null}
            label={label}
            isItemEqualToValue={(a, b) => a.ref === b.ref && a.action === b.action}
            disabled={!references}
            open={open}
            inputValue={search}
            onInputValueChange={(value, details) => {
              if (busy || details.reason !== 'input-change') return
              field.handleChange(value)
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
              } else if (branch && branch.ref !== selectedRef && !pending && !busy) {
                onSelect(branch.ref)
              }
            }}
            className={cn(
              'source-control-branch shrink px-1.5',
              switching ? 'max-w-[min(13rem,calc(100%-6.5rem))]' : 'max-w-full',
            )}
            triggerProps={{
              disabled: pending || busy,
              'aria-label': switching ? `切换分支，当前${label}` : '比较目标分支',
              title: `${switching ? '切换分支' : '比较目标分支'} · ${label}`,
            }}
            search={(filters) => (
              <BranchPickerSearch
                inputProps={{
                  id: `${id}-search`,
                  placeholder: '搜索分支或输入新分支名…',
                  disabled: pending || busy,
                  onBlur: field.handleBlur,
                  'aria-invalid': invalid,
                  'aria-describedby': `${id}-error`,
                }}
                error={
                  <FieldError
                    id={`${id}-error`}
                    className="source-control-branch-search-error"
                    errors={invalid ? field.state.meta.errors : []}
                  />
                }
                actions={filters}
              />
            )}
            renderItem={(branch) => {
              if (branch.action === 'delete') return null
              const remote = branch.ref.startsWith('refs/remotes/')
              const current = branch.ref === currentRef
              const BranchIcon = branch.ref === selectedRef ? Check : GitBranch
              const occupied = switching && !!branch.worktreePath && !current
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
                    title={
                      occupied
                        ? `已被 Worktree 占用：${branch.worktreePath}`
                        : switching && remote
                          ? `签出远端分支「${branch.label}」并创建本地跟踪分支`
                          : branch.label
                    }
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
                  {canDelete && !remote && (
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
                  )}
                </ComboboxRow>
              )
            }}
          >
            {showCreate && (
              <Field className="source-control-branch-create shrink-0 gap-1 p-1">
                <div className="source-control-branch-create-row source-control-branch-option-row flex items-stretch">
                  <Button
                    type="button"
                    variant="ghost"
                    className="source-control-branch-create-button source-control-branch-option h-auto min-h-7 min-w-0 flex-1 justify-start gap-2 border-0 py-1 text-left font-normal has-data-[icon=inline-start]:pl-2"
                    disabled={!validName || !status?.head || !references || pending || busy}
                    aria-busy={creating}
                    aria-describedby={!status?.head ? `${id}-help` : undefined}
                    title={switching ? `创建并切换到「${name}」` : `创建本地分支「${name}」`}
                    onClick={() => void form.handleSubmit({ switchBranch: switching })}
                  >
                    <CreateIcon
                      className="source-control-branch-create-icon"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    <span className="source-control-branch-create-content flex min-w-0 flex-1 flex-col text-left">
                      <span className="source-control-branch-create-label truncate">
                        创建分支「{name}」
                      </span>
                      <span className="source-control-branch-create-description truncate text-2xs text-app-muted-foreground">
                        {switching
                          ? '基于当前分支创建并切换'
                          : '从当前 HEAD 创建，不切换分支或比较基准。'}
                      </span>
                    </span>
                  </Button>
                  {switching && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="source-control-branch-create-only mr-2 self-center bg-transparent"
                      disabled={!validName || !status?.head || !references || pending || busy}
                      aria-busy={creating}
                      aria-describedby={!status?.head ? `${id}-help` : undefined}
                      aria-label={`仅创建分支「${name}」，不签出`}
                      title="仅创建，不签出"
                      onClick={() => void form.handleSubmit({ switchBranch: false })}
                    >
                      <Plus className="source-control-branch-create-only-icon" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {!status?.head && (
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
          </BranchPicker>
        )
      }}
    </form.Field>
  )
}
