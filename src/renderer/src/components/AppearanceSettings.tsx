import { Fragment, useRef, useState, useSyncExternalStore } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useWorkspace } from '../store'
import type { Preferences, ThemePreference } from '../../../shared/contracts'
import {
  DEFAULT_INTERFACE_COLORS,
  interfaceColorSchema,
  type InterfaceColorRole,
} from '../../../shared/interface-colors'
import { observeDocumentTheme, resolveDocumentColor } from '../lib/theme'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { ColorInput } from './ui/color-input'
import { Separator } from './ui/separator'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const colorFields: { role: InterfaceColorRole; label: string; description: string }[] = [
  { role: 'primary', label: '主题色', description: '设置当前模式下主要按钮与强调元素的颜色。' },
  { role: 'background', label: '背景色', description: '设置当前模式下的界面底色。' },
  { role: 'foreground', label: '前景色', description: '设置当前模式下主要文字与图标的颜色。' },
]
const colorInputSchema = z
  .string()
  .trim()
  .pipe(interfaceColorSchema.or(z.literal('')))
  .optional()

export function AppearanceSettings() {
  const theme = useWorkspace((state) => state.preferences.theme)
  const colors = useWorkspace((state) => state.preferences.interfaceColors)
  const ready = useWorkspace((state) => state.ready)
  const dark = useSyncExternalStore(observeDocumentTheme, () =>
    document.documentElement.classList.contains('dark'),
  )
  const mode = dark ? 'dark' : 'light'
  const form = useForm({ defaultValues: colors })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const pending = useRef<Promise<unknown>>(Promise.resolve())

  async function changeAppearance(field: string, update: (value: Preferences) => Preferences) {
    if (!useWorkspace.getState().ready) return
    setSaving(true)
    const operation = pending.current.then(async () => {
      setErrors((previous) => ({ ...previous, [field]: undefined }))
      try {
        const state = useWorkspace.getState()
        const next = update(state.preferences)
        if (next !== state.preferences) await state.savePreferences(next)
        return next
      } catch (cause) {
        setErrors((previous) => ({
          ...previous,
          [field]: cause instanceof Error ? cause.message : '保存失败，请重试。',
        }))
      }
    })
    pending.current = operation
    const saved = await operation
    if (pending.current === operation) setSaving(false)
    return saved
  }

  async function resetAppearance() {
    const saved = await changeAppearance('reset', (preferences) => ({
      ...preferences,
      theme: 'system',
      interfaceColors: structuredClone(DEFAULT_INTERFACE_COLORS),
    }))
    if (saved) {
      form.reset(saved.interfaceColors)
      setErrors({})
    }
  }

  function changeTheme(value: ThemePreference) {
    if (value !== theme)
      void changeAppearance('theme', (preferences) => ({ ...preferences, theme: value }))
  }

  function changeColor(role: InterfaceColorRole, value: string | undefined) {
    const parsed = colorInputSchema.safeParse(value)
    if (!parsed.success) return
    const color = parsed.data || undefined
    void changeAppearance(`${mode}.${role}`, (preferences) => {
      if (preferences.interfaceColors[mode][role] === color) return preferences
      const overrides = { ...preferences.interfaceColors[mode] }
      if (color) overrides[role] = color
      else delete overrides[role]
      return {
        ...preferences,
        interfaceColors: { ...preferences.interfaceColors, [mode]: overrides },
      }
    })
  }
  return (
    <section
      className="appearance-settings flex flex-col gap-6"
      aria-labelledby="appearance-settings-title"
    >
      <header className="appearance-settings-header flex flex-wrap items-start justify-between gap-3">
        <div className="appearance-settings-heading typeset">
          <h1 id="appearance-settings-title" className="appearance-settings-title">
            外观
          </h1>
        </div>
        <Button
          type="button"
          className="appearance-settings-reset"
          variant="ghost"
          size="lg"
          disabled={!ready || saving}
          aria-describedby={errors.reset ? 'appearance-reset-error' : undefined}
          onClick={() => void resetAppearance()}
        >
          恢复默认
        </Button>
      </header>
      {errors.reset && (
        <p
          id="appearance-reset-error"
          className="appearance-reset-error text-xs text-destructive"
          role="alert"
        >
          {errors.reset}
        </p>
      )}
      <Card className="appearance-settings-card">
        <div
          className="appearance-theme-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 data-[invalid=true]:text-destructive"
          data-invalid={!!errors.theme}
        >
          <div className="appearance-theme-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <p
              id="appearance-theme-label"
              className="appearance-theme-label text-sm leading-5 font-medium"
            >
              模式
            </p>
            <p
              id="appearance-theme-help"
              className="appearance-theme-description text-xs text-muted-foreground"
            >
              选择浅色或深色外观，自动模式跟随系统设置。
            </p>
          </div>
          <div className="appearance-theme-control flex min-w-0 flex-col gap-2">
            <ToggleGroup
              className="appearance-theme-options"
              variant="outline"
              spacing={0}
              size="lg"
              value={[theme]}
              disabled={!ready || saving}
              aria-labelledby="appearance-theme-label"
              aria-describedby={
                errors.theme
                  ? 'appearance-theme-help appearance-theme-error'
                  : 'appearance-theme-help'
              }
              aria-invalid={!!errors.theme}
              onValueChange={([value]) => {
                if (value === 'system' || value === 'light' || value === 'dark')
                  void changeTheme(value)
              }}
            >
              <ToggleGroupItem className="appearance-theme-option" value="system">
                <Monitor className="appearance-theme-icon" aria-hidden="true" />
                自动
              </ToggleGroupItem>
              <ToggleGroupItem className="appearance-theme-option" value="light">
                <Sun className="appearance-theme-icon" aria-hidden="true" />
                浅色
              </ToggleGroupItem>
              <ToggleGroupItem className="appearance-theme-option" value="dark">
                <Moon className="appearance-theme-icon" aria-hidden="true" />
                深色
              </ToggleGroupItem>
            </ToggleGroup>
            {errors.theme && (
              <p
                id="appearance-theme-error"
                className="appearance-theme-error max-w-60 text-xs text-destructive"
                role="alert"
              >
                {errors.theme}
              </p>
            )}
          </div>
        </div>
        {colorFields.map(({ role, label, description }) => (
          <Fragment key={`${mode}.${role}`}>
            <Separator className="appearance-color-separator" />
            <form.Field name={`${mode}.${role}`} validators={{ onChange: colorInputSchema }}>
              {(field) => {
                const invalid = field.state.meta.errors.length > 0
                const saveError = errors[`${mode}.${role}`]
                const errorId = `appearance-${role}-error`
                const resolvedColor = resolveDocumentColor(role)

                const errorMessage =
                  (invalid ? undefined : saveError) ||
                  [
                    ...new Set(
                      field.state.meta.errors.map((error) => error?.message).filter(Boolean),
                    ),
                  ].join(' ')
                return (
                  <div
                    className="appearance-color-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 data-[invalid=true]:text-destructive"
                    data-invalid={invalid || !!saveError}
                  >
                    <div className="appearance-color-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                      <label
                        htmlFor={`appearance-${role}`}
                        className="appearance-color-label text-sm leading-5 font-medium"
                      >
                        {label}
                      </label>
                      <p
                        id={`appearance-${role}-help`}
                        className="appearance-color-description text-xs text-muted-foreground"
                      >
                        {description}
                      </p>
                    </div>
                    <div className="appearance-color-control flex min-w-0 flex-col gap-2">
                      <ColorInput
                        id={`appearance-${role}`}
                        className="appearance-color-input"
                        value={field.state.value ?? resolvedColor}
                        fallbackColor={resolvedColor}
                        pickerLabel={`选择${label}`}
                        placeholder="默认"
                        disabled={!ready}
                        aria-invalid={invalid || !!saveError}
                        aria-describedby={
                          invalid || saveError
                            ? `appearance-${role}-help ${errorId}`
                            : `appearance-${role}-help`
                        }
                        onBlur={() => {
                          const value = field.state.value
                          field.handleBlur()
                          if (value === '') field.handleChange(undefined)
                          if (saveError) changeColor(role, value)
                        }}
                        onValueChange={(value) => {
                          field.handleChange(value)
                          changeColor(role, value)
                        }}
                      />
                      {errorMessage && (
                        <p
                          id={errorId}
                          className="appearance-color-error max-w-60 text-xs text-destructive"
                          role="alert"
                        >
                          {errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }}
            </form.Field>
          </Fragment>
        ))}
      </Card>
    </section>
  )
}
