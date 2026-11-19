import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import { Card } from '@/components/ui/card'
import { InputNumber } from '@/components/ui/input-number'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TerminalAppearanceForm } from './use-terminal-appearance-form'
import { BACKGROUND_NUMBER_FIELDS, ENUM_FIELDS, NUMBER_FIELDS, SWITCH_FIELDS } from './fields'
import type { AppearanceGroup } from './fields'
import { TerminalSettingRow } from './TerminalSettingRow'
import { TerminalTypographyFields } from './TerminalTypographyFields'
import { TerminalThemeFields } from './TerminalThemeFields'

type NumberFieldSpec = (typeof NUMBER_FIELDS)[number] | (typeof BACKGROUND_NUMBER_FIELDS)[number]

function formatFieldError(errors: ({ message?: string } | undefined)[]): string | undefined {
  const messages = [...new Set(errors.map((error) => error?.message).filter(Boolean))]
  return messages.length ? messages.join(' ') : undefined
}

function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

export function TerminalAppearanceGroup({
  group,
  form,
  values,
  ready,
  saving,
}: {
  group: AppearanceGroup
  form: TerminalAppearanceForm
  values: TerminalAppearance
  ready: boolean
  saving: boolean
}) {
  const renderNumberField = ({ name, label, description, min, max, step }: NumberFieldSpec) => {
    const prefix = `terminal-${toKebabCase(name)}`
    return (
      <form.Field key={name} name={name}>
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          const errorMessage = field.state.meta.isTouched
            ? formatFieldError(field.state.meta.errors)
            : undefined
          const describedBy = errorMessage
            ? `terminal-${name}-description terminal-${name}-error`
            : `terminal-${name}-description`

          return (
            <TerminalSettingRow
              className={`${prefix}-row`}
              textClassName={`${prefix}-text`}
              labelId={`terminal-${name}-label`}
              label={label}
              labelClassName={`${prefix}-label`}
              descriptionId={`terminal-${name}-description`}
              description={description}
              descriptionClassName={`${prefix}-description tabular-nums`}
              invalid={invalid}
              error={
                errorMessage && (
                  <p
                    id={`terminal-${name}-error`}
                    className={`${prefix}-error text-xs text-destructive`}
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                )
              }
            >
              <InputNumber
                id={`terminal-${name}`}
                className={`${prefix}-input w-28 max-w-full shrink-0 font-mono tabular-nums`}
                min={min}
                max={max}
                step={step}
                disabled={!ready}
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
                  'aria-labelledby': `terminal-${name}-label`,
                  'aria-busy': saving,
                  'aria-invalid': invalid,
                  'aria-describedby': describedBy,
                }}
              />
            </TerminalSettingRow>
          )
        }}
      </form.Field>
    )
  }

  const numberFields = NUMBER_FIELDS.filter((field) => field.group === group.name).map(
    renderNumberField,
  )
  const backgroundFields =
    group.name === 'typography' ? BACKGROUND_NUMBER_FIELDS.map(renderNumberField) : null
  const choiceFields = ENUM_FIELDS.filter((field) => field.group === group.name).map(
    ({ name, label, options }) => {
      const prefix = `terminal-${toKebabCase(name)}`
      return (
        <form.Field key={name} name={name}>
          {(field) => (
            <TerminalSettingRow
              className={`${prefix}-row`}
              textClassName={`${prefix}-text`}
              labelId={`terminal-${name}-label`}
              label={label}
              labelClassName={`${prefix}-label`}
            >
              <ToggleGroup
                id={`terminal-${name}`}
                className={`${prefix}-options shrink-0`}
                variant="outline"
                spacing={0}
                disabled={!ready}
                value={[field.state.value]}
                aria-labelledby={`terminal-${name}-label`}
                aria-busy={saving}
                onBlur={field.handleBlur}
                onValueChange={([value]) => {
                  if (!value || !options.some(([option]) => option === value)) return
                  field.handleChange(value as typeof field.state.value)
                }}
              >
                {options.map(([value, text]) => (
                  <ToggleGroupItem className={`${prefix}-option`} key={value} value={value}>
                    {text}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </TerminalSettingRow>
          )}
        </form.Field>
      )
    },
  )

  return (
    <section
      key={group.name}
      className="terminal-appearance-group flex min-w-0 flex-col gap-2.5"
      aria-labelledby={`terminal-appearance-${group.name}-title`}
    >
      <h2
        id={`terminal-appearance-${group.name}-title`}
        className="terminal-appearance-group-title settings-section-title"
      >
        {group.label}
      </h2>
      <Card size="sm" className="terminal-appearance-card gap-0 divide-y divide-border py-0">
        {group.name === 'typography' ? (
          <TerminalTypographyFields
            form={form}
            values={values}
            ready={ready}
            saving={saving}
            numberFields={numberFields}
            backgroundFields={backgroundFields}
            choiceFields={choiceFields}
          />
        ) : (
          <>
            {numberFields}
            {choiceFields}
            {SWITCH_FIELDS.filter((field) => field.group === group.name).map(({ name, label }) => {
              const prefix = `terminal-${toKebabCase(name)}`
              return (
                <form.Field key={name} name={name}>
                  {(field) => (
                    <TerminalSettingRow
                      className={`${prefix}-row`}
                      textClassName={`${prefix}-text`}
                      labelId={`terminal-${name}-label`}
                      label={label}
                      labelClassName={`${prefix}-label`}
                    >
                      <Switch
                        id={`terminal-${name}`}
                        aria-labelledby={`terminal-${name}-label`}
                        aria-busy={saving}
                        className={`${prefix}-switch`}
                        checked={field.state.value}
                        disabled={!ready}
                        onBlur={field.handleBlur}
                        onCheckedChange={field.handleChange}
                      />
                    </TerminalSettingRow>
                  )}
                </form.Field>
              )
            })}
            {group.name === 'theme' && (
              <TerminalThemeFields form={form} ready={ready} saving={saving} />
            )}
          </>
        )}
      </Card>
    </section>
  )
}
