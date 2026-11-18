import { TERMINAL_THEME_CATALOG } from '../../../../../../shared/terminal-themes'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'

export function TerminalThemeFields({ form }: { form: TerminalAppearanceForm }) {
  return (
    <>
      {(['themeDark', 'themeLight'] as const).map((name) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <Field className="terminal-theme-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <span
                id={`terminal-${name}-label`}
                className="terminal-theme-label text-xs leading-5 font-medium text-foreground"
              >
                {name === 'themeDark' ? '深色模式主题' : '浅色模式主题'}
              </span>
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (value) field.handleChange(value)
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
                <SelectContent className="terminal-theme-content max-h-[min(16rem,var(--available-height))]">
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
      ))}
    </>
  )
}
