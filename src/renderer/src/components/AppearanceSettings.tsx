import { useRef, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useWorkspace } from '../store'
import type { ThemePreference } from '../../../shared/contracts'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export function AppearanceSettings() {
  const theme = useWorkspace((state) => state.preferences.theme)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  async function changeTheme(value: ThemePreference) {
    if (pending.current || value === theme) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    try {
      await useWorkspace
        .getState()
        .savePreferences({ ...useWorkspace.getState().preferences, theme: value })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <section
      className="appearance-settings flex flex-col gap-6"
      aria-labelledby="appearance-settings-title"
    >
      <h3
        id="appearance-settings-title"
        className="appearance-settings-title text-base font-semibold"
      >
        外观
      </h3>
      <FieldGroup className="appearance-settings-fields">
        <Field className="appearance-theme-field" disabled={!ready || saving}>
          <FieldLabel id="appearance-theme-label" className="appearance-theme-label">
            主题
          </FieldLabel>
          <FieldDescription
            id="appearance-theme-description"
            className="appearance-theme-description"
          >
            选择应用主题；自动模式跟随系统的浅色或深色外观。
          </FieldDescription>
          <ToggleGroup
            className="appearance-theme-options"
            variant="outline"
            spacing={0}
            size="lg"
            value={[theme]}
            aria-labelledby="appearance-theme-label"
            aria-describedby="appearance-theme-description"
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
          <FieldError className="appearance-theme-error">{error}</FieldError>
        </Field>
      </FieldGroup>
    </section>
  )
}
