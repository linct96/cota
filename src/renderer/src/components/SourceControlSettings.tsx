import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useWorkspace } from '../store'
import { commitMessageSettingsSchema } from '../lib/form-schemas'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
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
      className="source-control-settings flex flex-col gap-5"
      aria-labelledby="source-control-settings-title"
    >
      <header className="source-control-settings-header flex flex-col gap-1 border-b pb-4">
        <h1
          id="source-control-settings-title"
          className="source-control-settings-title settings-page-title"
        >
          源代码管理
        </h1>
        <FieldDescription className="source-control-settings-description">
          使用本机 Pi 根据已暂存的改动生成提交信息，生成后可编辑并审阅。
        </FieldDescription>
      </header>
      <form
        className="source-control-settings-form flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <Card size="sm" className="source-control-settings-card gap-0 py-0">
          <FieldGroup className="source-control-settings-fields p-4">
            <form.Field name="prompt">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="source-control-prompt-field" data-invalid={invalid}>
                    <div className="source-control-prompt-header flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel
                        className="source-control-prompt-label text-xs font-medium text-foreground"
                        htmlFor="commit-message-prompt"
                      >
                        自定义提示词
                      </FieldLabel>
                      <Badge variant="secondary" className="source-control-prompt-badge">
                        默认：中文 Conventional Commits
                      </Badge>
                    </div>
                    <form.Subscribe selector={(state) => state.isSubmitting}>
                      {(submitting) => (
                        <Textarea
                          id="commit-message-prompt"
                          name={field.name}
                          className="source-control-prompt-input min-h-32 font-mono text-xs leading-relaxed select-text"
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
          <div className="source-control-settings-footer flex flex-wrap items-center justify-between gap-3 border-t bg-muted/25 px-4 py-2.5">
            <FieldDescription
              id="commit-message-prompt-description"
              className="source-control-prompt-description min-w-0 flex-1 basis-64"
            >
              留空时使用中文 Conventional Commits 格式。Pi
              的账号、提供商和模型跟随本机默认配置；请先在终端运行 pi 完成配置。
            </FieldDescription>
            <div className="source-control-settings-actions flex shrink-0 items-center gap-2.5">
              <output className="source-control-settings-save-status text-xs text-muted-foreground">
                {saved ? '已保存' : ''}
              </output>
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
            </div>
          </div>
        </Card>
        {error && (
          <Alert className="source-control-settings-error" variant="destructive">
            <AlertDescription className="source-control-settings-error-description">
              {error}
            </AlertDescription>
          </Alert>
        )}
      </form>
    </section>
  )
}
