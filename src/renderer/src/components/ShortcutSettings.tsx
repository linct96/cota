import { useEffect, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import {
  COTA_SHORTCUTS,
  TERMINAL_SHORTCUTS,
  captureShortcut,
  formatShortcut,
  shortcutBinding,
  validateShortcutBindings,
} from '../../../shared/shortcuts'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'

export function ShortcutSettings() {
  const [recording, setRecording] = useState<string>()
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const platform = window.desktop.platform
  useEffect(() => {
    window.desktop.setShortcutRecording(!!recording)
    return () => window.desktop.setShortcutRecording(false)
  }, [recording])
  const schema = z
    .object({ bindings: z.record(z.string(), z.string()) })
    .superRefine(({ bindings }, context) => {
      try {
        validateShortcutBindings(bindings, platform)
      } catch (cause) {
        context.addIssue({
          code: 'custom',
          path: ['bindings'],
          message: cause instanceof Error ? cause.message : '快捷键无效。',
        })
      }
    })
  const form = useForm({
    defaultValues: { bindings: { ...useWorkspace.getState().preferences.shortcuts } },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      setError(undefined)
      setSaved(false)
      setRecording(undefined)
      try {
        const shortcuts = validateShortcutBindings(value.bindings, platform)
        await useWorkspace
          .getState()
          .savePreferences({ ...useWorkspace.getState().preferences, shortcuts })
        form.reset({ bindings: shortcuts })
        setSaved(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    },
  })
  return (
    <section
      className="shortcut-settings flex flex-col gap-6"
      aria-labelledby="shortcut-settings-title"
    >
      <div className="shortcut-settings-heading flex flex-col gap-1">
        <h3
          id="shortcut-settings-title"
          className="shortcut-settings-title text-base font-semibold"
        >
          键盘快捷键
        </h3>
        <FieldDescription id="shortcut-recording-help" className="shortcut-settings-description">
          点击快捷键并按下新的组合键。Esc
          取消录制；清除后停用该快捷键，恢复默认后重新启用。组合键需包含 Ctrl、⌘、Alt 或 Shift。
        </FieldDescription>
      </div>
      <form
        className="shortcut-settings-form flex flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <fieldset
              className="shortcut-settings-controls flex min-w-0 flex-col gap-6"
              disabled={submitting}
            >
              <form.Field name="bindings">
                {(field) => (
                  <FieldGroup className="shortcut-settings-groups">
                    {[
                      { title: 'Cota 快捷键', items: COTA_SHORTCUTS },
                      { title: '终端快捷键', items: TERMINAL_SHORTCUTS },
                    ].map(({ title, items }) => (
                      <section
                        className="shortcut-settings-group flex flex-col gap-3"
                        key={title}
                        aria-label={title}
                      >
                        <h4 className="shortcut-settings-group-title text-sm font-semibold">
                          {title}
                        </h4>
                        {items.map(([id, label]) => (
                          <Field
                            key={id}
                            className="shortcut-setting-field"
                            data-invalid={!field.state.meta.isValid}
                          >
                            <div className="shortcut-setting-row flex flex-wrap items-center justify-between gap-2">
                              <FieldLabel
                                className="shortcut-setting-label"
                                htmlFor={`shortcut-${id}`}
                              >
                                {label}
                              </FieldLabel>
                              <div className="shortcut-setting-actions flex items-center gap-1">
                                <Input
                                  id={`shortcut-${id}`}
                                  className="shortcut-setting-input w-44 cursor-pointer text-center"
                                  readOnly
                                  value={
                                    recording === id
                                      ? '请按下组合键…'
                                      : formatShortcut(
                                          shortcutBinding(field.state.value, id!, platform),
                                          platform,
                                        )
                                  }
                                  aria-describedby="shortcut-recording-help shortcut-validation-error"
                                  aria-invalid={!field.state.meta.isValid}
                                  onFocus={() => setRecording(id)}
                                  onBlur={() => {
                                    setRecording(undefined)
                                    field.handleBlur()
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Tab') return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    if (event.key === 'Escape') {
                                      event.currentTarget.blur()
                                      return
                                    }
                                    if (event.nativeEvent.isComposing) return
                                    const binding = captureShortcut(event, platform)
                                    if (!binding) return
                                    field.handleChange({ ...field.state.value, [id!]: binding })
                                    field.handleBlur()
                                    setSaved(false)
                                    event.currentTarget.blur()
                                  }}
                                />
                                <Button
                                  className="shortcut-setting-clear"
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  aria-label={`清除${label}快捷键`}
                                  onClick={() => {
                                    field.handleChange({ ...field.state.value, [id!]: '' })
                                    field.handleBlur()
                                    setSaved(false)
                                  }}
                                >
                                  清除
                                </Button>
                                <Button
                                  className="shortcut-setting-reset"
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  aria-label={`恢复${label}默认快捷键`}
                                  onClick={() => {
                                    const next = { ...field.state.value }
                                    delete next[id!]
                                    field.handleChange(next)
                                    field.handleBlur()
                                    setSaved(false)
                                  }}
                                >
                                  默认
                                </Button>
                              </div>
                            </div>
                          </Field>
                        ))}
                      </section>
                    ))}
                    <FieldError
                      id="shortcut-validation-error"
                      className="shortcut-validation-error"
                      errors={field.state.meta.errors}
                    />
                  </FieldGroup>
                )}
              </form.Field>
              <FieldError className="shortcut-save-error">{error}</FieldError>
              <div className="shortcut-settings-actions flex items-center justify-between gap-3">
                <Button
                  className="shortcut-settings-reset-all"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    form.reset({ bindings: {} })
                    setSaved(false)
                  }}
                >
                  全部恢复默认
                </Button>
                <div className="shortcut-settings-save-actions flex items-center gap-3">
                  <output className="shortcut-settings-status text-xs text-muted-foreground">
                    {saved ? '已保存' : ''}
                  </output>
                  <Button className="shortcut-settings-save" type="submit">
                    {submitting ? '保存中…' : '保存快捷键'}
                  </Button>
                </div>
              </div>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
