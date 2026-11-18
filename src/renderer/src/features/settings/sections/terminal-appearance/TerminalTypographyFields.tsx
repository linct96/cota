import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputNumber } from '@/components/ui/input-number'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import type { ReactNode } from 'react'

export function TerminalTypographyFields({
  form,
  values,
  numberFields,
  backgroundFields,
  choiceFields,
}: {
  form: TerminalAppearanceForm
  values: TerminalAppearance
  numberFields: ReactNode
  backgroundFields: ReactNode
  choiceFields: ReactNode
}) {
  return (
    <>
      {choiceFields}
      <FieldGroup className="terminal-appearance-numbers grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        {numberFields}
      </FieldGroup>
      <form.Field name="contrastMode">
        {(field) => (
          <Field className="terminal-contrast-mode-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <div className="terminal-contrast-mode-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
              <p
                id="terminal-contrastMode-label"
                className="terminal-contrast-mode-label text-xs leading-5 font-medium text-foreground"
              >
                文字对比度
              </p>
              <FieldDescription
                id="terminal-contrast-mode-description"
                className="terminal-contrast-mode-description"
              >
                自动增强低对比度文字的可读性。
              </FieldDescription>
            </div>
            <ToggleGroup
              className="terminal-contrast-mode-options shrink-0"
              variant="outline"
              spacing={0}
              value={[field.state.value]}
              aria-labelledby="terminal-contrastMode-label"
              aria-describedby="terminal-contrast-mode-description"
              onBlur={field.handleBlur}
              onValueChange={([value]) => {
                if (value !== 'auto' && value !== 'off' && value !== 'custom') return
                field.handleChange(value)
              }}
            >
              <ToggleGroupItem className="terminal-contrast-mode-option" value="auto">
                自动
              </ToggleGroupItem>
              <ToggleGroupItem className="terminal-contrast-mode-option" value="off">
                关闭
              </ToggleGroupItem>
              <ToggleGroupItem className="terminal-contrast-mode-option" value="custom">
                自定义
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}
      </form.Field>
      {values.contrastMode === 'custom' && (
        <form.Field name="minimumContrastRatio">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid

            return (
              <Field
                className="terminal-contrast-ratio-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                data-invalid={invalid}
              >
                <div className="terminal-contrast-ratio-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                  <FieldLabel
                    htmlFor="terminal-minimumContrastRatio"
                    className="terminal-contrast-ratio-label inline-block text-xs leading-5 font-medium text-foreground"
                  >
                    最低对比度
                    <span
                      id="terminal-minimumContrastRatio-help"
                      className="terminal-contrast-ratio-range ml-1.5 text-xs font-normal text-muted-foreground tabular-nums"
                    >
                      (1–21)
                    </span>
                  </FieldLabel>
                  <FieldDescription
                    id="terminal-minimumContrastRatio-description"
                    className="terminal-contrast-ratio-description"
                  >
                    推荐 4.5（AA）或 7.0（AAA）。
                  </FieldDescription>
                </div>
                <InputNumber
                  id="terminal-minimumContrastRatio"
                  className="terminal-contrast-ratio-input w-28 max-w-full shrink-0 font-mono tabular-nums"
                  min={1}
                  max={21}
                  step={0.1}
                  value={Number.isNaN(field.state.value) ? null : field.state.value}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => field.handleChange(value ?? NaN)}
                  inputProps={{
                    'aria-invalid': invalid,
                    'aria-describedby':
                      'terminal-minimumContrastRatio-help terminal-minimumContrastRatio-description terminal-minimumContrastRatio-error',
                  }}
                />
                <FieldError
                  id="terminal-minimumContrastRatio-error"
                  className="terminal-contrast-ratio-error basis-full"
                  errors={field.state.meta.isTouched ? field.state.meta.errors : []}
                />
              </Field>
            )
          }}
        </form.Field>
      )}
      <FieldGroup className="terminal-appearance-background-numbers grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3">
        {backgroundFields}
      </FieldGroup>
    </>
  )
}
