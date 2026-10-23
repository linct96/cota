import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import { Card } from './ui/card'
import { Field, FieldGroup } from './ui/field'
import { Switch } from './ui/switch'

export function GeneralSettings() {
  const preventSleep = useWorkspace((state) => state.preferences.preventSleep)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const persisting = useRef(false)

  async function setPreventSleep(value: boolean) {
    if (persisting.current) return
    persisting.current = true
    setSaving(true)
    setError(undefined)
    try {
      await useWorkspace.getState().savePreferences({
        ...useWorkspace.getState().preferences,
        preventSleep: value,
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
      className="general-settings flex flex-col gap-6"
      aria-labelledby="general-settings-title"
    >
      <div className="general-settings-heading typeset">
        <h1 id="general-settings-title" className="general-settings-title">
          常规
        </h1>
      </div>
      <FieldGroup className="general-settings-groups gap-8">
        <section
          className="general-settings-group flex flex-col gap-3"
          aria-labelledby="general-settings-group-title"
        >
          <div className="general-settings-group-header flex flex-wrap items-start justify-between gap-3">
            <h4
              id="general-settings-group-title"
              className="general-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
            >
              常规
            </h4>
          </div>
          <Card className="general-settings-card">
            <Field
              className="general-settings-sleep-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              data-invalid={!!error}
            >
              <div className="general-settings-sleep-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <span
                  id="general-settings-prevent-sleep-label"
                  className="general-settings-sleep-label text-sm leading-5 font-medium"
                >
                  Agent 工作时防止系统休眠
                </span>
                {error && (
                  <p
                    id="general-settings-sleep-error"
                    className="general-settings-sleep-error text-xs text-destructive"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
              </div>
              <Switch
                id="general-settings-prevent-sleep"
                aria-labelledby="general-settings-prevent-sleep-label"
                className="general-settings-sleep-switch my-2"
                checked={preventSleep}
                onCheckedChange={(value) => void setPreventSleep(value)}
                aria-busy={saving}
                aria-invalid={!!error}
                aria-describedby={error ? 'general-settings-sleep-error' : undefined}
              />
            </Field>
          </Card>
        </section>
      </FieldGroup>
    </section>
  )
}
