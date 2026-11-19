import { useRef, useState } from 'react'
import {
  ACTIVE_USAGE_REFRESH_MINUTES,
  DEFAULT_USAGE_REFRESH_SETTINGS,
  INACTIVE_USAGE_REFRESH_MINUTES,
} from '../../../../../shared/accounts'
import type { UsageRefreshSettings } from '../../../../../shared/accounts'
import type { Preferences } from '../../../../../shared/contracts'
import { useWorkspace } from '@/state/workspace'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const activeOptions = ACTIVE_USAGE_REFRESH_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: `${minutes} 分钟`,
}))
const inactiveOptions = INACTIVE_USAGE_REFRESH_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: `${minutes} 分钟`,
}))

function usageRefreshSettings(preferences: Partial<Preferences>): UsageRefreshSettings {
  return preferences.usageRefresh ?? DEFAULT_USAGE_REFRESH_SETTINGS
}

export function UsageRefreshSettings() {
  const settings = useWorkspace((state) => usageRefreshSettings(state.preferences))
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const persisting = useRef(false)

  async function update(change: Partial<UsageRefreshSettings>) {
    if (persisting.current || !useWorkspace.getState().ready) return
    persisting.current = true
    setSaving(true)
    setError(undefined)
    try {
      const preferences = useWorkspace.getState().preferences
      await useWorkspace.getState().savePreferences({
        ...preferences,
        usageRefresh: { ...usageRefreshSettings(preferences), ...change },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      persisting.current = false
      setSaving(false)
    }
  }

  return (
    <section
      className="usage-refresh-settings flex flex-col gap-2.5"
      aria-labelledby="usage-refresh-settings-title"
    >
      <h2
        id="usage-refresh-settings-title"
        className="usage-refresh-settings-title settings-section-title"
      >
        账号额度
      </h2>
      <Card size="sm" className="usage-refresh-settings-card gap-0 divide-y divide-border py-0">
        <Field className="usage-refresh-enabled-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="usage-refresh-enabled-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <span
              id="usage-refresh-enabled-label"
              className="usage-refresh-enabled-label text-xs leading-5 font-medium"
            >
              自动刷新额度
            </span>
            <p
              id="usage-refresh-enabled-help"
              className="usage-refresh-enabled-description text-xs text-muted-foreground"
            >
              定期同步 Codex、Pi 与 Grok 账号的剩余额度。
            </p>
          </div>
          <Switch
            className="usage-refresh-enabled-switch"
            aria-labelledby="usage-refresh-enabled-label"
            aria-describedby={
              error
                ? 'usage-refresh-enabled-help usage-refresh-error'
                : 'usage-refresh-enabled-help'
            }
            aria-invalid={!!error}
            aria-busy={saving}
            checked={settings.enabled}
            disabled={!ready || saving}
            onCheckedChange={(enabled) => void update({ enabled })}
          />
        </Field>
        {(
          [
            { key: 'activeIntervalMinutes', label: '当前账号刷新周期', options: activeOptions },
            { key: 'inactiveIntervalMinutes', label: '其余账号刷新周期', options: inactiveOptions },
          ] as const
        ).map(({ key, label, options }) => (
          <Field
            key={key}
            className="usage-refresh-interval-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <span
              id={`usage-refresh-${key}-label`}
              className="usage-refresh-interval-label text-xs leading-5 font-medium"
            >
              {label}
            </span>
            <Select
              items={options}
              value={String(settings[key])}
              disabled={!ready || saving || !settings.enabled}
              onValueChange={(value) => {
                if (value) void update({ [key]: Number(value) })
              }}
            >
              <SelectTrigger
                className="usage-refresh-interval-select min-w-24"
                aria-labelledby={`usage-refresh-${key}-label`}
              >
                <SelectValue className="usage-refresh-interval-value" />
              </SelectTrigger>
              <SelectContent className="usage-refresh-interval-options">
                <SelectGroup className="usage-refresh-interval-options-group">
                  {options.map((option) => (
                    <SelectItem
                      className="usage-refresh-interval-option"
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ))}
      </Card>
      {error && (
        <p
          id="usage-refresh-error"
          className="usage-refresh-error text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  )
}
