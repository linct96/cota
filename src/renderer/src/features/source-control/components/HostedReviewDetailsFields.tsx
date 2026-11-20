import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { HostedReviewCreation } from '../hooks/use-hosted-review-creation'

export function HostedReviewDetailsFields({
  form,
  label,
  composerDisabled,
  markTextEdited,
}: Pick<HostedReviewCreation, 'form' | 'label' | 'composerDisabled' | 'markTextEdited'>) {
  return (
    <div className="create-hosted-review-composer flex min-h-0 flex-1 flex-col gap-3">
      <form.Field name="title">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field
              className="create-hosted-review-title-field gap-1.5"
              data-invalid={invalid}
              data-disabled={composerDisabled}
            >
              <FieldLabel
                htmlFor="review-title"
                className="create-hosted-review-title-label sr-only"
              >
                标题
              </FieldLabel>
              <Input
                id="review-title"
                name={field.name}
                value={field.state.value}
                disabled={composerDisabled}
                required
                maxLength={240}
                placeholder={`${label} 标题`}
                aria-invalid={invalid}
                aria-describedby={invalid ? 'review-title-error' : undefined}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  markTextEdited('title')
                  field.handleChange(event.target.value)
                }}
                className="create-hosted-review-title-input h-auto rounded-none border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm font-semibold shadow-none focus-visible:border-ring focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0 md:text-sm dark:bg-transparent dark:aria-invalid:ring-0"
              />
              {invalid && (
                <FieldError
                  id="review-title-error"
                  className="create-hosted-review-title-error"
                  errors={field.state.meta.errors}
                />
              )}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="description">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field
              className="create-hosted-review-description-field min-h-0 flex-1 gap-1.5"
              data-invalid={invalid}
              data-disabled={composerDisabled}
            >
              <FieldLabel
                htmlFor="review-description"
                className="create-hosted-review-description-label sr-only"
              >
                描述
              </FieldLabel>
              <Textarea
                id="review-description"
                name={field.name}
                value={field.state.value}
                disabled={composerDisabled}
                maxLength={65000}
                placeholder="补充改动背景、验证方式或关联 Issue…"
                aria-invalid={invalid}
                aria-describedby={invalid ? 'review-description-error' : undefined}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  markTextEdited('description')
                  field.handleChange(event.target.value)
                }}
                className="create-hosted-review-description-input min-h-48 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-xs/relaxed shadow-none field-sizing-fixed focus-visible:ring-0 aria-invalid:ring-0 md:text-xs/relaxed dark:bg-transparent dark:aria-invalid:ring-0"
              />
              {invalid && (
                <FieldError
                  id="review-description-error"
                  className="create-hosted-review-description-error"
                  errors={field.state.meta.errors}
                />
              )}
            </Field>
          )
        }}
      </form.Field>
    </div>
  )
}
