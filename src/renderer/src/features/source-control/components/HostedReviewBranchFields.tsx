import { ArrowRight } from 'lucide-react'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { BranchPicker } from './BranchPicker'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewBranchFields({
  form,
  creation,
  isFork,
  fieldsDisabled,
  initializing,
  branchChanged,
}: Pick<
  HostedReviewCreation,
  'form' | 'creation' | 'isFork' | 'fieldsDisabled' | 'initializing' | 'branchChanged'
>) {
  function renderField(name: 'sourceBranch' | 'targetBranch') {
    return (
      <form.Field name={name}>
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          const branches =
            (name === 'sourceBranch' ? creation?.sourceBranches : creation?.targetBranches) || []
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
          const forkPrefix = isFork
            ? remote
              ? `${remote}/`
              : repository?.path
                ? `${repository.path.split('/')[0]}:`
                : ''
            : ''
          const options = branches.map((branch) => ({
            value: branch.name,
            label: `${forkPrefix}${branch.name}`,
            date: branch.date,
          }))
          const placeholder = initializing
            ? '读取远端分支…'
            : name === 'sourceBranch'
              ? '选择源分支'
              : '选择目标分支'

          return (
            <Field
              className={`create-hosted-review-${name}-field gap-1`}
              data-invalid={invalid}
              data-disabled={fieldsDisabled}
            >
              <FieldLabel
                htmlFor={`review-${name}`}
                className={`create-hosted-review-${name}-label sr-only`}
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
                placeholder={placeholder}
                disabled={fieldsDisabled || !branches.length}
                className={`create-hosted-review-${name}-trigger h-7 bg-background font-mono`}
                triggerProps={{
                  id: `review-${name}`,
                  onBlur: field.handleBlur,
                  'aria-label': fieldLabel,
                  'aria-invalid': invalid,
                  'aria-describedby': invalid ? `review-${name}-error` : undefined,
                }}
                onValueChange={(branch) => {
                  if (branch === null || branch.value === field.state.value) return
                  field.handleChange(branch.value)
                  branchChanged()
                }}
              />
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
    )
  }

  return (
    <div className="create-hosted-review-branch-flow grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
      {renderField('sourceBranch')}
      <ArrowRight
        className="create-hosted-review-branch-direction size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      {renderField('targetBranch')}
    </div>
  )
}
