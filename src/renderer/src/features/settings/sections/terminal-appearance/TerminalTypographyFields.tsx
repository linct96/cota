import type { ReactNode } from 'react'
import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import { InputNumber } from '@/components/ui/input-number'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { TerminalSettingRow } from './TerminalSettingRow'

function formatFieldError(errors: ({ message?: string } | undefined)[]): string | undefined {
  const messages = [...new Set(errors.map((error) => error?.message).filter(Boolean))]
  return messages.length ? messages.join(' ') : undefined
}

export function TerminalTypographyFields({
  form,
  values,
  ready,
  saving,
  numberFields,
  backgroundFields,
  choiceFields,
}: {
  form: TerminalAppearanceForm
  values: TerminalAppearance
  ready: boolean
  saving: boolean
  numberFields: ReactNode
  backgroundFields: ReactNode
  choiceFields: ReactNode
}) {
  return (
    <>
      {choiceFields}
      {numberFields}
      <form.Field name="contrastMode">
        {(field) => (
          <TerminalSettingRow
            className="terminal-contrast-mode-row"
            textClassName="terminal-contrast-mode-text"
            labelId="terminal-contrastMode-label"
            label="文字对比度"
            labelClassName="terminal-contrast-mode-label"
            descriptionId="terminal-contrastMode-description"
            description="自动增强低对比度文字的可读性。"
            descriptionClassName="terminal-contrast-mode-description"
          >
            <ToggleGroup
              id="terminal-contrastMode"
              className="terminal-contrast-mode-options shrink-0"
              variant="outline"
              spacing={0}
              disabled={!ready}
              value={[field.state.value]}
              aria-labelledby="terminal-contrastMode-label"
              aria-describedby="terminal-contrastMode-description"
              aria-busy={saving}
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
          </TerminalSettingRow>
        )}
      </form.Field>
      {values.contrastMode === 'custom' && (
        <form.Field name="minimumContrastRatio">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
            const errorMessage = field.state.meta.isTouched
              ? formatFieldError(field.state.meta.errors)
              : undefined

            return (
              <TerminalSettingRow
                className="terminal-contrast-ratio-row"
                textClassName="terminal-contrast-ratio-text"
                labelId="terminal-minimumContrastRatio-label"
                label="最低对比度"
                labelClassName="terminal-contrast-ratio-label"
                descriptionId="terminal-minimumContrastRatio-description"
                description="范围 1–21，推荐 4.5（AA）或 7.0（AAA）。"
                descriptionClassName="terminal-contrast-ratio-description tabular-nums"
                invalid={invalid}
                error={
                  errorMessage && (
                    <p
                      id="terminal-minimumContrastRatio-error"
                      className="terminal-contrast-ratio-error text-xs text-destructive"
                      role="alert"
                    >
                      {errorMessage}
                    </p>
                  )
                }
              >
                <InputNumber
                  id="terminal-minimumContrastRatio"
                  className="terminal-contrast-ratio-input w-28 max-w-full shrink-0 font-mono tabular-nums"
                  min={1}
                  max={21}
                  step={0.1}
                  disabled={!ready}
                  value={Number.isNaN(field.state.value) ? null : field.state.value}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => field.handleChange(value ?? NaN)}
                  inputProps={{
                    'aria-labelledby': 'terminal-minimumContrastRatio-label',
                    'aria-busy': saving,
                    'aria-invalid': invalid,
                    'aria-describedby': errorMessage
                      ? 'terminal-minimumContrastRatio-description terminal-minimumContrastRatio-error'
                      : 'terminal-minimumContrastRatio-description',
                  }}
                />
              </TerminalSettingRow>
            )
          }}
        </form.Field>
      )}
      {backgroundFields}
    </>
  )
}
