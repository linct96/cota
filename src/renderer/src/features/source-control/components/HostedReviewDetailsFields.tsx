import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewDetailsFields({
  form,
  fieldsDisabled,
  markTextEdited,
}: Pick<HostedReviewCreation, 'form' | 'fieldsDisabled' | 'markTextEdited'>) {
  return (
    <>
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
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                markTextEdited(name)
                field.handleChange(event.target.value)
              },
              'aria-invalid': invalid,
              'aria-describedby': `review-${name}-description${invalid ? ` review-${name}-error` : ''}`,
            }
            return (
              <Field
                className={`create-hosted-review-${name}-field`}
                data-invalid={invalid}
                data-disabled={fieldsDisabled}
              >
                <FieldLabel htmlFor={props.id} className={`create-hosted-review-${name}-label`}>
                  {name === 'title' ? '标题' : '描述'}
                </FieldLabel>
                {name === 'description' ? (
                  <Textarea
                    {...props}
                    className="create-hosted-review-description-input h-36 min-h-24 resize-y field-sizing-fixed"
                    maxLength={65000}
                  />
                ) : (
                  <Input {...props} className="create-hosted-review-title-input" maxLength={240} />
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
            className="create-hosted-review-draft-field flex-row items-center gap-2"
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
    </>
  )
}
