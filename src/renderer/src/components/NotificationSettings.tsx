import { useRef, useState } from 'react'
import { unwrap, type Preferences } from '../../../shared/contracts'
import { NOTIFICATION_SOUND_OPTIONS } from '../../../shared/notification-sounds'
import { useWorkspace } from '../store'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Separator } from './ui/separator'
import { Switch } from './ui/switch'

const COMPLETION_OPTIONS = [
  { value: 'never', label: '从不' },
  { value: 'unfocused', label: '仅在未聚焦' },
  { value: 'always', label: '始终' },
] as const

export function NotificationSettings() {
  const enabled = useWorkspace((state) => state.preferences.notificationsEnabled)
  const completionMode = useWorkspace((state) => state.preferences.turnCompleteNotification)
  const sound = useWorkspace((state) => state.preferences.notificationSound)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string>()
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string }>()
  const pending = useRef(false)

  async function savePreferences(
    patch: Partial<
      Pick<Preferences, 'notificationsEnabled' | 'turnCompleteNotification' | 'notificationSound'>
    >,
  ) {
    if (pending.current || !useWorkspace.getState().ready) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    try {
      const state = useWorkspace.getState()
      await state.savePreferences({ ...state.preferences, ...patch })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  async function chooseSound() {
    const state = useWorkspace.getState()
    if (pending.current || !state.ready || !state.preferences.notificationsEnabled) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    try {
      const selected = unwrap(await window.desktop.chooseNotificationSound())
      if (selected)
        await useWorkspace.getState().savePreferences({
          ...useWorkspace.getState().preferences,
          notificationSound: selected,
        })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '选择提示音失败，请重试。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  async function sendTestNotification() {
    const state = useWorkspace.getState()
    if (pending.current || !state.ready || !state.preferences.notificationsEnabled) return
    pending.current = true
    setTesting(true)
    setTestResult(undefined)
    try {
      unwrap(await window.desktop.sendTestNotification())
      setTestResult({
        ok: true,
        message: '测试通知已发送；若未看到，请检查系统通知权限或勿扰模式。',
      })
    } catch (cause) {
      setTestResult({
        ok: false,
        message: cause instanceof Error ? cause.message : '通知发送失败，请重试。',
      })
    } finally {
      pending.current = false
      setTesting(false)
    }
  }

  return (
    <section
      className="notification-settings flex flex-col gap-6"
      aria-labelledby="notification-settings-title"
    >
      <div className="notification-settings-heading typeset">
        <h1 id="notification-settings-title" className="notification-settings-title">
          通知
        </h1>
      </div>
      <FieldGroup className="notification-settings-groups gap-8">
        <section
          className="notification-settings-group flex flex-col gap-3"
          aria-labelledby="notification-settings-group-title"
        >
          <div className="notification-settings-group-header flex flex-wrap items-start justify-between gap-3">
            <h4
              id="notification-settings-group-title"
              className="notification-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
            >
              常规
            </h4>
            <Button
              className="notification-settings-test-button"
              variant="outline"
              size="lg"
              disabled={!ready || !enabled || saving || testing}
              aria-busy={testing}
              onClick={() => void sendTestNotification()}
            >
              {testing ? '发送中…' : '发送测试通知'}
            </Button>
          </div>
          {testResult && (
            <Alert
              className="notification-settings-test-result"
              variant={testResult.ok ? 'default' : 'destructive'}
              role={testResult.ok ? 'status' : 'alert'}
            >
              <AlertDescription className="notification-settings-test-message">
                {testResult.message}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert
              id="notification-settings-save-error"
              className="notification-settings-save-error"
              variant="destructive"
            >
              <AlertDescription className="notification-settings-save-message">
                {error}
              </AlertDescription>
            </Alert>
          )}
          <Card className="notification-settings-card">
            <Field
              className="notification-settings-enabled-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
              disabled={!ready || testing}
              data-disabled={!ready || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-enabled-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <FieldLabel
                  htmlFor="notification-settings-enabled"
                  className="notification-settings-enabled-label min-h-8 text-sm leading-5"
                >
                  启用通知
                </FieldLabel>
                <FieldDescription
                  id="notification-settings-enabled-description"
                  className="notification-settings-enabled-description"
                >
                  允许 Cota 发送系统通知。关闭后，终端状态与未读提醒不受影响。
                </FieldDescription>
              </div>
              <div className="notification-settings-enabled-control flex min-h-8 items-center">
                <Switch
                  id="notification-settings-enabled"
                  className="notification-settings-enabled-switch"
                  checked={enabled}
                  disabled={!ready || testing}
                  onCheckedChange={(checked) =>
                    void savePreferences({ notificationsEnabled: checked })
                  }
                  aria-describedby={
                    error
                      ? 'notification-settings-enabled-description notification-settings-save-error'
                      : 'notification-settings-enabled-description'
                  }
                />
              </div>
            </Field>
            <Separator className="notification-settings-separator" />
            <Field
              className="notification-settings-completion-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
              disabled={!ready || !enabled || testing}
              data-disabled={!ready || !enabled || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-completion-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <FieldLabel
                  htmlFor="notification-settings-completion"
                  className="notification-settings-completion-label min-h-8 text-sm leading-5"
                >
                  轮次完成通知
                </FieldLabel>
                <FieldDescription
                  id="notification-settings-completion-description"
                  className="notification-settings-completion-description"
                >
                  Agent 轮次结束时发送系统通知。「仅在未聚焦」表示对应终端未聚焦时通知。
                </FieldDescription>
              </div>
              <div className="notification-settings-completion-control flex min-h-8 items-center">
                <Select
                  items={COMPLETION_OPTIONS}
                  value={completionMode}
                  disabled={!ready || !enabled || testing}
                  onValueChange={(value) => {
                    if (value !== null) void savePreferences({ turnCompleteNotification: value })
                  }}
                >
                  <SelectTrigger
                    id="notification-settings-completion"
                    className="notification-settings-completion-trigger"
                    aria-describedby={`notification-settings-completion-description${error ? ' notification-settings-save-error' : ''}`}
                  >
                    <SelectValue className="notification-settings-completion-value" />
                  </SelectTrigger>
                  <SelectContent className="notification-settings-completion-menu" align="end">
                    <SelectGroup className="notification-settings-completion-options">
                      {COMPLETION_OPTIONS.map((option) => (
                        <SelectItem
                          className="notification-settings-completion-option"
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Separator className="notification-settings-sound-separator" />
            <Field
              className="notification-settings-sound-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
              disabled={!ready || !enabled || testing}
              data-disabled={!ready || !enabled || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-sound-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <FieldLabel
                  htmlFor="notification-settings-sound"
                  className="notification-settings-sound-label min-h-8 text-sm leading-5"
                >
                  提示音
                </FieldLabel>
                <FieldDescription
                  id="notification-settings-sound-description"
                  className="notification-settings-sound-description"
                >
                  支持 MP3、WAV、OGG、M4A，最大 5 MB。可发送测试通知试听，静音不影响通知显示。
                  {typeof sound !== 'string' && (
                    <span className="notification-settings-sound-file mt-1 block break-all">
                      当前文件：{sound.path}
                    </span>
                  )}
                </FieldDescription>
              </div>
              <div className="notification-settings-sound-control flex min-h-8 flex-wrap items-center gap-2">
                <Select
                  items={NOTIFICATION_SOUND_OPTIONS}
                  value={typeof sound === 'string' ? sound : 'custom'}
                  disabled={!ready || !enabled || testing}
                  onValueChange={(value) => {
                    if (value === 'custom') void chooseSound()
                    else if (value === 'system' || value === 'none')
                      void savePreferences({ notificationSound: value })
                  }}
                >
                  <SelectTrigger
                    id="notification-settings-sound"
                    className="notification-settings-sound-trigger"
                    aria-describedby={`notification-settings-sound-description${error ? ' notification-settings-save-error' : ''}`}
                  >
                    <SelectValue className="notification-settings-sound-value" />
                  </SelectTrigger>
                  <SelectContent className="notification-settings-sound-menu" align="end">
                    <SelectGroup className="notification-settings-sound-options">
                      {NOTIFICATION_SOUND_OPTIONS.map((option) => (
                        <SelectItem
                          className="notification-settings-sound-option"
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {typeof sound !== 'string' && (
                  <Button
                    className="notification-settings-sound-choose-button"
                    variant="outline"
                    disabled={!ready || !enabled || testing}
                    onClick={() => void chooseSound()}
                    aria-describedby="notification-settings-sound-description"
                  >
                    更换文件
                  </Button>
                )}
              </div>
            </Field>
          </Card>
        </section>
      </FieldGroup>
    </section>
  )
}
