import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { useWorkspace } from '@/state/workspace'
import { commitMessageSettingsSchema } from '@/features/settings/schemas'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

const PROMPT_PRESETS = [
  { id: 'english', label: '英文描述', snippet: '使用英文描述提交标题与正文。' },
  { id: 'oneline', label: '仅单行标题', snippet: '仅输出单行提交标题，不附加正文。' },
  { id: 'rationale', label: '正文说明原因', snippet: '正文简洁说明本次改动原因与影响范围。' },
  {
    id: 'noscope',
    label: '省略 Scope',
    snippet: '省略 Conventional Commits 中的 scope，仅保留 type: 描述。',
  },
] as const

const DEFAULT_RULES = [
  '使用 Conventional Commits：type(scope): 描述；无明确模块时省略 scope。',
  '默认使用简体中文，标题尽量不超过 72 个字符，不加句末标点。',
  '必要时空一行补充正文解释改动原因，不逐个罗列文件，不添加 Co-authored-by。',
] as const

function togglePresetSnippet(current: string, snippet: string): string {
  const trimmed = current.trim()
  if (trimmed.includes(snippet)) {
    return trimmed
      .replace(snippet, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
  }
  return trimmed ? `${trimmed}\n${snippet}` : snippet
}

export function CommitMessageSection() {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

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
      className="source-control-commit-section flex flex-col gap-2.5"
      aria-labelledby="source-control-commit-title"
    >
      <div className="source-control-commit-header flex flex-wrap items-center justify-between gap-3">
        <h2
          id="source-control-commit-title"
          className="source-control-commit-title settings-section-title"
        >
          提交信息生成
        </h2>
        <Badge variant="secondary" className="source-control-commit-engine">
          引擎：本机 Pi
        </Badge>
      </div>

      <form
        className="source-control-settings-form flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <Card size="sm" className="source-control-settings-card gap-0 py-0">
          <FieldGroup className="source-control-settings-fields gap-3 p-4">
            <form.Field name="prompt">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                const currentPrompt = field.state.value

                return (
                  <Field className="source-control-prompt-field gap-2.5" data-invalid={invalid}>
                    <Collapsible
                      open={rulesOpen}
                      onOpenChange={setRulesOpen}
                      className="source-control-default-rules flex flex-col gap-2"
                    >
                      <div className="source-control-prompt-header flex flex-wrap items-center justify-between gap-2">
                        <div className="source-control-prompt-title-group flex flex-wrap items-center gap-2">
                          <FieldLabel
                            className="source-control-prompt-label text-xs font-medium text-foreground"
                            htmlFor="commit-message-prompt"
                          >
                            自定义提示词
                          </FieldLabel>
                          <Badge variant="outline" className="source-control-prompt-badge">
                            追加于默认规则后
                          </Badge>
                        </div>
                        <CollapsibleTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="source-control-default-rules-trigger text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          <ChevronDown
                            className={cn(
                              'source-control-default-rules-icon transition-transform',
                              rulesOpen && 'rotate-180',
                            )}
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                          {rulesOpen ? '收起默认规则' : '查看默认规则'}
                        </CollapsibleTrigger>
                      </div>

                      <CollapsibleContent className="source-control-default-rules-content rounded-md border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                        <ul className="source-control-default-rules-list list-disc space-y-1 pl-4">
                          {DEFAULT_RULES.map((rule) => (
                            <li key={rule} className="source-control-default-rules-item">
                              {rule}
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>

                    <form.Subscribe selector={(state) => state.isSubmitting}>
                      {(submitting) => (
                        <>
                          <div className="source-control-prompt-presets flex flex-wrap items-center gap-1.5">
                            <span className="source-control-prompt-presets-label text-xs text-muted-foreground">
                              快速追加：
                            </span>
                            {PROMPT_PRESETS.map((preset) => {
                              const active = currentPrompt.includes(preset.snippet)
                              return (
                                <Button
                                  key={preset.id}
                                  type="button"
                                  variant={active ? 'default' : 'outline'}
                                  size="xs"
                                  disabled={submitting}
                                  aria-pressed={active}
                                  className="source-control-prompt-preset rounded-full px-2.5"
                                  onClick={() => {
                                    field.handleChange(
                                      togglePresetSnippet(currentPrompt, preset.snippet),
                                    )
                                    setSaved(false)
                                  }}
                                >
                                  {active ? (
                                    <Check
                                      className="source-control-prompt-preset-icon"
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Plus
                                      className="source-control-prompt-preset-icon"
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {preset.label}
                                </Button>
                              )
                            })}
                          </div>

                          <Textarea
                            id="commit-message-prompt"
                            name={field.name}
                            className="source-control-prompt-input min-h-28 font-mono text-xs leading-relaxed select-text"
                            value={currentPrompt}
                            maxLength={4000}
                            disabled={submitting}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? 'commit-message-prompt-error' : undefined}
                            placeholder="例如：使用英文描述；正文说明改动原因。"
                            onBlur={field.handleBlur}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              setSaved(false)
                            }}
                          />
                        </>
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
            <form.Subscribe
              selector={(state) => ({
                prompt: state.values.prompt,
                submitting: state.isSubmitting,
              })}
            >
              {({ prompt, submitting }) => (
                <div className="source-control-prompt-meta flex items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
                  <span className="source-control-prompt-count">
                    {prompt.length.toLocaleString()} / 4,000
                  </span>
                  {prompt.trim().length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={submitting}
                      className="source-control-prompt-reset text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        form.setFieldValue('prompt', '')
                        setSaved(false)
                      }}
                    >
                      恢复默认
                    </Button>
                  )}
                </div>
              )}
            </form.Subscribe>

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
                    保存
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
