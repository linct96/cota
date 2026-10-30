import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { BranchPicker } from './BranchPicker'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewBranchFields({
  form,
  creation,
  fieldsDisabled,
  initializing,
  branchChanged,
}: Pick<
  HostedReviewCreation,
  'form' | 'creation' | 'fieldsDisabled' | 'initializing' | 'branchChanged'
>) {
  return (
    <>
      {(['sourceBranch', 'targetBranch'] as const).map((name) => (
        <form.Field key={name} name={name}>
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
                    branchChanged()
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
    </>
  )
}
