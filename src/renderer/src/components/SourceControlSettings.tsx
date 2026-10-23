import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useWorkspace } from '../store'
import { commitMessageSettingsSchema } from '../lib/form-schemas'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Textarea } from './ui/textarea'

export function SourceControlSettings() {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const form = useForm({
    defaultValues: { prompt: useWorkspace.getState().preferences.commitMessagePrompt ?? '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: commitMessageSettingsSchema },
    onSubmit: async ({ value }) => {
      setError(undefined)
      setSaved(false)
      try {
        const prompt = value.prompt.trim()
        await useWorkspace.getState().savePreferences({
          ...useWorkspace.getState().preferences,
          commitMessagePrompt: prompt,
        })
        form.reset({ prompt })
        setSaved(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    },
  })

  return (
    <section
      className="source-control-settings flex flex-col gap-6"
      aria-labelledby="source-control-settings-title"
    >
      <div className="source-control-settings-header flex flex-col gap-1">
        <h3
          id="source-control-settings-title"
          className="source-control-settings-title text-base font-semibold"
        >
          源代码管理
        </h3>
        <FieldDescription className="source-control-settings-description">
          使用本机 Pi 根据已暂存的改动生成提交信息，生成后可编辑并审阅。
        </FieldDescription>
      </div>
      <form
        className="source-control-settings-form flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FieldGroup className="source-control-settings-fields">
          <form.Field name="prompt">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field className="source-control-prompt-field" data-invalid={invalid}>
                  <FieldLabel
                    className="source-control-prompt-label"
                    htmlFor="commit-message-prompt"
                  >
                    自定义提示词
                  </FieldLabel>
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(submitting) => (
                      <Textarea
                        id="commit-message-prompt"
                        name={field.name}
                        className="source-control-prompt-input min-h-32 select-text"
                        value={field.state.value}
                        maxLength={4000}
                        disabled={submitting}
                        aria-invalid={invalid}
                        aria-describedby={`commit-message-prompt-description${invalid ? ' commit-message-prompt-error' : ''}`}
                        placeholder="例如：使用英文描述；正文说明改动原因。"
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value)
                          setSaved(false)
                        }}
                      />
                    )}
                  </form.Subscribe>
                  <FieldDescription
                    id="commit-message-prompt-description"
                    className="source-control-prompt-description"
                  >
                    留空时使用中文 Conventional Commits 格式。Pi
                    的账号、提供商和模型跟随其本机默认配置；请先在终端运行 pi 完成配置。
                  </FieldDescription>
                  {invalid && (
                    <FieldError
                      id="commit-message-prompt-error"
                      className="source-control-prompt-error"
                      errors={field.state.meta.errors}
                    />
                  )}
                </Field>
              )
            }}
          </form.Field>
        </FieldGroup>
        {error && (
          <Alert className="source-control-settings-error" variant="destructive">
            <AlertDescription className="source-control-settings-error-description">
              {error}
            </AlertDescription>
          </Alert>
        )}
        <div className="source-control-settings-actions flex items-center gap-3">
          <form.Subscribe
            selector={(state) => ({ submitting: state.isSubmitting, dirty: state.isDirty })}
          >
            {({ submitting, dirty }) => (
              <Button
                className="source-control-settings-save"
                type="submit"
                disabled={submitting || !dirty}
              >
                {submitting ? '保存中…' : '保存'}
              </Button>
            )}
          </form.Subscribe>
          <output className="source-control-settings-save-status">{saved ? '已保存' : ''}</output>
        </div>
      </form>
    </section>
  )
}
