import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '../lib/terminal-stable-cell-fit-addon'
import { installTerminalAppearance } from '../lib/terminal-appearance'
import { observeDocumentTheme } from '../lib/theme'
import { useWorkspace } from '../store'
import {
  DEFAULT_TERMINAL_APPEARANCE,
  TERMINAL_COLOR_KEYS,
  terminalAppearanceSchema,
  type TerminalAppearance,
} from '../../../shared/terminal-appearance'
import { TERMINAL_THEME_CATALOG } from '../../../shared/terminal-themes'
import { Button } from './ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const NUMBER_FIELDS = [
  { name: 'fontSize', label: '字号', min: 8, max: 48, step: 1, group: 'typography' },
  { name: 'fontWeight', label: '常规字重', min: 100, max: 900, step: 100, group: 'typography' },
  { name: 'fontWeightBold', label: '粗体字重', min: 100, max: 900, step: 100, group: 'typography' },
  { name: 'lineHeight', label: '行高', min: 1, max: 3, step: 0.05, group: 'typography' },
  {
    name: 'letterSpacing',
    label: '字符间距（px）',
    min: -2,
    max: 10,
    step: 0.1,
    group: 'typography',
  },
  { name: 'cursorOpacity', label: '光标不透明度', min: 0, max: 1, step: 0.05, group: 'cursor' },
  {
    name: 'backgroundOpacity',
    label: '背景不透明度',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'background',
  },
  { name: 'paddingX', label: '水平内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
  { name: 'paddingY', label: '垂直内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
  {
    name: 'minimumContrastRatio',
    label: '最低对比度',
    min: 1,
    max: 21,
    step: 0.1,
    group: 'contrast',
  },
] as const
const ENUM_FIELDS = [
  {
    name: 'ligatures',
    label: '字体连字',
    options: [
      ['auto', '自动'],
      ['on', '开启'],
      ['off', '关闭'],
    ],
  },
  {
    name: 'cursorStyle',
    label: '光标形状',
    options: [
      ['bar', '竖线'],
      ['block', '方块'],
      ['underline', '下划线'],
    ],
  },
  {
    name: 'contrastMode',
    label: '文字对比度',
    options: [
      ['auto', '自动'],
      ['off', '关闭'],
      ['custom', '自定义'],
    ],
  },
] as const
const SWITCH_FIELDS = [
  { name: 'separateLightTheme', label: '浅色模式使用独立配色' },
  { name: 'cursorBlink', label: '光标闪烁' },
  { name: 'windowBlur', label: '窗口背景模糊（重启后生效）' },
  { name: 'mouseHideWhileTyping', label: '输入时隐藏鼠标指针' },
] as const
const COLOR_LABELS = [
  '前景',
  '背景',
  '光标',
  '光标下文字',
  '选区背景',
  '选区文字',
  '黑',
  '红',
  '绿',
  '黄',
  '蓝',
  '品红',
  '青',
  '白',
  '亮黑',
  '亮红',
  '亮绿',
  '亮黄',
  '亮蓝',
  '亮品红',
  '亮青',
  '亮白',
]

function TerminalAppearancePreview({ settings }: { settings: TerminalAppearance }) {
  const host = useRef<HTMLElement>(null)
  const currentSettings = useEffectEvent(() => settings)
  const apply = useRef<(value: TerminalAppearance) => void>(() => {})
  useEffect(() => {
    const container = host.current!
    const terminal = new Terminal({
      allowTransparency: true,
      disableStdin: true,
      scrollback: 0,
      cursorInactiveStyle: 'block',
      fontSize: 14,
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    const appearance = installTerminalAppearance(terminal, container)
    const update = (value = currentSettings()) => {
      if (!terminalAppearanceSchema.safeParse(value).success) return
      appearance.update(value)
      fit.fit()
    }
    apply.current = update
    update()
    terminal.write(
      '\x1b[32m❯\x1b[0m git status\r\n\x1b[1mOn branch main\x1b[0m\r\n\x1b[32m  + Ready to build\x1b[0m\r\n\x1b[33m  ~ Theme preview\x1b[0m\r\n\x1b[31m  - Removed line\x1b[0m\r\n\x1b[34mconst\x1b[0m ready = a !== b && count >= 1;\r\n\x1b[32m❯\x1b[0m ',
    )
    const observer = new ResizeObserver(() => update())
    observer.observe(container)
    const stopTheme = observeDocumentTheme(() => update())
    return () => {
      apply.current = () => {}
      observer.disconnect()
      stopTheme()
      appearance.dispose()
      terminal.dispose()
    }
  }, [])
  useEffect(() => apply.current(settings), [settings])
  return (
    <section
      ref={host}
      className="terminal-appearance-preview h-56 overflow-hidden rounded-lg border"
      aria-label="终端外观预览：包含粗体、彩色输出和字体连字示例"
    />
  )
}

export function TerminalAppearanceSettings() {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const form = useForm({
    defaultValues: structuredClone(useWorkspace.getState().preferences.terminalAppearance),
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: terminalAppearanceSchema },
    onSubmit: async ({ value }) => {
      setError(undefined)
      setSaved(false)
      try {
        const terminalAppearance = terminalAppearanceSchema.parse({
          ...value,
          fontFamily: value.fontFamily.trim(),
        })
        await useWorkspace
          .getState()
          .savePreferences({ ...useWorkspace.getState().preferences, terminalAppearance })
        form.reset(terminalAppearance)
        setSaved(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    },
  })
  return (
    <section
      className="terminal-appearance-settings mt-6 flex flex-col gap-4"
      aria-labelledby="terminal-appearance-title"
    >
      <div className="terminal-appearance-heading flex flex-col gap-1">
        <h4
          id="terminal-appearance-title"
          className="terminal-appearance-title text-sm font-semibold"
        >
          外观
        </h4>
        <FieldDescription className="terminal-appearance-help">
          修改后可在下方预览，保存后应用到所有终端。
        </FieldDescription>
      </div>
      <form
        className="terminal-appearance-form flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        onChange={() => setSaved(false)}
      >
        <form.Subscribe
          selector={(state) => ({ values: state.values, submitting: state.isSubmitting })}
        >
          {({ values, submitting }) => (
            <fieldset
              className="terminal-appearance-controls flex min-w-0 flex-col gap-5"
              disabled={submitting}
            >
              <TerminalAppearancePreview settings={values} />
              <FieldGroup className="terminal-appearance-fields">
                <form.Field name="fontFamily">
                  {(field) => (
                    <Field
                      className="terminal-font-family-field"
                      data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                    >
                      <FieldLabel
                        htmlFor="terminal-font-family"
                        className="terminal-font-family-label"
                      >
                        字体
                      </FieldLabel>
                      <Input
                        id="terminal-font-family"
                        className="terminal-font-family-input"
                        list="terminal-font-suggestions"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                        aria-describedby="terminal-font-family-help terminal-font-family-error"
                      />
                      <datalist
                        id="terminal-font-suggestions"
                        className="terminal-font-suggestions"
                      >
                        {[
                          'Consolas',
                          'Cascadia Code',
                          'JetBrains Mono',
                          'Fira Code',
                          'Menlo',
                          'Monaco',
                          'monospace',
                        ].map((font) => (
                          <option className="terminal-font-suggestion" key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </datalist>
                      <FieldDescription
                        id="terminal-font-family-help"
                        className="terminal-font-family-description"
                      >
                        使用已安装的等宽字体；可用逗号设置回退字体。
                      </FieldDescription>
                      <FieldError
                        id="terminal-font-family-error"
                        className="terminal-font-family-error"
                        errors={field.state.meta.isTouched ? field.state.meta.errors : []}
                      />
                    </Field>
                  )}
                </form.Field>
                <div className="terminal-appearance-numbers grid grid-cols-2 gap-4">
                  {NUMBER_FIELDS.map(({ name, label, min, max, step }) =>
                    name === 'minimumContrastRatio' && values.contrastMode !== 'custom' ? null : (
                      <form.Field key={name} name={name}>
                        {(field) => {
                          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field
                              className="terminal-appearance-number-field"
                              data-invalid={invalid}
                            >
                              <FieldLabel
                                htmlFor={`terminal-${name}`}
                                className="terminal-appearance-number-label"
                              >
                                {label}
                              </FieldLabel>
                              <Input
                                id={`terminal-${name}`}
                                className="terminal-appearance-number-input"
                                type="number"
                                min={min}
                                max={max}
                                step={step}
                                value={Number.isNaN(field.state.value) ? '' : field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                                aria-invalid={invalid}
                                aria-describedby={`terminal-${name}-help terminal-${name}-error`}
                              />
                              <FieldDescription
                                id={`terminal-${name}-help`}
                                className="terminal-appearance-number-description"
                              >
                                {min}–{max}
                              </FieldDescription>
                              <FieldError
                                id={`terminal-${name}-error`}
                                className="terminal-appearance-number-error"
                                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
                              />
                            </Field>
                          )
                        }}
                      </form.Field>
                    ),
                  )}
                </div>
                {ENUM_FIELDS.map(({ name, label, options }) => (
                  <form.Field key={name} name={name}>
                    {(field) => (
                      <Field className="terminal-appearance-choice-field">
                        <FieldLabel
                          id={`terminal-${name}-label`}
                          className="terminal-appearance-choice-label"
                        >
                          {label}
                        </FieldLabel>
                        <ToggleGroup
                          className="terminal-appearance-choices"
                          variant="outline"
                          spacing={0}
                          value={[field.state.value]}
                          aria-labelledby={`terminal-${name}-label`}
                          onBlur={field.handleBlur}
                          onValueChange={([value]) => {
                            if (!value || !options.some(([option]) => option === value)) return
                            field.handleChange(value as typeof field.state.value)
                            setSaved(false)
                          }}
                        >
                          {options.map(([value, text]) => (
                            <ToggleGroupItem
                              className="terminal-appearance-choice"
                              key={value}
                              value={value}
                            >
                              {text}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </Field>
                    )}
                  </form.Field>
                ))}
                {SWITCH_FIELDS.map(({ name, label }) => (
                  <form.Field key={name} name={name}>
                    {(field) => (
                      <Field className="terminal-appearance-switch-field">
                        <div className="terminal-appearance-switch-row flex items-center justify-between gap-4">
                          <FieldLabel
                            htmlFor={`terminal-${name}`}
                            className="terminal-appearance-switch-label"
                          >
                            {label}
                          </FieldLabel>
                          <Switch
                            id={`terminal-${name}`}
                            className="terminal-appearance-switch"
                            checked={field.state.value}
                            onBlur={field.handleBlur}
                            onCheckedChange={(value) => {
                              field.handleChange(value)
                              setSaved(false)
                            }}
                            disabled={
                              name === 'windowBlur' &&
                              !['darwin', 'win32'].includes(window.desktop.platform)
                            }
                          />
                        </div>
                      </Field>
                    )}
                  </form.Field>
                ))}
                {(['themeDark', 'themeLight'] as const).map((name) =>
                  name === 'themeLight' && !values.separateLightTheme ? null : (
                    <form.Field key={name} name={name}>
                      {(field) => (
                        <Field className="terminal-theme-field">
                          <FieldLabel htmlFor={`terminal-${name}`} className="terminal-theme-label">
                            {name === 'themeDark' ? '深色模式配色' : '浅色模式配色'}
                          </FieldLabel>
                          <Select
                            value={field.state.value}
                            onValueChange={(value) => {
                              if (value) {
                                field.handleChange(value)
                                setSaved(false)
                              }
                            }}
                          >
                            <SelectTrigger
                              id={`terminal-${name}`}
                              className="terminal-theme-trigger w-full"
                              onBlur={field.handleBlur}
                            >
                              <SelectValue className="terminal-theme-value">
                                {field.state.value === 'auto' ? '跟随应用主题' : field.state.value}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="terminal-theme-content">
                              <SelectGroup className="terminal-theme-items">
                                <SelectItem className="terminal-theme-item" value="auto">
                                  跟随应用主题
                                </SelectItem>
                                {Object.keys(TERMINAL_THEME_CATALOG)
                                  .sort()
                                  .map((theme) => (
                                    <SelectItem
                                      className="terminal-theme-item"
                                      key={theme}
                                      value={theme}
                                    >
                                      {theme}
                                    </SelectItem>
                                  ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    </form.Field>
                  ),
                )}
              </FieldGroup>
              <details className="terminal-color-overrides rounded-lg border p-4">
                <summary className="terminal-color-overrides-summary cursor-pointer text-sm font-medium">
                  自定义颜色与 ANSI 调色板
                </summary>
                <FieldDescription className="terminal-color-overrides-help mt-2">
                  留空沿用配色主题；输入 #RRGGBB 覆盖对应颜色。
                </FieldDescription>
                <FieldGroup className="terminal-color-fields mt-4 grid grid-cols-2 gap-4">
                  {TERMINAL_COLOR_KEYS.map((key, index) => (
                    <form.Field key={key} name={`colors.${key}`}>
                      {(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                        return (
                          <Field className="terminal-color-field" data-invalid={invalid}>
                            <FieldLabel
                              htmlFor={`terminal-color-${key}`}
                              className="terminal-color-label"
                            >
                              {COLOR_LABELS[index]}
                            </FieldLabel>
                            <Input
                              id={`terminal-color-${key}`}
                              className="terminal-color-input"
                              value={field.state.value || ''}
                              placeholder="沿用主题"
                              maxLength={7}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                const value = event.target.value
                                if (value) field.handleChange(value)
                                else
                                  form.setFieldValue('colors', (colors) => {
                                    const next = { ...colors }
                                    delete next[key]
                                    return next
                                  })
                              }}
                              aria-invalid={invalid}
                              aria-describedby={`terminal-color-${key}-error`}
                            />
                            <FieldError
                              id={`terminal-color-${key}-error`}
                              className="terminal-color-error"
                              errors={field.state.meta.isTouched ? field.state.meta.errors : []}
                            />
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
              </details>
              {values.windowBlur !== window.desktop.initialAppearance.windowBlur && (
                <FieldDescription className="terminal-blur-restart-help">
                  保存后重启 Cota，以应用窗口背景模糊设置。降低背景不透明度可显现模糊效果。
                </FieldDescription>
              )}
              <FieldError className="terminal-appearance-save-error">{error}</FieldError>
              <div className="terminal-appearance-actions flex items-center justify-between gap-3">
                <Button
                  className="terminal-appearance-reset"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset(structuredClone(DEFAULT_TERMINAL_APPEARANCE))
                    setSaved(false)
                    setError(undefined)
                  }}
                >
                  恢复默认
                </Button>
                <div className="terminal-appearance-save-actions flex items-center gap-3">
                  <output className="terminal-appearance-save-status text-xs text-muted-foreground">
                    {saved ? '已保存' : ''}
                  </output>
                  <Button className="terminal-appearance-save" type="submit">
                    {submitting ? '保存中…' : '保存外观'}
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
