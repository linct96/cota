import { TERMINAL_THEME_CATALOG } from '../../../../../../shared/terminal-themes'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { TerminalSettingRow } from './TerminalSettingRow'

const THEME_OPTIONS = [
  { value: 'auto', label: '跟随应用主题' },
  ...Object.keys(TERMINAL_THEME_CATALOG)
    .sort()
    .map((theme) => ({ value: theme, label: theme })),
]

export function TerminalThemeFields({
  form,
  ready,
  saving,
}: {
  form: TerminalAppearanceForm
  ready: boolean
  saving: boolean
}) {
  return (
    <>
      {(['themeDark', 'themeLight'] as const).map((name) => {
        const prefix = name === 'themeDark' ? 'terminal-theme-dark' : 'terminal-theme-light'
        return (
          <form.Field key={name} name={name}>
            {(field) => (
              <TerminalSettingRow
                className={`${prefix}-row`}
                textClassName={`${prefix}-text`}
                labelId={`terminal-${name}-label`}
                label={name === 'themeDark' ? '深色模式主题' : '浅色模式主题'}
                labelClassName={`${prefix}-label`}
              >
                <Select
                  items={THEME_OPTIONS}
                  value={field.state.value}
                  disabled={!ready}
                  onValueChange={(value) => {
                    if (value) field.handleChange(value)
                  }}
                >
                  <SelectTrigger
                    id={`terminal-${name}`}
                    aria-labelledby={`terminal-${name}-label`}
                    aria-busy={saving}
                    className={`${prefix}-trigger min-w-0 max-w-64`}
                    onBlur={field.handleBlur}
                  >
                    <SelectValue className={`${prefix}-value min-w-0 truncate`} />
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    className={`${prefix}-content max-h-[min(16rem,var(--available-height))]`}
                  >
                    <SelectGroup className={`${prefix}-items`}>
                      {THEME_OPTIONS.map((option) => (
                        <SelectItem
                          className={`${prefix}-item`}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </TerminalSettingRow>
            )}
          </form.Field>
        )
      })}
    </>
  )
}
