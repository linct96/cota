import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import { Card } from './ui/card'
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
      <Card className="general-settings-card">
        <div
          className="general-settings-sleep-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 data-[invalid=true]:text-destructive"
          data-invalid={!!error}
        >
          <div className="general-settings-sleep-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <span
              id="general-settings-prevent-sleep-label"
              className="general-settings-sleep-label text-sm leading-5 font-medium"
            >
              Agent 工作时防止系统休眠
            </span>
            <p
              id="general-settings-sleep-help"
              className="general-settings-sleep-description text-xs text-muted-foreground"
            >
              检测到 Agent 正在执行任务时阻止系统自动休眠，任务结束后恢复。不影响屏幕熄灭。
            </p>
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
            aria-describedby={
              error
                ? 'general-settings-sleep-help general-settings-sleep-error'
                : 'general-settings-sleep-help'
            }
          />
        </div>
      </Card>
    </section>
  )
}
