import { Fragment, useRef, useState } from 'react'
import { unwrap, type Preferences } from '../../../shared/contracts'
import { NOTIFICATION_SOUND_OPTIONS } from '../../../shared/notification-sounds'
import { useWorkspace } from '../store'
import { Alert, AlertDescription } from './ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Field, FieldGroup } from './ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
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
  const [openingSettings, setOpeningSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string>()
  const [testErrorOpen, setTestErrorOpen] = useState(false)
  const isMac = window.desktop.platform === 'darwin'
  const [error, setError] = useState<string>()
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

  async function openNotificationSettings() {
    if (openingSettings) return
    setOpeningSettings(true)
    setSettingsError(undefined)
    try {
      unwrap(await window.desktop.openNotificationSettings())
      setTestErrorOpen(false)
    } catch (cause) {
      setSettingsError(
        cause instanceof Error
          ? cause.message
          : '无法打开系统通知设置，请手动前往系统设置 → 通知。',
      )
    } finally {
      setOpeningSettings(false)
    }
  }

  async function sendTestNotification() {
    const state = useWorkspace.getState()
    if (pending.current || !state.ready || !state.preferences.notificationsEnabled) return
    pending.current = true
    setTesting(true)
    try {
      unwrap(await window.desktop.sendTestNotification())
    } catch {
      setSettingsError(undefined)
      setTestErrorOpen(true)
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
          <AlertDialog
            open={testErrorOpen}
            onOpenChange={(open, details) => {
              if (openingSettings) details.cancel()
              else setTestErrorOpen(open)
            }}
          >
            <AlertDialogContent className="notification-settings-test-error-dialog">
              <AlertDialogHeader className="notification-settings-test-error-header min-w-0">
                <AlertDialogTitle className="notification-settings-test-error-title">
                  通知测试未完成
                </AlertDialogTitle>
                <AlertDialogDescription className="notification-settings-test-error-description flex max-h-[50vh] flex-col gap-2 overflow-auto whitespace-pre-wrap break-words select-text">
                  <span className="notification-settings-permission-guidance">
                    {isMac
                      ? '请在「系统设置 → 通知」中选择 Cota，开启「允许通知」，然后返回重新测试。'
                      : '请在系统通知设置中允许 Cota 发送通知，然后重新测试。'}
                  </span>
                  <span className="notification-settings-focus-guidance">
                    如果已允许通知，请检查勿扰或专注模式是否限制了通知显示。
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              {settingsError && (
                <Alert className="notification-settings-system-error" variant="destructive">
                  <AlertDescription className="notification-settings-system-error-message">
                    {settingsError}
                  </AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter className="notification-settings-test-error-footer">
                <AlertDialogCancel
                  className="notification-settings-test-error-dismiss"
                  disabled={openingSettings}
                >
                  关闭
                </AlertDialogCancel>
                {isMac && (
                  <AlertDialogAction
                    className="notification-settings-system-button"
                    disabled={!ready || openingSettings}
                    aria-busy={openingSettings}
                    onClick={() => void openNotificationSettings()}
                  >
                    {openingSettings ? '打开中…' : '打开系统通知设置'}
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              className="notification-settings-enabled-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              disabled={!ready || testing}
              data-disabled={!ready || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-enabled-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="notification-settings-enabled-label"
                  className="notification-settings-enabled-label text-sm leading-5 font-medium"
                >
                  启用通知
                </span>
                <p
                  id="notification-settings-enabled-description"
                  className="notification-settings-enabled-description text-xs text-muted-foreground"
                >
                  允许 Cota 发送系统通知。关闭后，终端状态与未读提醒不受影响。
                </p>
              </div>
              <Switch
                id="notification-settings-enabled"
                aria-labelledby="notification-settings-enabled-label"
                className="notification-settings-enabled-switch my-2"
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
            </Field>
            <Separator className="notification-settings-separator" />
            <Field
              className="notification-settings-completion-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              disabled={!ready || !enabled || testing}
              data-disabled={!ready || !enabled || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-completion-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="notification-settings-completion-label"
                  className="notification-settings-completion-label text-sm leading-5 font-medium"
                >
                  轮次完成通知
                </span>
                <p
                  id="notification-settings-completion-description"
                  className="notification-settings-completion-description text-xs text-muted-foreground"
                >
                  Agent 轮次结束时发送系统通知。「仅在未聚焦」表示对应终端未聚焦时通知。
                </p>
              </div>
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
                  aria-labelledby="notification-settings-completion-label"
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
            </Field>
            <Separator className="notification-settings-sound-separator" />
            <Field
              className="notification-settings-sound-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              disabled={!ready || !enabled || testing}
              data-disabled={!ready || !enabled || testing}
              aria-busy={saving}
            >
              <div className="notification-settings-sound-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="notification-settings-sound-label"
                  className="notification-settings-sound-label text-sm leading-5 font-medium"
                >
                  提示音
                </span>
                <p
                  id="notification-settings-sound-description"
                  className="notification-settings-sound-description text-xs text-muted-foreground"
                >
                  支持 MP3、WAV、OGG、M4A，最大 5 MB。可发送测试通知试听，静音不影响通知显示。
                  {typeof sound !== 'string' && (
                    <span className="notification-settings-sound-file mt-1 block break-all">
                      当前文件：{sound.path}
                    </span>
                  )}
                </p>
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
                    aria-labelledby="notification-settings-sound-label"
                    className="notification-settings-sound-trigger"
                    aria-describedby={`notification-settings-sound-description${error ? ' notification-settings-save-error' : ''}`}
                  >
                    <SelectValue className="notification-settings-sound-value" />
                  </SelectTrigger>
                  <SelectContent className="notification-settings-sound-menu" align="end">
                    <SelectGroup className="notification-settings-sound-options">
                      {NOTIFICATION_SOUND_OPTIONS.map((option) => (
                        <Fragment key={option.value}>
                          {option.value === 'custom' && (
                            <SelectSeparator className="notification-settings-sound-option-separator" />
                          )}
                          <SelectItem
                            className="notification-settings-sound-option"
                            value={option.value}
                          >
                            {option.label}
                          </SelectItem>
                        </Fragment>
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
