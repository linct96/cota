import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import { Card } from './ui/card'
import { Switch } from './ui/switch'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'

type GeneralPreference = 'preventSleep' | 'reusePreviewTabs' | 'confirmCloseRunningTerminal'

export function GeneralSettings() {
  const preventSleep = useWorkspace((state) => state.preferences.preventSleep)
  const reusePreviewTabs = useWorkspace((state) => state.preferences.reusePreviewTabs)
  const confirmCloseRunningTerminal = useWorkspace(
    (state) => state.preferences.confirmCloseRunningTerminal,
  )
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<GeneralPreference, string>>>({})
  const error = errors.preventSleep
  const persisting = useRef(false)

  async function update(key: GeneralPreference, value: boolean) {
    if (persisting.current || !useWorkspace.getState().ready) return
    persisting.current = true
    setSaving(true)
    setErrors({})
    try {
      await useWorkspace.getState().savePreferences({
        ...useWorkspace.getState().preferences,
        [key]: value,
      })
    } catch (cause) {
      setErrors({ [key]: cause instanceof Error ? cause.message : '保存失败，请重试。' })
    } finally {
      persisting.current = false
      setSaving(false)
    }
  }

  return (
    <section
      className="general-settings flex flex-col gap-5"
      aria-labelledby="general-settings-title"
    >
      <header className="general-settings-heading flex flex-col gap-1 border-b pb-4">
        <h1 id="general-settings-title" className="general-settings-title settings-page-title">
          常规
        </h1>
        <p className="general-settings-subtitle text-xs text-muted-foreground">
          管理系统电源与标签导航行为。
        </p>
      </header>
      <FieldGroup className="general-settings-groups gap-6">
        <section
          className="general-settings-system-group flex flex-col gap-2.5"
          aria-labelledby="general-settings-system-title"
        >
          <h2
            id="general-settings-system-title"
            className="general-settings-system-title settings-section-title"
          >
            系统
          </h2>
          <Card size="sm" className="general-settings-card">
            <div
              className="general-settings-sleep-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 data-[invalid=true]:text-destructive"
              data-invalid={!!error}
            >
              <div className="general-settings-sleep-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="general-settings-prevent-sleep-label"
                  className="general-settings-sleep-label text-xs leading-5 font-medium text-foreground"
                >
                  Agent 工作时防止系统休眠
                </span>
                <p
                  id="general-settings-sleep-help"
                  className="general-settings-sleep-description text-xs text-muted-foreground"
                >
                  检测到 Agent 正在执行任务时阻止系统自动休眠，任务结束后恢复。
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
                className="general-settings-sleep-switch"
                checked={preventSleep}
                onCheckedChange={(value) => void update('preventSleep', value)}
                disabled={!ready || saving}
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
        <section
          className="general-settings-navigation-group flex flex-col gap-2.5"
          aria-labelledby="general-settings-navigation-title"
        >
          <h2
            id="general-settings-navigation-title"
            className="general-settings-navigation-title settings-section-title"
          >
            导航
          </h2>
          <Card
            size="sm"
            className="general-settings-navigation-card gap-0 divide-y divide-border py-0"
          >
            <Field
              className="general-settings-preview-tabs-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              disabled={!ready || saving}
              data-disabled={!ready || saving}
              data-invalid={!!errors.reusePreviewTabs}
              aria-busy={saving}
            >
              <div className="general-settings-preview-tabs-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <FieldLabel
                  htmlFor="general-settings-reuse-preview-tabs"
                  className="general-settings-preview-tabs-label text-xs leading-5"
                >
                  允许复用预览标签
                </FieldLabel>
                <FieldDescription
                  id="general-settings-preview-tabs-help"
                  className="general-settings-preview-tabs-description"
                >
                  单击文件或 Diff 时复用预览标签，双击可固定；关闭后以固定标签打开。
                </FieldDescription>
                {errors.reusePreviewTabs && (
                  <FieldError
                    id="general-settings-preview-tabs-error"
                    className="general-settings-preview-tabs-error"
                  >
                    {errors.reusePreviewTabs}
                  </FieldError>
                )}
              </div>
              <Switch
                id="general-settings-reuse-preview-tabs"
                className="general-settings-preview-tabs-switch"
                checked={reusePreviewTabs}
                disabled={!ready || saving}
                aria-invalid={!!errors.reusePreviewTabs}
                aria-describedby={
                  errors.reusePreviewTabs
                    ? 'general-settings-preview-tabs-help general-settings-preview-tabs-error'
                    : 'general-settings-preview-tabs-help'
                }
                onCheckedChange={(value) => void update('reusePreviewTabs', value)}
              />
            </Field>
            <Field
              className="general-settings-close-confirmation-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              disabled={!ready || saving}
              data-disabled={!ready || saving}
              data-invalid={!!errors.confirmCloseRunningTerminal}
              aria-busy={saving}
            >
              <div className="general-settings-close-confirmation-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <FieldLabel
                  htmlFor="general-settings-confirm-close-running-terminal"
                  className="general-settings-close-confirmation-label text-xs leading-5"
                >
                  关闭运行中的终端/智能体的确认提醒
                </FieldLabel>
                <FieldDescription
                  id="general-settings-close-confirmation-help"
                  className="general-settings-close-confirmation-description"
                >
                  关闭前进行确认，避免误中断任务；关闭此提醒后将直接结束程序。
                </FieldDescription>
                {errors.confirmCloseRunningTerminal && (
                  <FieldError
                    id="general-settings-close-confirmation-error"
                    className="general-settings-close-confirmation-error"
                  >
                    {errors.confirmCloseRunningTerminal}
                  </FieldError>
                )}
              </div>
              <Switch
                id="general-settings-confirm-close-running-terminal"
                className="general-settings-close-confirmation-switch"
                checked={confirmCloseRunningTerminal}
                disabled={!ready || saving}
                aria-invalid={!!errors.confirmCloseRunningTerminal}
                aria-describedby={
                  errors.confirmCloseRunningTerminal
                    ? 'general-settings-close-confirmation-help general-settings-close-confirmation-error'
                    : 'general-settings-close-confirmation-help'
                }
                onCheckedChange={(value) => void update('confirmCloseRunningTerminal', value)}
              />
            </Field>
          </Card>
        </section>
      </FieldGroup>
    </section>
  )
}
