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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

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
      className="notification-settings flex flex-col gap-5"
      aria-labelledby="notification-settings-title"
    >
      <header className="notification-settings-header flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="notification-settings-heading flex flex-col gap-1">
          <h1
            id="notification-settings-title"
            className="notification-settings-title settings-page-title"
          >
            通知
          </h1>
          <p className="notification-settings-subtitle text-xs text-muted-foreground">
            配置 Agent 状态变更与任务完成时的系统提醒方式。
          </p>
        </div>
        <Button
          className="notification-settings-test-button"
          variant="outline"
          disabled={!ready || !enabled || saving || testing}
          aria-busy={testing}
          onClick={() => void sendTestNotification()}
        >
          {testing ? '发送中…' : '发送测试通知'}
        </Button>
      </header>
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
      <Card size="sm" className="notification-settings-card gap-0 divide-y divide-border py-0">
        <div
          className="notification-settings-enabled-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          data-disabled={!ready || testing}
          aria-busy={saving}
        >
          <div className="notification-settings-enabled-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <span
              id="notification-settings-enabled-label"
              className="notification-settings-enabled-label text-xs leading-5 font-medium text-foreground"
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
            className="notification-settings-enabled-switch"
            checked={enabled}
            disabled={!ready || testing}
            onCheckedChange={(checked) => void savePreferences({ notificationsEnabled: checked })}
            aria-describedby={
              error
                ? 'notification-settings-enabled-description notification-settings-save-error'
                : 'notification-settings-enabled-description'
            }
          />
        </div>
        <div
          className="notification-settings-completion-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-opacity data-[disabled=true]:opacity-50"
          data-disabled={!ready || !enabled || testing}
          aria-busy={saving}
        >
          <div className="notification-settings-completion-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <span
              id="notification-settings-completion-label"
              className="notification-settings-completion-label text-xs leading-5 font-medium text-foreground"
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
          <ToggleGroup
            id="notification-settings-completion"
            className="notification-settings-completion-options shrink-0"
            variant="outline"
            spacing={0}
            value={[completionMode]}
            disabled={!ready || !enabled || testing}
            aria-labelledby="notification-settings-completion-label"
            aria-describedby={`notification-settings-completion-description${error ? ' notification-settings-save-error' : ''}`}
            onValueChange={([value]) => {
              if (value === 'never' || value === 'unfocused' || value === 'always') {
                void savePreferences({ turnCompleteNotification: value })
              }
            }}
          >
            {COMPLETION_OPTIONS.map((option) => (
              <ToggleGroupItem
                className="notification-settings-completion-option"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div
          className="notification-settings-sound-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-opacity data-[disabled=true]:opacity-50"
          data-disabled={!ready || !enabled || testing}
          aria-busy={saving}
        >
          <div className="notification-settings-sound-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
            <span
              id="notification-settings-sound-label"
              className="notification-settings-sound-label text-xs leading-5 font-medium text-foreground"
            >
              提示音
            </span>
            <p
              id="notification-settings-sound-description"
              className="notification-settings-sound-description text-xs text-muted-foreground"
            >
              支持 MP3、WAV、OGG、M4A 格式，不超过 5 MB；静音仅关闭提示音。
              {typeof sound !== 'string' && (
                <code
                  className="notification-settings-sound-file mt-1 block max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                  title={sound.path}
                >
                  {sound.path}
                </code>
              )}
            </p>
          </div>
          <div className="notification-settings-sound-control flex min-h-7 flex-wrap items-center gap-2">
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
        </div>
      </Card>
    </section>
  )
}
