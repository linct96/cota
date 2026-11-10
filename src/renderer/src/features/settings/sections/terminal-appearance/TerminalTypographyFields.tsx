import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputNumber } from '@/components/ui/input-number'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import type { ReactNode } from 'react'
import { FONT_SUGGESTIONS } from './fields'

export function TerminalTypographyFields({
  form,
  values,
  onEdit,
  numberFields,
  choiceFields,
}: {
  form: TerminalAppearanceForm
  values: TerminalAppearance
  onEdit: () => void
  numberFields: ReactNode
  choiceFields: ReactNode
}) {
  return (
    <>
      <form.Field name="fontFamily">
        {(field) => (
          <Field
            className="terminal-font-family-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
          >
            <div className="terminal-font-family-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
              <span
                id="terminal-font-family-label"
                className="terminal-font-family-label text-xs leading-5 font-medium text-foreground"
              >
                字体
              </span>
              <FieldDescription
                id="terminal-font-family-help"
                className="terminal-font-family-description"
              >
                使用已安装的等宽字体；可用逗号设置回退字体。
              </FieldDescription>
              <FieldError
                id="terminal-font-family-error"
                className="terminal-font-family-error"
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
              />
            </div>
            <Combobox
              items={FONT_SUGGESTIONS}
              value={field.state.value}
              inputValue={field.state.value}
              onInputValueChange={(value) => {
                field.handleChange(value)
                onEdit()
              }}
              onValueChange={(value) => {
                if (value === null) return
                field.handleChange(value)
                onEdit()
              }}
            >
              <ComboboxInput
                id="terminal-font-family"
                aria-labelledby="terminal-font-family-label"
                className="terminal-font-family-input w-60 min-w-0 max-w-full shrink-0 font-mono"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                aria-describedby="terminal-font-family-help terminal-font-family-error"
              />
              <ComboboxContent className="terminal-font-suggestions w-(--anchor-width)">
                <ComboboxEmpty className="terminal-font-suggestions-empty">
                  无匹配建议，可继续使用输入的字体。
                </ComboboxEmpty>
                <ComboboxList className="terminal-font-suggestions-list">
                  {(font: string) => (
                    <ComboboxItem
                      className="terminal-font-suggestion font-mono"
                      key={font}
                      value={font}
                    >
                      {font}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>
        )}
      </form.Field>
      {choiceFields}
      <FieldGroup className="terminal-appearance-numbers grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
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
                自动根据背景明暗增强低对比度文字的可读性；关闭则保留原始颜色。
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
                onEdit()
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
                    推荐 4.5（WCAG AA）或 7.0（WCAG AAA）。数值越高文字越醒目。
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
                  onValueChange={(value) => {
                    field.handleChange(value ?? NaN)
                    onEdit()
                  }}
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
    </>
  )
}
