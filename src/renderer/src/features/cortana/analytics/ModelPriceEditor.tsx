import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { cn } from 'cn'
import type { ModelPrice } from '../../../../../shared/usage-analytics'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { errorMessage, modelPriceFields } from './pricing-values'

const identifier = z
  .string()
  .trim()
  .min(1, '请输入名称。')
  .max(200)
  .regex(/^[^\0\r\n]+$/, '名称不能包含换行。')
const amount = z
  .string()
  .trim()
  .max(40)
  .regex(/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)?$/, '请输入非负数字。')
  .refine((value) => !value || Number(value) <= 1_000_000, '价格过大。')
const formSchema = z.object({
  provider: identifier,
  model: identifier,
  input: amount,
  output: amount,
  cacheRead: amount,
  cacheWrite: amount,
})

export function ModelPriceEditor({
  price,
  onCancel,
  onSave,
}: {
  price?: ModelPrice
  onCancel: () => void
  onSave: (price: ModelPrice) => Promise<void>
}) {
  const [error, setError] = useState<string>()
  const value = (rate: number | null | undefined) => (rate == null ? '' : String(rate))
  const form = useForm({
    defaultValues: {
      provider: price?.provider ?? '',
      model: price?.model ?? '',
      input: value(price?.input),
      output: value(price?.output),
      cacheRead: value(price?.cacheRead),
      cacheWrite: value(price?.cacheWrite),
    },
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value: submitted }) => {
      setError(undefined)
      const decimal = (raw: string) => (raw.trim() ? Number(raw) : null)
      try {
        await onSave({
          provider: submitted.provider.trim(),
          model: submitted.model.trim(),
          input: decimal(submitted.input),
          output: decimal(submitted.output),
          cacheRead: decimal(submitted.cacheRead),
          cacheWrite: decimal(submitted.cacheWrite),
        })
      } catch (caught) {
        setError(errorMessage(caught))
      }
    },
  })
  const renderField = ({ name, label }: (typeof modelPriceFields)[number]) => {
    const identity = name === 'provider' || name === 'model'
    return (
      <form.Field name={name} key={name}>
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field
              className="pricing-editor-field"
              data-invalid={invalid}
              data-disabled={!!price && identity}
            >
              <FieldLabel className="pricing-editor-label" htmlFor={`price-${name}`}>
                {label}
              </FieldLabel>
              <Input
                className={cn('pricing-editor-input', !identity && 'tabular-nums')}
                id={`price-${name}`}
                name={name}
                value={field.state.value}
                placeholder={
                  name === 'provider' ? '例如 openai' : name === 'model' ? '例如 gpt-5.4' : '未设置'
                }
                required={identity}
                disabled={!!price && identity}
                inputMode={identity ? 'text' : 'decimal'}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={invalid}
                aria-describedby={invalid ? `price-${name}-error` : undefined}
              />
              {invalid && (
                <FieldError
                  className="pricing-editor-field-error"
                  id={`price-${name}-error`}
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
    <form
      className="pricing-editor flex min-h-0 flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {error && (
        <Alert className="pricing-editor-error" variant="destructive">
          <AlertDescription className="pricing-editor-error-message">{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="pricing-editor-fields min-h-0 gap-5 overflow-y-auto">
        <FieldGroup className="pricing-editor-identity gap-3">
          {modelPriceFields.slice(0, 2).map(renderField)}
        </FieldGroup>
        <fieldset className="pricing-editor-rates min-w-0">
          <legend className="pricing-editor-rates-legend mb-3 w-full">
            <span className="pricing-editor-rates-heading flex flex-wrap items-center justify-between gap-2">
              <span className="pricing-editor-rates-title font-medium">Token 单价</span>
              <span className="pricing-editor-unit text-muted-foreground">美元 / 百万 Token</span>
            </span>
          </legend>
          <FieldGroup className="pricing-editor-rate-fields grid grid-cols-2 gap-3">
            {modelPriceFields.slice(2).map(renderField)}
          </FieldGroup>
        </fieldset>
      </FieldGroup>
      <DialogFooter className="pricing-editor-footer">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, submitting]) => (
            <>
              <Button
                className="pricing-editor-cancel"
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={onCancel}
              >
                取消
              </Button>
              <Button
                className="pricing-editor-save"
                type="submit"
                disabled={!canSubmit || submitting}
              >
                {submitting ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
