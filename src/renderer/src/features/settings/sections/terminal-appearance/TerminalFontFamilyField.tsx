import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { FieldError } from '@/components/ui/field'
import { InputNumber } from '@/components/ui/input-number'
import { Separator } from '@/components/ui/separator'
import {
  SYSTEM_DEFAULT_TERMINAL_FONT,
  terminalAppearanceSchema,
} from '../../../../../../shared/terminal-appearance'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { FONT_OPTIONS } from './fields'

function formatFontLabel(font: string): string {
  return font === SYSTEM_DEFAULT_TERMINAL_FONT ? '系统默认' : font
}

/** 终端字体与字号选择行，挂载于常规分组并联动外观表单状态。 */
export function TerminalFontFamilyField({ form }: { form: TerminalAppearanceForm }) {
  const [query, setQuery] = useState('')

  return (
    <div className="terminal-font-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="terminal-font-row-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
        <span
          id="terminal-font-row-label"
          className="terminal-font-row-label text-xs leading-5 font-medium text-foreground"
        >
          字体与字号
        </span>
        <form.Subscribe
          selector={(state) => [state.fieldMeta.fontFamily, state.fieldMeta.fontSize] as const}
        >
          {([fontFamilyMeta, fontSizeMeta]) => (
            <>
              {fontFamilyMeta?.isTouched && (
                <FieldError
                  id="terminal-font-family-error"
                  className="terminal-font-family-error"
                  errors={fontFamilyMeta.errors}
                />
              )}
              {fontSizeMeta?.isTouched && (
                <FieldError
                  id="terminal-fontSize-error"
                  className="terminal-font-size-error"
                  errors={fontSizeMeta.errors}
                />
              )}
            </>
          )}
        </form.Subscribe>
      </div>
      <div className="terminal-font-controls flex min-h-7 max-w-full flex-wrap items-center gap-2">
        <form.Field name="fontFamily">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
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
              <Combobox
                autoHighlight
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
                  render={<Button type="button" variant="outline" />}
                  aria-label="字体"
                  aria-invalid={invalid}
                  aria-describedby={invalid ? 'terminal-font-family-error' : undefined}
                  className="terminal-font-family-select min-w-0 max-w-56 justify-between font-mono font-normal"
                  title={formatFontLabel(field.state.value)}
                  onBlur={field.handleBlur}
                >
                  <span className="terminal-font-family-value min-w-0 truncate">
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
            )
          }}
        </form.Field>
        <form.Field name="fontSize">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <InputNumber
                id="terminal-fontSize"
                className="terminal-font-size-input w-24 max-w-full shrink-0 font-mono tabular-nums"
                min={8}
                max={48}
                step={1}
                value={Number.isNaN(field.state.value) ? null : field.state.value}
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  field.handleChange(value ?? NaN)
                }}
                inputProps={{
                  'aria-label': '字号 (8–48)',
                  'aria-invalid': invalid,
                  'aria-describedby': invalid ? 'terminal-fontSize-error' : undefined,
                  title: '字号 (8–48)',
                }}
              />
            )
          }}
        </form.Field>
      </div>
    </div>
  )
}
