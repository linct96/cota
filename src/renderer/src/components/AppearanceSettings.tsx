import { useRef, useState, useSyncExternalStore } from 'react'
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
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { ColorInput } from './ui/color-input'
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
      <header className="appearance-settings-header flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="appearance-settings-heading flex flex-col gap-1">
          <h1
            id="appearance-settings-title"
            className="appearance-settings-title settings-page-title"
          >
            外观
          </h1>
          <p className="appearance-settings-subtitle text-xs text-muted-foreground">
            自定义应用明暗主题模式与界面核心语义配色。
          </p>
        </div>
        <Button
          type="button"
          className="appearance-settings-reset"
          variant="ghost"
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
      <Card size="sm" className="appearance-settings-card">
        <div
          className="appearance-theme-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 data-[invalid=true]:text-destructive"
          data-invalid={!!errors.theme}
        >
          <div className="appearance-theme-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <p
              id="appearance-theme-label"
              className="appearance-theme-label text-xs leading-5 font-medium text-foreground"
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
      </Card>

      <section
        className="appearance-colors-section flex flex-col gap-2.5"
        aria-labelledby="appearance-colors-title"
      >
        <div className="appearance-colors-header flex items-center justify-between gap-2">
          <h2
            id="appearance-colors-title"
            className="appearance-colors-title settings-section-title"
          >
            界面配色
          </h2>
          <Badge variant="secondary" className="appearance-colors-mode-badge">
            {mode === 'dark' ? '当前：深色模式' : '当前：浅色模式'}
          </Badge>
        </div>
        <div className="appearance-color-grid grid grid-cols-1 gap-3 sm:grid-cols-3">
          {colorFields.map(({ role, label, description }) => (
            <form.Field
              key={`${mode}.${role}`}
              name={`${mode}.${role}`}
              validators={{ onChange: colorInputSchema }}
            >
              {(field) => {
                const invalid = field.state.meta.errors.length > 0
                const saveError = errors[`${mode}.${role}`]
                const errorId = `appearance-${role}-error`
                const resolvedColor = resolveDocumentColor(role)
                const isCustom = Boolean(field.state.value)

                const errorMessage =
                  (invalid ? undefined : saveError) ||
                  [
                    ...new Set(
                      field.state.meta.errors.map((error) => error?.message).filter(Boolean),
                    ),
                  ].join(' ')
                return (
                  <Card
                    size="sm"
                    className="appearance-color-row justify-between px-4 data-[invalid=true]:ring-destructive/40"
                    data-invalid={invalid || !!saveError}
                  >
                    <div className="appearance-color-text flex min-w-0 flex-col gap-1">
                      <div className="appearance-color-heading flex items-center justify-between gap-2">
                        <label
                          htmlFor={`appearance-${role}`}
                          className="appearance-color-label text-xs leading-5 font-medium text-foreground"
                        >
                          {label}
                        </label>
                        {isCustom ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="appearance-color-clear text-muted-foreground hover:text-foreground"
                            disabled={!ready || saving}
                            onClick={() => {
                              field.handleChange(undefined)
                              changeColor(role, undefined)
                            }}
                          >
                            重置
                          </Button>
                        ) : (
                          <span className="appearance-color-default-tag text-xs text-muted-foreground">
                            默认
                          </span>
                        )}
                      </div>
                      <p
                        id={`appearance-${role}-help`}
                        className="appearance-color-description text-xs text-muted-foreground"
                      >
                        {description}
                      </p>
                    </div>
                    <div className="appearance-color-control flex min-w-0 flex-col gap-1.5 pt-1">
                      <ColorInput
                        id={`appearance-${role}`}
                        className="appearance-color-input w-full justify-between"
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
                          className="appearance-color-error text-xs text-destructive"
                          role="alert"
                        >
                          {errorMessage}
                        </p>
                      )}
                    </div>
                  </Card>
                )
              }}
            </form.Field>
          ))}
        </div>
      </section>
    </section>
  )
}
