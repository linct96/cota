import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { Terminal } from '@xterm/xterm'
import { StableCellFitAddon } from '../lib/terminal-stable-cell-fit-addon'
import { installTerminalPreviewInput } from '../lib/terminal-preview-input'
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

const PREVIEW_PROMPT = '\x1b[34m~/cota\x1b[0m \x1b[35mmain\x1b[0m \x1b[32m❯\x1b[0m '
const PREVIEW_OUTPUT = [
  `${PREVIEW_PROMPT}pnpm test`,
  '\x1b[1;32m PASS \x1b[0m src/terminal.test.ts',
  ' \x1b[32m✓\x1b[0m 中文与 English 混排',
  ' \x1b[32m✓\x1b[0m theme updated  \x1b[2m12ms\x1b[0m',
  ' \x1b[33m⚠ preview mode · 示例输出\x1b[0m',
  '',
  `${PREVIEW_PROMPT}git diff`,
  '\x1b[36m@@ -1,2 +1,2 @@\x1b[0m',
  '\x1b[31m-const fontSize = 13;\x1b[0m',
  '\x1b[32m+const fontSize = 14;\x1b[0m',
  '',
  '\x1b[2;3m// 字体连字与字符辨识\x1b[0m',
  '\x1b[34mconst\x1b[0m ready = a !== b && count >= 1;',
  '=> -> === !== <= >=  0O 1Il {} []',
  '',
  '标准 \x1b[30m██ \x1b[31m██ \x1b[32m██ \x1b[33m██ \x1b[34m██ \x1b[35m██ \x1b[36m██ \x1b[37m██\x1b[0m',
  '高亮 \x1b[90m██ \x1b[91m██ \x1b[92m██ \x1b[93m██ \x1b[94m██ \x1b[95m██ \x1b[96m██ \x1b[97m██\x1b[0m',
  '',
].join('\r\n')

