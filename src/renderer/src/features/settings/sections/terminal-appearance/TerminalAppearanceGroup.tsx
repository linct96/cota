import { cn } from '@/lib/utils'
import { type TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { NUMBER_FIELDS, ENUM_FIELDS, SWITCH_FIELDS, type AppearanceGroup } from './fields'
import { TerminalTypographyFields } from './TerminalTypographyFields'
import { TerminalThemeFields } from './TerminalThemeFields'

export function TerminalAppearanceGroup({
  group,
  form,
  values,
  onEdit,
  saveAppearance,
}: {
  group: AppearanceGroup
  form: TerminalAppearanceForm
  values: TerminalAppearance
  onEdit(): void
  saveAppearance(value: TerminalAppearance): Promise<void>
}) {
  const isGridNumberGroup = group.name === 'typography' || group.name === 'background'
  const numberFields = NUMBER_FIELDS.filter((field) => field.group === group.name).map(
    ({ name, label, min, max, step }) => (
      <form.Field key={name} name={name}>
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid

          const errorMessage = [
            ...new Set(
              (field.state.meta.isTouched ? field.state.meta.errors : [])
                .map((error) => error?.message)
                .filter(Boolean),
            ),
          ].join(' ')
          return (
            <Field
              className={cn(
                'terminal-appearance-number-field',
                isGridNumberGroup
                  ? 'gap-1.5'
                  : 'min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3',
              )}
              data-invalid={invalid}
            >
              <label
                htmlFor={`terminal-${name}`}
                className={cn(
                  'terminal-appearance-number-label text-xs leading-5 font-medium text-foreground',
                  !isGridNumberGroup && 'min-w-0 flex-1 basis-64',
                )}
              >
                {label}
                <span
                  id={`terminal-${name}-help`}
                  className="terminal-appearance-number-range ml-1 text-xs font-normal text-muted-foreground tabular-nums"
                >
                  ({min}–{max})
                </span>
              </label>
              <Input
                id={`terminal-${name}`}
                className={cn(
                  'terminal-appearance-number-input font-mono tabular-nums',
                  !isGridNumberGroup && 'w-28 max-w-full shrink-0',
                )}
                type="number"
                min={min}
                max={max}
                step={step}
                value={
                  Number.isNaN(field.state.value)
                    ? ''
                    : name === 'backgroundOpacity'
                      ? Number((1 - field.state.value).toFixed(2))
                      : field.state.value
                }
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    name === 'backgroundOpacity'
                      ? 1 - event.target.valueAsNumber
                      : event.target.valueAsNumber,
                  )
                }
                aria-invalid={invalid}
                aria-describedby={`terminal-${name}-help${name === 'backgroundOpacity' ? ' terminal-background-opacity-description' : ''} terminal-${name}-error`}
              />
              {name === 'backgroundOpacity' && (
                <p
                  id="terminal-background-opacity-description"
                  className="terminal-appearance-number-description text-xs text-muted-foreground"
                >
                  0 为不透明，1 为完全透明
                </p>
              )}
              {errorMessage && (
                <p
                  id={`terminal-${name}-error`}
                  className={cn(
                    'terminal-appearance-number-error text-xs text-destructive',
                    !isGridNumberGroup && 'basis-full',
                  )}
                  role="alert"
                >
                  {errorMessage}
                </p>
              )}
            </Field>
          )
        }}
      </form.Field>
    ),
  )
  const choiceFields = ENUM_FIELDS.filter((field) => field.group === group.name).map(
    ({ name, label, options }) => (
      <form.Field key={name} name={name}>
        {(field) => (
          <Field className="terminal-appearance-choice-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <p
              id={`terminal-${name}-label`}
              className="terminal-appearance-choice-label min-w-0 flex-1 basis-64 text-xs leading-5 font-medium text-foreground"
            >
              {label}
            </p>
            <ToggleGroup
              className="terminal-appearance-choices"
              variant="outline"
              spacing={0}
              value={[field.state.value]}
              aria-labelledby={`terminal-${name}-label`}
              onBlur={field.handleBlur}
              onValueChange={([value]) => {
                if (!value || !options.some(([option]) => option === value)) return
                field.handleChange(value as typeof field.state.value)
                onEdit()
              }}
            >
              {options.map(([value, text]) => (
                <ToggleGroupItem className="terminal-appearance-choice" key={value} value={value}>
                  {text}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}
      </form.Field>
    ),
  )
  return (
    <section
      key={group.name}
      className="terminal-appearance-group flex min-w-0 flex-col gap-2.5"
      aria-labelledby={`terminal-appearance-${group.name}-title`}
    >
      <h3
        id={`terminal-appearance-${group.name}-title`}
        className="terminal-appearance-group-title settings-section-title"
      >
        {group.label}
      </h3>
      <Card size="sm" className="terminal-appearance-card gap-0 divide-y divide-border py-0">
        {group.name === 'typography' ? (
          <TerminalTypographyFields
            form={form}
            values={values}
            onEdit={onEdit}
            numberFields={numberFields}
            choiceFields={choiceFields}
          />
        ) : (
          <>
            {numberFields.length > 0 &&
              (group.name === 'cursor' ? (
                numberFields
              ) : (
                <FieldGroup className="terminal-appearance-numbers grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3">
                  {numberFields}
                </FieldGroup>
              ))}
            {choiceFields}
            {SWITCH_FIELDS.filter((field) => field.group === group.name).map(({ name, label }) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field className="terminal-appearance-switch-field min-h-7 flex-row items-center justify-between gap-4 px-4 py-3">
                    <div className="terminal-appearance-switch-text flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        id={`terminal-${name}-label`}
                        className="terminal-appearance-switch-label text-xs leading-5 font-medium text-foreground"
                      >
                        {label}
                      </span>
                      {name === 'windowBlur' &&
                        values.windowBlur !== window.desktop.initialAppearance.windowBlur && (
                          <FieldDescription className="terminal-blur-restart-help">
                            重启 Cota，以应用窗口背景模糊设置。提高背景透明度可显现模糊效果。
                          </FieldDescription>
                        )}
                    </div>
                    <Switch
                      id={`terminal-${name}`}
                      aria-labelledby={`terminal-${name}-label`}
                      className="terminal-appearance-switch"
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onCheckedChange={(value) => {
                        field.handleChange(value)
                        onEdit()
                      }}
                      disabled={
                        name === 'windowBlur' &&
                        !['darwin', 'win32'].includes(window.desktop.platform)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            ))}
            {group.name === 'theme' && (
              <TerminalThemeFields
                form={form}
                values={values}
                onEdit={onEdit}
                saveAppearance={saveAppearance}
              />
            )}
          </>
        )}
      </Card>
    </section>
  )
}
