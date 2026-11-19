import { useState } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { InputNumber } from '@/components/ui/input-number'
import { Separator } from '@/components/ui/separator'
import {
  SYSTEM_DEFAULT_TERMINAL_FONT,
  terminalAppearanceSchema,
} from '../../../../../../shared/terminal-appearance'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { FONT_OPTIONS } from './fields'
import { TerminalSettingRow } from './TerminalSettingRow'

function formatFontLabel(font: string): string {
  return font === SYSTEM_DEFAULT_TERMINAL_FONT ? '系统默认' : font
}

function formatFieldError(errors?: ({ message?: string } | undefined)[]): string | undefined {
  const messages = [...new Set(errors?.map((error) => error?.message).filter(Boolean))]
  return messages.length ? messages.join(' ') : undefined
}

/** 终端字体与字号设置行，挂载于常规分组并联动外观表单状态。 */
export function TerminalFontFamilyField({
  form,
  ready,
  saving,
}: {
  form: TerminalAppearanceForm
  ready: boolean
  saving: boolean
}) {
  const [query, setQuery] = useState('')

  return (
    <>
      <form.Field name="fontFamily">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          const fontFamilyError = field.state.meta.isTouched
            ? formatFieldError(field.state.meta.errors)
            : undefined
          const presetFonts = Array.from(
            new Set([
              ...FONT_OPTIONS,
              ...(FONT_OPTIONS.includes(field.state.value) ? [] : [field.state.value]),
            ]),
          )
          const trimmedQuery = query.trim()
          const hasCustomCandidate =
            trimmedQuery.length > 0 &&
            trimmedQuery !== '系统默认' &&
            !presetFonts.includes(trimmedQuery) &&
            terminalAppearanceSchema.shape.fontFamily.safeParse(trimmedQuery).success
          const fonts = hasCustomCandidate ? [...presetFonts, trimmedQuery] : presetFonts

          return (
            <TerminalSettingRow
              className="terminal-font-row"
              textClassName="terminal-font-row-text"
              labelId="terminal-font-family-label"
              label="字体"
              labelClassName="terminal-font-row-label"
              invalid={invalid}
              error={
                fontFamilyError && (
                  <p
                    id="terminal-font-family-error"
                    className="terminal-font-family-error text-xs text-destructive"
                    role="alert"
                  >
                    {fontFamilyError}
                  </p>
                )
              }
            >
              <Combobox
                autoHighlight
                disabled={!ready}
                items={fonts}
                value={field.state.value}
                inputValue={query}
                itemToStringLabel={formatFontLabel}
                onInputValueChange={setQuery}
                onOpenChange={(open) => {
                  if (!open) setQuery('')
                }}
                onValueChange={(value) => {
                  if (value === null) return
                  field.handleChange(value)
                  setQuery('')
                }}
              >
                <ComboboxTrigger
                  id="terminal-font-family"
                  aria-labelledby="terminal-font-family-label"
                  aria-busy={saving}
                  aria-invalid={invalid}
                  aria-describedby={fontFamilyError ? 'terminal-font-family-error' : undefined}
                  disabled={!ready}
                  className="terminal-font-family-select flex h-7 w-fit min-w-0 max-w-56 items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 font-mono text-xs/relaxed whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_.ui-combobox-trigger-icon]:text-muted-foreground"
                  title={formatFontLabel(field.state.value)}
                  onBlur={field.handleBlur}
                >
                  <span className="terminal-font-family-value min-w-0 flex-1 truncate text-left">
                    {formatFontLabel(field.state.value)}
                  </span>
                </ComboboxTrigger>
                <ComboboxContent
                  align="end"
                  className="terminal-font-options flex min-w-(--anchor-width) flex-col"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                      event.preventDefault()
                      event.stopPropagation()
                    }
                  }}
                >
                  <div className="terminal-font-search shrink-0 p-1">
                    <ComboboxInput
                      className="terminal-font-search-input"
                      placeholder="搜索或输入自定义字体…"
                    />
                  </div>
                  <Separator className="terminal-font-search-separator" />
                  <ComboboxEmpty className="terminal-font-empty shrink-0">
                    未找到匹配的字体
                  </ComboboxEmpty>
                  <ComboboxList className="terminal-font-options-list min-h-0">
                    {(font: string) => {
                      const isCustomCandidate = hasCustomCandidate && font === trimmedQuery
                      return (
                        <ComboboxItem
                          className="terminal-font-option font-mono"
                          key={font}
                          value={font}
                          title={formatFontLabel(font)}
                        >
                          <span className="terminal-font-option-label block truncate">
                            {isCustomCandidate ? `使用自定义：${font}` : formatFontLabel(font)}
                          </span>
                        </ComboboxItem>
                      )
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </TerminalSettingRow>
          )
        }}
      </form.Field>

      <form.Field name="fontSize">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          const fontSizeError = field.state.meta.isTouched
            ? formatFieldError(field.state.meta.errors)
            : undefined

          return (
            <TerminalSettingRow
              className="terminal-font-size-row"
              textClassName="terminal-font-size-text"
              labelId="terminal-fontSize-label"
              label="字号"
              labelClassName="terminal-font-size-label"
              descriptionId="terminal-fontSize-description"
              description="范围 8–48 px。"
              descriptionClassName="terminal-font-size-description"
              invalid={invalid}
              error={
                fontSizeError && (
                  <p
                    id="terminal-fontSize-error"
                    className="terminal-font-size-error text-xs text-destructive"
                    role="alert"
                  >
                    {fontSizeError}
                  </p>
                )
              }
            >
              <InputNumber
                id="terminal-fontSize"
                className="terminal-font-size-input w-28 max-w-full shrink-0 font-mono tabular-nums"
                min={8}
                max={48}
                step={1}
                disabled={!ready}
                value={Number.isNaN(field.state.value) ? null : field.state.value}
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  field.handleChange(value ?? NaN)
                }}
                inputProps={{
                  'aria-labelledby': 'terminal-fontSize-label',
                  'aria-busy': saving,
                  'aria-invalid': invalid,
                  'aria-describedby': fontSizeError
                    ? 'terminal-fontSize-description terminal-fontSize-error'
                    : 'terminal-fontSize-description',
                }}
              />
            </TerminalSettingRow>
          )
        }}
      </form.Field>
    </>
  )
}
