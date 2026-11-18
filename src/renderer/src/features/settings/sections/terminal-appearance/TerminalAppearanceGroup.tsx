import { cn } from '@/lib/utils'
import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import { Card } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { InputNumber } from '@/components/ui/input-number'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { BACKGROUND_NUMBER_FIELDS, ENUM_FIELDS, NUMBER_FIELDS, SWITCH_FIELDS } from './fields'
import type { AppearanceGroup } from './fields'
import { TerminalTypographyFields } from './TerminalTypographyFields'
import { TerminalThemeFields } from './TerminalThemeFields'

type NumberFieldSpec = (typeof NUMBER_FIELDS)[number] | (typeof BACKGROUND_NUMBER_FIELDS)[number]

export function TerminalAppearanceGroup({
  group,
  form,
  values,
}: {
  group: AppearanceGroup
  form: TerminalAppearanceForm
  values: TerminalAppearance
}) {
  const isGridNumberGroup = group.name === 'typography'
  const renderNumberField = ({ name, label, min, max, step }: NumberFieldSpec, grid: boolean) => (
    <form.Field key={name} name={name}>
      {(field) => {
        const invalid = field.state.meta.isTouched && !field.state.meta.isValid
        return (
          <Field
            className={cn(
              'terminal-appearance-number-field',
              grid
                ? 'gap-1.5'
                : 'min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3',
            )}
            data-invalid={invalid}
          >
            <FieldLabel
              htmlFor={`terminal-${name}`}
              className={cn(
                'terminal-appearance-number-label inline-block text-xs leading-5 font-medium text-foreground',
                !grid && 'min-w-0 flex-1 basis-64',
              )}
            >
              {label}
              <span
                id={`terminal-${name}-help`}
                className="terminal-appearance-number-range ml-1 text-xs font-normal text-muted-foreground tabular-nums"
              >
                ({min}–{max})
              </span>
            </FieldLabel>
            <InputNumber
              id={`terminal-${name}`}
              className={cn(
                'terminal-appearance-number-input font-mono tabular-nums',
                !grid && 'w-28 max-w-full shrink-0',
              )}
              min={min}
              max={max}
              step={step}
              value={
                Number.isNaN(field.state.value)
                  ? null
                  : name === 'backgroundOpacity'
                    ? Number((1 - field.state.value).toFixed(2))
                    : field.state.value
              }
              onBlur={field.handleBlur}
              onValueChange={(value) =>
                field.handleChange(
                  value === null ? NaN : name === 'backgroundOpacity' ? 1 - value : value,
                )
              }
              inputProps={{
                'aria-invalid': invalid,
                'aria-describedby': `terminal-${name}-help terminal-${name}-error`,
              }}
            />
            <FieldError
              id={`terminal-${name}-error`}
              className={cn('terminal-appearance-number-error', !grid && 'basis-full')}
              errors={field.state.meta.isTouched ? field.state.meta.errors : []}
            />
          </Field>
        )
      }}
    </form.Field>
  )
  const numberFields = NUMBER_FIELDS.filter((field) => field.group === group.name).map((field) =>
    renderNumberField(field, isGridNumberGroup),
  )
  const backgroundFields =
    group.name === 'typography'
      ? BACKGROUND_NUMBER_FIELDS.map((field) => renderNumberField(field, true))
      : null
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
            numberFields={numberFields}
            backgroundFields={backgroundFields}
            choiceFields={choiceFields}
          />
        ) : (
          <>
            {numberFields}
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
                    </div>
                    <Switch
                      id={`terminal-${name}`}
                      aria-labelledby={`terminal-${name}-label`}
                      className="terminal-appearance-switch"
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onCheckedChange={field.handleChange}
                    />
                  </Field>
                )}
              </form.Field>
            ))}
            {group.name === 'theme' && <TerminalThemeFields form={form} />}
          </>
        )}
      </Card>
    </section>
  )
}
