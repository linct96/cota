import { ChevronDown } from 'lucide-react'
import {
  TERMINAL_COLOR_KEYS,
  type TerminalAppearance,
} from '../../../../../../shared/terminal-appearance'
import { TERMINAL_THEME_CATALOG } from '../../../../../../shared/terminal-themes'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { COLOR_LABELS } from './fields'

const hexSwatchPattern = /^#[\da-f]{6}$/i

export function TerminalThemeFields({
  form,
  values,
  onEdit,
  saveAppearance,
}: {
  form: TerminalAppearanceForm
  values: TerminalAppearance
  onEdit(): void
  saveAppearance(value: TerminalAppearance): Promise<void>
}) {
  return (
    <>
      {(['themeDark', 'themeLight'] as const).map((name) =>
        name === 'themeLight' && !values.separateLightTheme ? null : (
          <form.Field key={name} name={name}>
            {(field) => (
              <Field className="terminal-theme-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <span
                  id={`terminal-${name}-label`}
                  className="terminal-theme-label text-xs leading-5 font-medium text-foreground"
                >
                  {name === 'themeDark' ? '深色模式配色' : '浅色模式配色'}
                </span>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value) {
                      field.handleChange(value)
                      onEdit()
                    }
                  }}
                >
                  <SelectTrigger
                    id={`terminal-${name}`}
                    aria-labelledby={`terminal-${name}-label`}
                    className="terminal-theme-trigger min-w-0 max-w-full"
                    onBlur={field.handleBlur}
                  >
                    <SelectValue className="terminal-theme-value">
                      {field.state.value === 'auto' ? '跟随应用主题' : field.state.value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="terminal-theme-content">
                    <SelectGroup className="terminal-theme-items">
                      <SelectItem className="terminal-theme-item" value="auto">
                        跟随应用主题
                      </SelectItem>
                      {Object.keys(TERMINAL_THEME_CATALOG)
                        .sort()
                        .map((theme) => (
                          <SelectItem className="terminal-theme-item" key={theme} value={theme}>
                            {theme}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        ),
      )}
      <Collapsible className="terminal-color-overrides px-4 py-2">
        <CollapsibleTrigger
          className="terminal-color-overrides-trigger group/terminal-colors w-full justify-between px-1"
          render={<Button type="button" variant="ghost" />}
        >
          自定义颜色与 ANSI 调色板
          <ChevronDown
            className="terminal-color-overrides-chevron transition-transform group-data-panel-open/terminal-colors:rotate-180"
            data-icon="inline-end"
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted className="terminal-color-overrides-content pb-2">
          <p className="terminal-color-overrides-help mt-2 px-1 text-xs text-muted-foreground">
            留空沿用配色主题；输入 #RRGGBB 覆盖对应颜色。
          </p>
          <FieldGroup className="terminal-color-fields mt-3 grid grid-cols-2 gap-3 px-1 sm:grid-cols-3 md:grid-cols-4">
            {TERMINAL_COLOR_KEYS.map((key, index) => (
              <form.Field key={key} name={`colors.${key}`}>
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  const currentHex = field.state.value || ''
                  const validHex = hexSwatchPattern.test(currentHex)

                  const errorMessage = [
                    ...new Set(
                      (field.state.meta.isTouched ? field.state.meta.errors : [])
                        .map((error) => error?.message)
                        .filter(Boolean),
                    ),
                  ].join(' ')
                  return (
                    <Field className="terminal-color-field gap-1.5" data-invalid={invalid}>
                      <label
                        htmlFor={`terminal-color-${key}`}
                        className="terminal-color-label flex items-center justify-between gap-1.5 text-xs leading-5 font-medium text-foreground"
                      >
                        <span className="terminal-color-label-text truncate">
                          {COLOR_LABELS[index]}
                        </span>
                        {validHex && (
                          <span
                            className="terminal-color-swatch size-3 shrink-0 rounded-xs border border-border"
                            style={{ backgroundColor: currentHex }}
                            aria-hidden="true"
                          />
                        )}
                      </label>
                      <Input
                        id={`terminal-color-${key}`}
                        className="terminal-color-input font-mono"
                        value={currentHex}
                        placeholder="沿用主题"
                        maxLength={7}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          const value = event.target.value
                          if (value) field.handleChange(value)
                          else {
                            form.setFieldValue('colors', (colors) => {
                              const next = { ...colors }
                              delete next[key]
                              return next
                            })
                            void saveAppearance(form.state.values)
                          }
                        }}
                        aria-invalid={invalid}
                        aria-describedby={`terminal-color-${key}-error`}
                      />
                      {errorMessage && (
                        <p
                          id={`terminal-color-${key}-error`}
                          className="terminal-color-error text-xs text-destructive"
                          role="alert"
                        >
                          {errorMessage}
                        </p>
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            ))}
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
