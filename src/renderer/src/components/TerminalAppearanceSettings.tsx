import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '../lib/terminal-stable-cell-fit-addon'
import { installTerminalAppearance, terminalAppearanceOptions } from '../lib/terminal-appearance'
import { observeDocumentTheme } from '../lib/theme'
import { cn } from '../lib/utils'
import { useWorkspace } from '../store'
import {
  DEFAULT_TERMINAL_APPEARANCE,
  TERMINAL_COLOR_KEYS,
  terminalAppearanceSchema,
  type TerminalAppearance,
} from '../../../shared/terminal-appearance'
import { TERMINAL_THEME_CATALOG } from '../../../shared/terminal-themes'
import type { Preferences } from '../../../shared/contracts'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Separator } from './ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox'
import { Field, FieldDescription, FieldError, FieldGroup } from './ui/field'
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

const FONT_SUGGESTIONS = [
  'Consolas',
  'Cascadia Code',
  'JetBrains Mono',
  'Fira Code',
  'Menlo',
  'Monaco',
  'monospace',
]

const APPEARANCE_GROUPS = [
  { name: 'typography', label: '字体' },
  { name: 'cursor', label: '光标与鼠标' },
  { name: 'background', label: '背景与留白' },
  { name: 'theme', label: '配色' },
] as const

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
    label: '背景透明度',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'background',
  },
  { name: 'paddingX', label: '水平内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
  { name: 'paddingY', label: '垂直内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
] as const
const ENUM_FIELDS = [
  {
    name: 'ligatures',
    label: '字体连字',
    group: 'typography',
    options: [
      ['auto', '自动'],
      ['on', '开启'],
      ['off', '关闭'],
    ],
  },
  {
    name: 'cursorStyle',
    label: '光标形状',
    group: 'cursor',
    options: [
      ['bar', '竖线'],
      ['block', '方块'],
      ['underline', '下划线'],
    ],
  },
] as const
const SWITCH_FIELDS = [
  { name: 'separateLightTheme', label: '浅色模式使用独立配色', group: 'theme' },
  { name: 'cursorBlink', label: '光标闪烁', group: 'cursor' },
  { name: 'windowBlur', label: '窗口背景模糊（重启后生效）', group: 'background' },
  { name: 'mouseHideWhileTyping', label: '输入时隐藏鼠标指针', group: 'cursor' },
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
  const host = useRef<HTMLDivElement>(null)
  const currentSettings = useEffectEvent(() => settings)
  const apply = useRef<(value: TerminalAppearance) => void>(() => {})
  useEffect(() => {
    const container = host.current!
    const terminal = new Terminal({
      ...terminalAppearanceOptions(currentSettings()),
      disableStdin: true,
      showCursorImmediately: true,
      scrollback: 0,
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    const appearance = installTerminalAppearance(terminal, container)
    const update = (value = currentSettings()) => {
      if (!terminalAppearanceSchema.safeParse(value).success) return
      appearance.update(value)
      terminal.options.cursorInactiveStyle = value.cursorStyle
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
      className="terminal-appearance-preview h-56 overflow-hidden rounded-lg border"
      aria-label="终端外观预览：包含粗体、彩色输出、字体连字和光标示例"
    >
      <div
        ref={host}
        inert
        data-cursor-blink={settings.cursorBlink}
        className="terminal-appearance-preview-screen pointer-events-none h-full select-none"
      />
    </section>
  )
}

export function TerminalAppearanceSettings({
  renderGeneralSettings,
  savePreferences,
}: {
  renderGeneralSettings: (contrastSettings: ReactNode) => ReactNode
  savePreferences: (patch: Partial<Preferences>) => Promise<void>
}) {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialValues] = useState(() =>
    structuredClone(useWorkspace.getState().preferences.terminalAppearance),
  )
  const lastQueued = useRef(JSON.stringify(initialValues))
  const latestSave = useRef<Promise<void> | null>(null)
  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: terminalAppearanceSchema },
    listeners: {
      onChange: ({ formApi }) => void saveAppearance(formApi.state.values),
    },
  })

  async function saveAppearance(value: TerminalAppearance) {
    const parsed = terminalAppearanceSchema.safeParse({
      ...value,
      fontFamily: value.fontFamily.trim(),
    })
    setSaved(false)
    if (!parsed.success) return
    const signature = JSON.stringify(parsed.data)
    if (signature === lastQueued.current) return
    lastQueued.current = signature
    setError(undefined)
    setSaving(true)
    const operation = savePreferences({ terminalAppearance: parsed.data })
    latestSave.current = operation
    try {
      await operation
      if (latestSave.current === operation) setSaved(true)
    } catch (cause) {
      if (latestSave.current === operation) {
        lastQueued.current = ''
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    } finally {
      if (latestSave.current === operation) setSaving(false)
    }
  }
  return (
    <>
      {renderGeneralSettings(
        <form.Subscribe selector={(state) => state.values.contrastMode}>
          {(contrastMode) => (
            <fieldset
              className="terminal-contrast-settings flex min-w-0 flex-col gap-4"
              aria-busy={saving}
            >
              <form.Field name="contrastMode">
                {(field) => (
                  <Field className="terminal-contrast-mode-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8">
                    <div className="terminal-contrast-mode-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                      <p
                        id="terminal-contrastMode-label"
                        className="terminal-contrast-mode-label text-sm leading-5 font-medium"
                      >
                        文字对比度
                      </p>
                      <p
                        id="terminal-contrast-mode-description"
                        className="terminal-contrast-mode-description text-xs text-muted-foreground"
                      >
                        修改后自动保存，实时应用到所有终端。
                      </p>
                    </div>
                    <ToggleGroup
                      className="terminal-contrast-mode-options shrink-0"
                      variant="outline"
                      size="lg"
                      spacing={0}
                      value={[field.state.value]}
                      aria-labelledby="terminal-contrastMode-label"
                      aria-describedby="terminal-contrast-mode-description"
                      onBlur={field.handleBlur}
                      onValueChange={([value]) => {
                        if (value !== 'auto' && value !== 'off' && value !== 'custom') return
                        field.handleChange(value)
                        setSaved(false)
                      }}
                    >
                      <ToggleGroupItem className="terminal-contrast-mode-option" value="auto">
                        自动
                      </ToggleGroupItem>
                      <ToggleGroupItem className="terminal-contrast-mode-option" value="off">
                        关闭
                      </ToggleGroupItem>
                      <ToggleGroupItem className="terminal-contrast-mode-option" value="custom">
                        自定义
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                )}
              </form.Field>
              {contrastMode === 'custom' && (
                <>
                  <Separator className="terminal-contrast-separator" />
                  <form.Field name="minimumContrastRatio">
                    {(field) => {
                      const invalid = field.state.meta.isTouched && !field.state.meta.isValid

                      const errorMessage = [
                        ...new Set(
                          (field.state.meta.isTouched ? field.state.meta.errors : [])
                            .map((error) => error?.message)
                            .filter(Boolean),
                        ),
                      ].join(' ')
                      return (
                        <Field
                          className="terminal-contrast-ratio-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
                          data-invalid={invalid}
                        >
                          <label
                            htmlFor="terminal-minimumContrastRatio"
                            className="terminal-contrast-ratio-label min-w-0 flex-1 basis-64 text-sm leading-5 font-medium"
                          >
                            最低对比度
                            <span
                              id="terminal-minimumContrastRatio-help"
                              className="terminal-contrast-ratio-range text-xs font-normal text-muted-foreground"
                            >
                              （1–21）
                            </span>
                          </label>
                          <Input
                            id="terminal-minimumContrastRatio"
                            className="terminal-contrast-ratio-input w-32 max-w-full shrink-0"
                            form="terminal-appearance-form"
                            type="number"
                            min={1}
                            max={21}
                            step={0.1}
                            value={Number.isNaN(field.state.value) ? '' : field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => {
                              field.handleChange(event.target.valueAsNumber)
                              setSaved(false)
                            }}
                            aria-invalid={invalid}
                            aria-describedby="terminal-minimumContrastRatio-help terminal-minimumContrastRatio-error"
                          />
                          {errorMessage && (
                            <p
                              id="terminal-minimumContrastRatio-error"
                              className="terminal-contrast-ratio-error basis-full text-xs text-destructive"
                              role="alert"
                            >
                              {errorMessage}
                            </p>
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                </>
              )}
            </fieldset>
          )}
        </form.Subscribe>,
      )}
      <section
        className="terminal-appearance-settings flex flex-col gap-3"
        aria-labelledby="terminal-appearance-title"
      >
        <div className="terminal-appearance-heading flex flex-col gap-3">
          <h4
            id="terminal-appearance-title"
            className="terminal-appearance-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
          >
            终端预览
          </h4>
        </div>
        <form
          id="terminal-appearance-form"
          className="terminal-appearance-form flex flex-col gap-6"
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <fieldset
                className="terminal-appearance-controls flex min-w-0 flex-col gap-6"
                aria-busy={saving}
              >
                <TerminalAppearancePreview settings={values} />
                <FieldGroup className="terminal-appearance-groups gap-6">
                  {APPEARANCE_GROUPS.map((group) => (
                    <section
                      key={group.name}
                      className="terminal-appearance-group flex min-w-0 flex-col gap-3"
                      aria-labelledby={`terminal-appearance-${group.name}-title`}
                    >
                      <h4
                        id={`terminal-appearance-${group.name}-title`}
                        className="terminal-appearance-group-title text-sm font-normal text-muted-foreground"
                      >
                        {group.label}
                      </h4>
                      <Card className="terminal-appearance-card">
                        {group.name === 'typography' && (
                          <form.Field name="fontFamily">
                            {(field) => {
                              const errorMessage = [
                                ...new Set(
                                  (field.state.meta.isTouched ? field.state.meta.errors : [])
                                    .map((error) => error?.message)
                                    .filter(Boolean),
                                ),
                              ].join(' ')
                              return (
                                <Field
                                  className="terminal-font-family-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
                                  data-invalid={
                                    field.state.meta.isTouched && !field.state.meta.isValid
                                  }
                                >
                                  <div className="terminal-font-family-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                                    <span
                                      id="terminal-font-family-label"
                                      className="terminal-font-family-label text-sm leading-5 font-medium"
                                    >
                                      字体
                                    </span>
                                    <p
                                      id="terminal-font-family-help"
                                      className="terminal-font-family-description text-xs text-muted-foreground"
                                    >
                                      使用已安装的等宽字体；可用逗号设置回退字体。
                                    </p>
                                    {errorMessage && (
                                      <p
                                        id="terminal-font-family-error"
                                        className="terminal-font-family-error text-xs text-destructive"
                                        role="alert"
                                      >
                                        {errorMessage}
                                      </p>
                                    )}
                                  </div>
                                  <Combobox
                                    items={FONT_SUGGESTIONS}
                                    value={field.state.value}
                                    inputValue={field.state.value}
                                    onInputValueChange={(value) => {
                                      field.handleChange(value)
                                      setSaved(false)
                                    }}
                                    onValueChange={(value) => {
                                      if (value === null) return
                                      field.handleChange(value)
                                      setSaved(false)
                                    }}
                                  >
                                    <ComboboxInput
                                      id="terminal-font-family"
                                      aria-labelledby="terminal-font-family-label"
                                      className="terminal-font-family-input w-64 min-w-0 max-w-full shrink-0"
                                      onBlur={field.handleBlur}
                                      aria-invalid={
                                        field.state.meta.isTouched && !field.state.meta.isValid
                                      }
                                      aria-describedby="terminal-font-family-help terminal-font-family-error"
                                    />
                                    <ComboboxContent className="terminal-font-suggestions w-(--anchor-width)">
                                      <ComboboxEmpty className="terminal-font-suggestions-empty">
                                        无匹配建议，可继续使用输入的字体。
                                      </ComboboxEmpty>
                                      <ComboboxList className="terminal-font-suggestions-list">
                                        {(font: string) => (
                                          <ComboboxItem
                                            className="terminal-font-suggestion"
                                            key={font}
                                            value={font}
                                          >
                                            {font}
                                          </ComboboxItem>
                                        )}
                                      </ComboboxList>
                                    </ComboboxContent>
                                  </Combobox>
                                </Field>
                              )
                            }}
                          </form.Field>
                        )}
                        {NUMBER_FIELDS.some((field) => field.group === group.name) && (
                          <>
                            <FieldGroup
                              className={cn(
                                'terminal-appearance-numbers',
                                group.name !== 'typography' &&
                                  'grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4 px-5',
                              )}
                            >
                              {NUMBER_FIELDS.filter((field) => field.group === group.name).map(
                                ({ name, label, min, max, step }) => (
                                  <form.Field key={name} name={name}>
                                    {(field) => {
                                      const invalid =
                                        field.state.meta.isTouched && !field.state.meta.isValid

                                      const errorMessage = [
                                        ...new Set(
                                          (field.state.meta.isTouched
                                            ? field.state.meta.errors
                                            : []
                                          )
                                            .map((error) => error?.message)
                                            .filter(Boolean),
                                        ),
                                      ].join(' ')
                                      return (
                                        <>
                                          {group.name === 'typography' && (
                                            <Separator className="terminal-appearance-number-separator" />
                                          )}
                                          <Field
                                            className={cn(
                                              'terminal-appearance-number-field',
                                              group.name === 'typography' &&
                                                'min-h-8 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5',
                                            )}
                                            data-invalid={invalid}
                                          >
                                            <label
                                              htmlFor={`terminal-${name}`}
                                              className={cn(
                                                'terminal-appearance-number-label text-sm font-medium leading-5',
                                                group.name === 'typography' &&
                                                  'min-w-0 flex-1 basis-64',
                                              )}
                                            >
                                              {label}
                                              <span
                                                id={`terminal-${name}-help`}
                                                className="terminal-appearance-number-range text-xs font-normal text-muted-foreground"
                                              >
                                                （{min}–{max}）
                                              </span>
                                            </label>
                                            <Input
                                              id={`terminal-${name}`}
                                              className={cn(
                                                'terminal-appearance-number-input',
                                                group.name === 'typography' &&
                                                  'w-32 max-w-full shrink-0',
                                              )}
                                              type="number"
                                              min={min}
                                              max={max}
                                              step={step}
                                              value={
                                                Number.isNaN(field.state.value)
                                                  ? ''
                                                  : name === 'backgroundOpacity'
                                                    ? Number((1 - field.state.value).toFixed(2))
                                                    : field.state.value
                                              }
                                              onBlur={field.handleBlur}
                                              onChange={(event) =>
                                                field.handleChange(
                                                  name === 'backgroundOpacity'
                                                    ? 1 - event.target.valueAsNumber
                                                    : event.target.valueAsNumber,
                                                )
                                              }
                                              aria-invalid={invalid}
                                              aria-describedby={`terminal-${name}-help${name === 'backgroundOpacity' ? ' terminal-background-opacity-description' : ''} terminal-${name}-error`}
                                            />
                                            {name === 'backgroundOpacity' && (
                                              <p
                                                id="terminal-background-opacity-description"
                                                className="terminal-appearance-number-description text-xs text-muted-foreground"
                                              >
                                                0 为不透明，1 为完全透明
                                              </p>
                                            )}
                                            {errorMessage && (
                                              <p
                                                id={`terminal-${name}-error`}
                                                className={cn(
                                                  'terminal-appearance-number-error text-xs text-destructive',
                                                  group.name === 'typography' && 'basis-full',
                                                )}
                                                role="alert"
                                              >
                                                {errorMessage}
                                              </p>
                                            )}
                                          </Field>
                                        </>
                                      )
                                    }}
                                  </form.Field>
                                ),
                              )}
                            </FieldGroup>
                            <Separator className="terminal-appearance-group-separator" />
                          </>
                        )}
                        {ENUM_FIELDS.filter((field) => field.group === group.name).map(
                          ({ name, label, options }) => (
                            <form.Field key={name} name={name}>
                              {(field) => (
                                <Field className="terminal-appearance-choice-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8">
                                  <p
                                    id={`terminal-${name}-label`}
                                    className={cn(
                                      'terminal-appearance-choice-label text-sm font-medium leading-5',
                                      group.name === 'typography' && 'min-w-0 flex-1 basis-64',
                                    )}
                                  >
                                    {label}
                                  </p>
                                  <ToggleGroup
                                    className="terminal-appearance-choices"
                                    variant="outline"
                                    size="lg"
                                    spacing={0}
                                    value={[field.state.value]}
                                    aria-labelledby={`terminal-${name}-label`}
                                    onBlur={field.handleBlur}
                                    onValueChange={([value]) => {
                                      if (!value || !options.some(([option]) => option === value))
                                        return
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
                          ),
                        )}
                        {SWITCH_FIELDS.filter((field) => field.group === group.name).map(
                          ({ name, label }) => (
                            <form.Field key={name} name={name}>
                              {(field) => (
                                <Field className="terminal-appearance-switch-field min-h-8 flex-row items-center justify-between gap-4 px-5">
                                  <span
                                    id={`terminal-${name}-label`}
                                    className="terminal-appearance-switch-label text-sm font-medium leading-5"
                                  >
                                    {label}
                                  </span>
                                  <Switch
                                    id={`terminal-${name}`}
                                    aria-labelledby={`terminal-${name}-label`}
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
                                </Field>
                              )}
                            </form.Field>
                          ),
                        )}
                        {group.name === 'theme' &&
                          (['themeDark', 'themeLight'] as const).map((name) =>
                            name === 'themeLight' && !values.separateLightTheme ? null : (
                              <form.Field key={name} name={name}>
                                {(field) => (
                                  <Field className="terminal-theme-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8">
                                    <span
                                      id={`terminal-${name}-label`}
                                      className="terminal-theme-label text-sm font-medium leading-5"
                                    >
                                      {name === 'themeDark' ? '深色模式配色' : '浅色模式配色'}
                                    </span>
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
                                        aria-labelledby={`terminal-${name}-label`}
                                        className="terminal-theme-trigger min-w-0 max-w-full"
                                        onBlur={field.handleBlur}
                                      >
                                        <SelectValue className="terminal-theme-value">
                                          {field.state.value === 'auto'
                                            ? '跟随应用主题'
                                            : field.state.value}
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
                      </Card>
                    </section>
                  ))}
                </FieldGroup>
                <Card className="terminal-color-overrides-card">
                  <Collapsible className="terminal-color-overrides px-5">
                    <CollapsibleTrigger
                      className="terminal-color-overrides-trigger group/terminal-colors w-full justify-between"
                      render={<Button type="button" variant="ghost" size="lg" />}
                    >
                      自定义颜色与 ANSI 调色板
                      <ChevronDown
                        className="terminal-color-overrides-chevron group-data-panel-open/terminal-colors:rotate-180"
                        data-icon="inline-end"
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent keepMounted className="terminal-color-overrides-content">
                      <p className="terminal-color-overrides-help mt-3 text-xs text-muted-foreground">
                        留空沿用配色主题；输入 #RRGGBB 覆盖对应颜色。
                      </p>
                      <FieldGroup className="terminal-color-fields mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4">
                        {TERMINAL_COLOR_KEYS.map((key, index) => (
                          <form.Field key={key} name={`colors.${key}`}>
                            {(field) => {
                              const invalid =
                                field.state.meta.isTouched && !field.state.meta.isValid

                              const errorMessage = [
                                ...new Set(
                                  (field.state.meta.isTouched ? field.state.meta.errors : [])
                                    .map((error) => error?.message)
                                    .filter(Boolean),
                                ),
                              ].join(' ')
                              return (
                                <Field className="terminal-color-field" data-invalid={invalid}>
                                  <label
                                    htmlFor={`terminal-color-${key}`}
                                    className="terminal-color-label text-sm font-medium leading-5"
                                  >
                                    {COLOR_LABELS[index]}
                                  </label>
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
                                      else {
                                        form.setFieldValue('colors', (colors) => {
                                          const next = { ...colors }
                                          delete next[key]
                                          return next
                                        })
                                        void saveAppearance(form.state.values)
                                      }
                                    }}
                                    aria-invalid={invalid}
                                    aria-describedby={`terminal-color-${key}-error`}
                                  />
                                  {errorMessage && (
                                    <p
                                      id={`terminal-color-${key}-error`}
                                      className="terminal-color-error text-xs text-destructive"
                                      role="alert"
                                    >
                                      {errorMessage}
                                    </p>
                                  )}
                                </Field>
                              )
                            }}
                          </form.Field>
                        ))}
                      </FieldGroup>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
                {values.windowBlur !== window.desktop.initialAppearance.windowBlur && (
                  <FieldDescription className="terminal-blur-restart-help">
                    重启 Cota，以应用窗口背景模糊设置。提高背景透明度可显现模糊效果。
                  </FieldDescription>
                )}
                <FieldError className="terminal-appearance-save-error">{error}</FieldError>
                <div className="terminal-appearance-actions flex flex-wrap items-center justify-between gap-3">
                  <Button
                    className="terminal-appearance-reset"
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      const defaults = structuredClone(DEFAULT_TERMINAL_APPEARANCE)
                      form.reset(defaults)
                      void saveAppearance(defaults)
                    }}
                  >
                    恢复默认
                  </Button>
                  <div className="terminal-appearance-save-actions ml-auto flex items-center gap-3">
                    <output className="terminal-appearance-save-status text-xs text-muted-foreground">
                      {saving
                        ? '自动保存中…'
                        : saved && terminalAppearanceSchema.safeParse(values).success
                          ? '已自动保存'
                          : ''}
                    </output>
                    {error && (
                      <Button
                        className="terminal-appearance-retry"
                        type="button"
                        size="lg"
                        disabled={saving || !terminalAppearanceSchema.safeParse(values).success}
                        onClick={() => void saveAppearance(form.state.values)}
                      >
                        重试保存
                      </Button>
                    )}
                  </div>
                </div>
              </fieldset>
            )}
          </form.Subscribe>
        </form>
      </section>
    </>
  )
}
