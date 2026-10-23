import { Fragment, useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import {
  COTA_SHORTCUTS,
  TERMINAL_SHORTCUTS,
  captureShortcut,
  formatShortcut,
  shortcutBinding,
  validateShortcutBindings,
} from '../../../shared/shortcuts'
import { useWorkspace } from '../store'
import { shortcutSettingsFormSchema } from '../lib/form-schemas'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Separator } from './ui/separator'
import { Input } from './ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from './ui/field'

export function ShortcutSettings() {
  const [recording, setRecording] = useState<string>()
  const recordingStartValues = useRef(new Map<string, string | undefined>())
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const platform = window.desktop.platform
  useEffect(() => {
    window.desktop.setShortcutRecording(!!recording)
    return () => window.desktop.setShortcutRecording(false)
  }, [recording])
  const form = useForm({
    defaultValues: { bindings: { ...useWorkspace.getState().preferences.shortcuts } },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: shortcutSettingsFormSchema(platform) },
    onSubmit: async ({ value }) => {
      setError(undefined)
      setSaved(false)
      setRecording(undefined)
      try {
        const shortcuts = validateShortcutBindings(value.bindings, platform)
        const preferences = useWorkspace.getState().preferences
        if (JSON.stringify(shortcuts) !== JSON.stringify(preferences.shortcuts))
          await useWorkspace.getState().savePreferences({ ...preferences, shortcuts })
        form.reset({ bindings: shortcuts })
        recordingStartValues.current.clear()
        setSaved(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    },
  })
  function saveIfValid() {
    if (form.state.isValid && !form.state.isSubmitting) void form.handleSubmit()
  }
  return (
    <section
      className="shortcut-settings flex flex-col gap-6"
      aria-labelledby="shortcut-settings-title"
    >
      <div className="shortcut-settings-heading typeset">
        <h1 id="shortcut-settings-title" className="shortcut-settings-title">
          键盘快捷键
        </h1>
      </div>
      <form
        className="shortcut-settings-form flex flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          saveIfValid()
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <fieldset
              className="shortcut-settings-controls flex min-w-0 flex-col gap-6"
              disabled={submitting}
            >
              <FieldGroup className="shortcut-settings-groups gap-8">
                {[
                  { title: 'Cota 快捷键', items: COTA_SHORTCUTS },
                  { title: '终端快捷键', items: TERMINAL_SHORTCUTS },
                ].map(({ title, items }) => (
                  <section
                    className="shortcut-settings-group flex flex-col gap-3"
                    key={title}
                    aria-label={title}
                  >
                    <div className="shortcut-settings-group-heading flex items-center justify-between gap-3">
                      <h4 className="shortcut-settings-group-title text-sm font-normal text-muted-foreground">
                        {title}
                      </h4>
                      <Button
                        className="shortcut-settings-group-reset"
                        variant="ghost"
                        type="button"
                        aria-label={`恢复${title}默认设置`}
                        onClick={async () => {
                          if (form.state.isSubmitting) return
                          const next = { ...form.state.values.bindings }
                          for (const [id] of items) {
                            delete next[id!]
                            recordingStartValues.current.delete(id!)
                          }
                          form.setFieldValue('bindings', next)
                          setRecording(undefined)
                          setSaved(false)
                          await form.validate('blur')
                          saveIfValid()
                        }}
                      >
                        恢复默认
                      </Button>
                    </div>
                    <Card className="shortcut-settings-card">
                      {items.map(([id, label], index) => (
                        <Fragment key={id}>
                          {index > 0 && <Separator className="shortcut-settings-separator" />}
                          <form.Field name={`bindings.${id!}`}>
                            {(field) => (
                              <Field
                                className="shortcut-setting-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
                                data-invalid={!field.state.meta.isValid}
                              >
                                <FieldLabel
                                  className="shortcut-setting-label min-h-8 items-center text-sm leading-5"
                                  htmlFor={`shortcut-${id}`}
                                >
                                  {label}
                                </FieldLabel>
                                <div className="shortcut-setting-control flex min-w-0 flex-col gap-2">
                                  <div className="shortcut-setting-actions flex shrink-0 items-center gap-2">
                                    <Input
                                      id={`shortcut-${id}`}
                                      name={field.name}
                                      className="shortcut-setting-input h-8 w-44 cursor-pointer rounded-lg px-3 text-center"
                                      readOnly
                                      value={
                                        recording === id && field.state.meta.isValid
                                          ? '请按下组合键…'
                                          : formatShortcut(
                                              field.state.value ??
                                                shortcutBinding({}, id!, platform),
                                              platform,
                                            )
                                      }
                                      aria-describedby={
                                        !field.state.meta.isValid
                                          ? `shortcut-${id}-error`
                                          : undefined
                                      }
                                      aria-invalid={!field.state.meta.isValid}
                                      onFocus={() => {
                                        if (!recordingStartValues.current.has(id!))
                                          recordingStartValues.current.set(id!, field.state.value)
                                        setRecording(id)
                                      }}
                                      onBlur={() => {
                                        setRecording(undefined)
                                        field.handleBlur()
                                        if (field.state.meta.isValid)
                                          recordingStartValues.current.delete(id!)
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Tab') return
                                        event.preventDefault()
                                        event.stopPropagation()
                                        if (form.state.isSubmitting) return
                                        if (event.key === 'Escape') {
                                          if (recordingStartValues.current.has(id!)) {
                                            const next = { ...form.state.values.bindings }
                                            const previous = recordingStartValues.current.get(id!)
                                            if (previous === undefined) delete next[id!]
                                            else next[id!] = previous
                                            form.setFieldValue('bindings', next)
                                            field.handleBlur()
                                            recordingStartValues.current.delete(id!)
                                          }
                                          event.currentTarget.blur()
                                          saveIfValid()
                                          return
                                        }
                                        if (event.nativeEvent.isComposing) return
                                        const binding = captureShortcut(event, platform)
                                        if (!binding) return
                                        field.handleChange(binding)
                                        field.handleBlur()
                                        setSaved(false)
                                        if (field.state.meta.isValid) {
                                          event.currentTarget.blur()
                                          saveIfValid()
                                        }
                                      }}
                                    />
                                    <Button
                                      className="shortcut-setting-clear"
                                      variant="ghost"
                                      size="lg"
                                      type="button"
                                      aria-label={`清除${label}自定义快捷键，恢复默认`}
                                      onClick={() => {
                                        if (form.state.isSubmitting) return
                                        recordingStartValues.current.delete(id!)
                                        const next = { ...form.state.values.bindings }
                                        delete next[id!]
                                        form.setFieldValue('bindings', next)
                                        field.handleBlur()
                                        setSaved(false)
                                        saveIfValid()
                                      }}
                                    >
                                      清除
                                    </Button>
                                  </div>
                                  <FieldError
                                    id={`shortcut-${id}-error`}
                                    className="shortcut-setting-error max-w-60"
                                    errors={field.state.meta.errors}
                                  />
                                </div>
                              </Field>
                            )}
                          </form.Field>
                        </Fragment>
                      ))}
                    </Card>
                  </section>
                ))}
              </FieldGroup>
              <FieldError className="shortcut-save-error">{error}</FieldError>
              <div className="shortcut-settings-actions flex items-center justify-end gap-3">
                <output
                  className="shortcut-settings-status text-xs text-app-muted-foreground"
                  aria-live="polite"
                >
                  {submitting ? '保存中…' : saved ? '已保存' : ''}
                </output>
              </div>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