function TerminalAppearancePreview({ settings }: { settings: TerminalAppearance }) {
  const host = useRef<HTMLDivElement>(null)
  const currentSettings = useEffectEvent(() => settings)
  const apply = useRef<(value: TerminalAppearance) => void>(() => {})
  useEffect(() => {
    const container = host.current!
    const terminal = new Terminal({
      ...terminalAppearanceOptions(currentSettings()),
      cursorInactiveStyle: 'none',
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      scrollback: 1000,
      scrollbar: { width: 6 },
    })
    const fit = new StableCellFitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminal.textarea?.setAttribute('aria-label', '终端交互预览')
    terminal.textarea?.setAttribute('aria-describedby', 'terminal-appearance-preview-help')
    terminal.attachCustomKeyEventHandler((event) => event.key !== 'Tab')
    const appearance = installTerminalAppearance(terminal, container, () => fit.fit())
    const update = (value = currentSettings()) => {
      if (!terminalAppearanceSchema.safeParse(value).success) return
      appearance.update(value)
      fit.fit()
    }
    apply.current = update
    update()
    terminal.write(PREVIEW_OUTPUT)
    const input = installTerminalPreviewInput(terminal, PREVIEW_PROMPT)
    const showMouse = () => container.classList.remove('terminal-mouse-hidden')
    const hideMouse = (event: KeyboardEvent) => {
      if (
        currentSettings().mouseHideWhileTyping &&
        !event.metaKey &&
        !event.ctrlKey &&
        !['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)
      )
        container.classList.add('terminal-mouse-hidden')
    }
    container.addEventListener('keydown', hideMouse)
    container.addEventListener('pointermove', showMouse)
    container.addEventListener('pointerleave', showMouse)
    container.addEventListener('blur', showMouse, true)
    const observer = new ResizeObserver(() => update())
    observer.observe(container)
    const stopTheme = observeDocumentTheme(() => update())
    return () => {
      apply.current = () => {}
      observer.disconnect()
      stopTheme()
      container.removeEventListener('keydown', hideMouse)
      container.removeEventListener('pointermove', showMouse)
      container.removeEventListener('pointerleave', showMouse)
      container.removeEventListener('blur', showMouse, true)
      input.dispose()
      appearance.dispose()
      terminal.dispose()
    }
  }, [])
  useEffect(() => apply.current(settings), [settings])
  return (
    <section
      className="terminal-appearance-preview flex flex-col gap-1.5"
      aria-label="终端外观预览：包含示例测试输出、Git Diff、中英文、粗体、斜体、弱化文字、字体连字、易混淆字符、ANSI 十六色和光标示例"
    >
      <div className="terminal-appearance-preview-frame h-52 overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-ring/50">
        <div ref={host} className="terminal-appearance-preview-screen terminal-screen h-full" />
      </div>
      <p
        id="terminal-appearance-preview-help"
        className="terminal-appearance-preview-help text-xs text-muted-foreground"
      >
        点击输入或拖动选择，使用方向键、Home / End 移动光标；Enter 清空输入，Tab
        离开预览。仅供预览，不会执行命令。
      </p>
    </section>
  )
}

const hexSwatchPattern = /^#[\da-f]{6}$/i

export function TerminalAppearanceSettings({
  savePreferences,
}: {
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
    <section
      className="terminal-appearance-settings flex flex-col gap-3"
      aria-labelledby="terminal-appearance-title"
    >
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
              <div className="terminal-appearance-preview-section flex flex-col gap-2.5">
                <div className="terminal-appearance-heading flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="terminal-appearance-title"
                    className="terminal-appearance-title settings-section-title"
                  >
                    实时预览
                  </h2>
                  <div className="terminal-appearance-actions flex items-center gap-2">
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
                        size="sm"
                        disabled={saving || !terminalAppearanceSchema.safeParse(values).success}
                        onClick={() => void saveAppearance(form.state.values)}
                      >
                        重试保存
                      </Button>
                    )}
                    <Button
                      className="terminal-appearance-reset"
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const defaults = structuredClone(DEFAULT_TERMINAL_APPEARANCE)
                        form.reset(defaults)
                        void saveAppearance(defaults)
                      }}
                    >
                      恢复默认
                    </Button>
                  </div>
                </div>
                <TerminalAppearancePreview settings={values} />
                <FieldError className="terminal-appearance-save-error">{error}</FieldError>
              </div>

              <FieldGroup className="terminal-appearance-groups gap-6">
                {APPEARANCE_GROUPS.map((group) => {
                  const isGridNumberGroup =
                    group.name === 'typography' || group.name === 'background'
                  const numberFields = NUMBER_FIELDS.filter(
                    (field) => field.group === group.name,
                  ).map(({ name, label, min, max, step }) => (
                    <form.Field key={name} name={name}>
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
                            className={cn(
                              'terminal-appearance-number-field',
                              isGridNumberGroup
                                ? 'gap-1.5'
                                : 'min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3',
                            )}
                            data-invalid={invalid}
                          >
                            <label
                              htmlFor={`terminal-${name}`}
                              className={cn(
                                'terminal-appearance-number-label text-xs leading-5 font-medium text-foreground',
                                !isGridNumberGroup && 'min-w-0 flex-1 basis-64',
                              )}
                            >
                              {label}
                              <span
                                id={`terminal-${name}-help`}
                                className="terminal-appearance-number-range ml-1 text-xs font-normal text-muted-foreground tabular-nums"
                              >
                                ({min}–{max})
                              </span>
                            </label>
                            <Input
                              id={`terminal-${name}`}
                              className={cn(
                                'terminal-appearance-number-input font-mono tabular-nums',
                                !isGridNumberGroup && 'w-28 max-w-full shrink-0',
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
                                  !isGridNumberGroup && 'basis-full',
                                )}
                                role="alert"
                              >
                                {errorMessage}
                              </p>
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))
                  const choiceFields = ENUM_FIELDS.filter(
                    (field) => field.group === group.name,
                  ).map(({ name, label, options }) => (
                    <form.Field key={name} name={name}>
                      {(field) => (
                        <Field className="terminal-appearance-choice-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                          <p
                            id={`terminal-${name}-label`}
                            className="terminal-appearance-choice-label min-w-0 flex-1 basis-64 text-xs leading-5 font-medium text-foreground"
                          >
                            {label}
                          </p>
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
                  ))
                  return (
                    <section
                      key={group.name}
                      className="terminal-appearance-group flex min-w-0 flex-col gap-2.5"
                      aria-labelledby={`terminal-appearance-${group.name}-title`}
                    >
                      <h3
                        id={`terminal-appearance-${group.name}-title`}
                        className="terminal-appearance-group-title settings-section-title"
                      >
                        {group.label}
                      </h3>
                      <Card
                        size="sm"
                        className="terminal-appearance-card gap-0 divide-y divide-border py-0"
                      >
                        {group.name === 'typography' ? (
                          <>
                            <form.Field name="fontFamily">
                              {(field) => (
                                <Field
                                  className="terminal-font-family-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                                  data-invalid={
                                    field.state.meta.isTouched && !field.state.meta.isValid
                                  }
                                >
                                  <div className="terminal-font-family-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                                    <span
                                      id="terminal-font-family-label"
                                      className="terminal-font-family-label text-xs leading-5 font-medium text-foreground"
                                    >
                                      字体
                                    </span>
                                    <FieldDescription
                                      id="terminal-font-family-help"
                                      className="terminal-font-family-description"
                                    >
                                      使用已安装的等宽字体；可用逗号设置回退字体。
                                    </FieldDescription>
                                    <FieldError
                                      id="terminal-font-family-error"
                                      className="terminal-font-family-error"
                                      errors={
                                        field.state.meta.isTouched ? field.state.meta.errors : []
                                      }
                                    />
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
                                      className="terminal-font-family-input w-60 min-w-0 max-w-full shrink-0 font-mono"
                                      spellCheck={false}
                                      autoCorrect="off"
                                      autoCapitalize="off"
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
                                            className="terminal-font-suggestion font-mono"
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
                              )}
                            </form.Field>
                            {choiceFields}
                            <FieldGroup className="terminal-appearance-numbers grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
                              {numberFields}
                            </FieldGroup>
                            <form.Field name="contrastMode">
                              {(field) => (
                                <Field className="terminal-contrast-mode-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                                  <div className="terminal-contrast-mode-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                                    <p
                                      id="terminal-contrastMode-label"
                                      className="terminal-contrast-mode-label text-xs leading-5 font-medium text-foreground"
                                    >
                                      文字对比度
                                    </p>
                                    <FieldDescription
                                      id="terminal-contrast-mode-description"
                                      className="terminal-contrast-mode-description"
                                    >
                                      自动根据背景明暗增强低对比度文字的可读性；关闭则保留原始颜色。
                                    </FieldDescription>
                                  </div>
                                  <ToggleGroup
                                    className="terminal-contrast-mode-options shrink-0"
                                    variant="outline"
                                    spacing={0}
                                    value={[field.state.value]}
                                    aria-labelledby="terminal-contrastMode-label"
                                    aria-describedby="terminal-contrast-mode-description"
                                    onBlur={field.handleBlur}
                                    onValueChange={([value]) => {
                                      if (value !== 'auto' && value !== 'off' && value !== 'custom')
                                        return
                                      field.handleChange(value)
                                      setSaved(false)
                                    }}
                                  >
                                    <ToggleGroupItem
                                      className="terminal-contrast-mode-option"
                                      value="auto"
                                    >
                                      自动
                                    </ToggleGroupItem>
                                    <ToggleGroupItem
                                      className="terminal-contrast-mode-option"
                                      value="off"
                                    >
                                      关闭
                                    </ToggleGroupItem>
                                    <ToggleGroupItem
                                      className="terminal-contrast-mode-option"
                                      value="custom"
                                    >
                                      自定义
                                    </ToggleGroupItem>
                                  </ToggleGroup>
                                </Field>
                              )}
                            </form.Field>
                            {values.contrastMode === 'custom' && (
                              <form.Field name="minimumContrastRatio">
                                {(field) => {
                                  const invalid =
                                    field.state.meta.isTouched && !field.state.meta.isValid

                                  return (
                                    <Field
                                      className="terminal-contrast-ratio-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                                      data-invalid={invalid}
                                    >
                                      <div className="terminal-contrast-ratio-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                                        <label
                                          htmlFor="terminal-minimumContrastRatio"
                                          className="terminal-contrast-ratio-label text-xs leading-5 font-medium text-foreground"
                                        >
                                          最低对比度
                                          <span
                                            id="terminal-minimumContrastRatio-help"
                                            className="terminal-contrast-ratio-range ml-1.5 text-xs font-normal text-muted-foreground tabular-nums"
                                          >
                                            (1–21)
                                          </span>
                                        </label>
                                        <FieldDescription
                                          id="terminal-minimumContrastRatio-description"
                                          className="terminal-contrast-ratio-description"
                                        >
                                          推荐 4.5（WCAG AA）或 7.0（WCAG
                                          AAA）。数值越高文字越醒目。
                                        </FieldDescription>
                                      </div>
                                      <Input
                                        id="terminal-minimumContrastRatio"
                                        className="terminal-contrast-ratio-input w-28 max-w-full shrink-0 font-mono tabular-nums"
                                        type="number"
                                        min={1}
                                        max={21}
                                        step={0.1}
                                        value={
                                          Number.isNaN(field.state.value) ? '' : field.state.value
                                        }
                                        onBlur={field.handleBlur}
                                        onChange={(event) => {
                                          field.handleChange(event.target.valueAsNumber)
                                          setSaved(false)
                                        }}
                                        aria-invalid={invalid}
                                        aria-describedby="terminal-minimumContrastRatio-help terminal-minimumContrastRatio-description terminal-minimumContrastRatio-error"
                                      />
                                      <FieldError
                                        id="terminal-minimumContrastRatio-error"
                                        className="terminal-contrast-ratio-error basis-full"
                                        errors={
                                          field.state.meta.isTouched ? field.state.meta.errors : []
                                        }
                                      />
                                    </Field>
                                  )
                                }}
                              </form.Field>
                            )}
                          </>
                        ) : (
                          <>
                            {numberFields.length > 0 &&
                              (group.name === 'cursor' ? (
                                numberFields
                              ) : (
                                <FieldGroup className="terminal-appearance-numbers grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3">
                                  {numberFields}
                                </FieldGroup>
                              ))}
                            {choiceFields}
                            {SWITCH_FIELDS.filter((field) => field.group === group.name).map(
                              ({ name, label }) => (
                                <form.Field key={name} name={name}>
                                  {(field) => (
                                    <Field className="terminal-appearance-switch-field min-h-7 flex-row items-center justify-between gap-4 px-4 py-3">
                                      <div className="terminal-appearance-switch-text flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span
                                          id={`terminal-${name}-label`}
                                          className="terminal-appearance-switch-label text-xs leading-5 font-medium text-foreground"
                                        >
                                          {label}
                                        </span>
                                        {name === 'windowBlur' &&
                                          values.windowBlur !==
                                            window.desktop.initialAppearance.windowBlur && (
                                            <FieldDescription className="terminal-blur-restart-help">
                                              重启
                                              Cota，以应用窗口背景模糊设置。提高背景透明度可显现模糊效果。
                                            </FieldDescription>
                                          )}
                                      </div>
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
                            {group.name === 'theme' && (
                              <>
                                {(['themeDark', 'themeLight'] as const).map((name) =>
                                  name === 'themeLight' && !values.separateLightTheme ? null : (
                                    <form.Field key={name} name={name}>
                                      {(field) => (
                                        <Field className="terminal-theme-field min-h-7 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                                          <span
                                            id={`terminal-${name}-label`}
                                            className="terminal-theme-label text-xs leading-5 font-medium text-foreground"
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
                                                <SelectItem
                                                  className="terminal-theme-item"
                                                  value="auto"
                                                >
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
                                <Collapsible className="terminal-color-overrides px-4 py-2">
                                  <CollapsibleTrigger
                                    className="terminal-color-overrides-trigger group/terminal-colors w-full justify-between px-1"
                                    render={<Button type="button" variant="ghost" />}
                                  >
                                    自定义颜色与 ANSI 调色板
                                    <ChevronDown
                                      className="terminal-color-overrides-chevron transition-transform group-data-panel-open/terminal-colors:rotate-180"
                                      data-icon="inline-end"
                                    />
                                  </CollapsibleTrigger>
                                  <CollapsibleContent
                                    keepMounted
                                    className="terminal-color-overrides-content pb-2"
                                  >
                                    <p className="terminal-color-overrides-help mt-2 px-1 text-xs text-muted-foreground">
                                      留空沿用配色主题；输入 #RRGGBB 覆盖对应颜色。
                                    </p>
                                    <FieldGroup className="terminal-color-fields mt-3 grid grid-cols-2 gap-3 px-1 sm:grid-cols-3 md:grid-cols-4">
                                      {TERMINAL_COLOR_KEYS.map((key, index) => (
                                        <form.Field key={key} name={`colors.${key}`}>
                                          {(field) => {
                                            const invalid =
                                              field.state.meta.isTouched &&
                                              !field.state.meta.isValid
                                            const currentHex = field.state.value || ''
                                            const validHex = hexSwatchPattern.test(currentHex)

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
                                              <Field
                                                className="terminal-color-field gap-1.5"
                                                data-invalid={invalid}
                                              >
                                                <label
                                                  htmlFor={`terminal-color-${key}`}
                                                  className="terminal-color-label flex items-center justify-between gap-1.5 text-xs leading-5 font-medium text-foreground"
                                                >
                                                  <span className="terminal-color-label-text truncate">
                                                    {COLOR_LABELS[index]}
                                                  </span>
                                                  {validHex && (
                                                    <span
                                                      className="terminal-color-swatch size-3 shrink-0 rounded-xs border border-border"
                                                      style={{ backgroundColor: currentHex }}
                                                      aria-hidden="true"
                                                    />
                                                  )}
                                                </label>
                                                <Input
                                                  id={`terminal-color-${key}`}
                                                  className="terminal-color-input font-mono"
                                                  value={currentHex}
                                                  placeholder="沿用主题"
                                                  maxLength={7}
                                                  spellCheck={false}
                                                  autoCorrect="off"
                                                  autoCapitalize="off"
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
                              </>
                            )}
                          </>
                        )}
                      </Card>
                    </section>
                  )
                })}
              </FieldGroup>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
