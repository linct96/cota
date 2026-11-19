import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { scrollbackFormSchema, shellFormSchema } from '@/features/settings/schemas'
import { isWindows } from '@/lib/platform'
import { abbreviateHomePath, folderName } from '@/lib/utils'
import { unwrap } from '../../../../../shared/contracts'
import type { Preferences } from '../../../../../shared/contracts'
import { terminalAppearanceSchema } from '../../../../../shared/terminal-appearance'
import { useWorkspace } from '@/state/workspace'
import { TerminalAppearanceSettings } from './TerminalAppearanceSettings'
import { TerminalFontFamilyField } from './terminal-appearance/TerminalFontFamilyField'
import { TerminalSettingRow } from './terminal-appearance/TerminalSettingRow'
import { useTerminalAppearanceForm } from './terminal-appearance/use-terminal-appearance-form'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { InputNumber } from '@/components/ui/input-number'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ScrollbackOption {
  value: number
  label: string
}

const PRESET_SCROLLBACKS: ScrollbackOption[] = [
  { value: 1000, label: '1,000 行' },
  { value: 5000, label: '5,000 行（默认）' },
  { value: 10000, label: '10,000 行' },
  { value: 20000, label: '20,000 行' },
]

export function TerminalSettings() {
  const preferences = useWorkspace((state) => state.preferences)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [renderError, setRenderError] = useState<string>()

  // 自定义 Shell 弹窗状态
  const [shellDialogOpen, setShellDialogOpen] = useState(false)
  const [shellError, setShellError] = useState<string>()
  const [defaultShellPath, setDefaultShellPath] = useState<string>()
  const [defaultShellError, setDefaultShellError] = useState<string>()
  const defaultShellLabel = defaultShellPath
    ? `系统默认（${folderName(defaultShellPath)}）`
    : defaultShellError
      ? '系统默认（读取失败）'
      : '系统默认'

  // 自定义缓冲行数弹窗状态
  const [scrollbackDialogOpen, setScrollbackDialogOpen] = useState(false)
  const [scrollbackError, setScrollbackError] = useState<string>()
  const persisting = useRef(false)
  const pendingPreferences = useRef(Promise.resolve())
  const shellForm = useForm({
    defaultValues: { name: '', path: '' },
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: shellFormSchema },
    onSubmit: async ({ value }) => {
      setShellError(undefined)
      if (await persist({ shellName: value.name.trim() || null, shellPath: value.path.trim() })) {
        setShellDialogOpen(false)
      }
    },
  })
  const scrollbackForm = useForm({
    defaultValues: { scrollback: String(preferences.scrollback) },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: scrollbackFormSchema },
    onSubmit: async ({ value }) => {
      setScrollbackError(undefined)
      if (await persist({ scrollback: Number(value.scrollback) })) setScrollbackDialogOpen(false)
    },
  })

  useEffect(() => {
    let cancelled = false
    void window.desktop
      .getDefaultShell()
      .then(unwrap)
      .then((path) => {
        if (!cancelled) setDefaultShellPath(path)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setDefaultShellError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  function savePreferences(patch: Partial<Preferences>) {
    // 串行合并最新配置，避免常规设置与外观自动保存互相覆盖。
    const operation = pendingPreferences.current.then(() => {
      const state = useWorkspace.getState()
      return state.savePreferences({ ...state.preferences, ...patch })
    })
    pendingPreferences.current = operation.catch(() => {})
    return operation
  }

  const appearance = useTerminalAppearanceForm(savePreferences)

  async function persist(patch: Partial<Preferences>) {
    if (persisting.current || !useWorkspace.getState().ready) return false
    persisting.current = true
    setSaving(true)
    try {
      await savePreferences(patch)
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if ('shellPath' in patch) setShellError(message)
      if ('scrollback' in patch) setScrollbackError(message)
      if ('terminalGpuAcceleration' in patch) setRenderError(message)
      return false
    } finally {
      persisting.current = false
      setSaving(false)
    }
  }

  function handleOpenCustomShellDialog() {
    shellForm.reset(
      { name: preferences.shellName ?? '', path: preferences.shellPath || '' },
      { keepDefaultValues: true },
    )
    setShellError(undefined)
    setShellDialogOpen(true)
  }

  async function handleSelectScrollback(value: number) {
    await persist({ scrollback: value })
  }

  function handleOpenCustomScrollbackDialog() {
    scrollbackForm.reset({ scrollback: String(preferences.scrollback) })
    setScrollbackError(undefined)
    setScrollbackDialogOpen(true)
  }

  const resolvedShellPath = preferences.shellPath ?? defaultShellPath
  const isCustomScrollback = !PRESET_SCROLLBACKS.some(
    (item) => item.value === preferences.scrollback,
  )
  const scrollbackOptions = [
    ...PRESET_SCROLLBACKS.map((item) => ({ value: String(item.value), label: item.label })),
    ...(isCustomScrollback
      ? [
          {
            value: String(preferences.scrollback),
            label: `${preferences.scrollback.toLocaleString()} 行`,
          },
        ]
      : []),
  ]
  const scrollbackItems = [...scrollbackOptions, { value: '__custom__', label: '自定义行数' }]

  const shellInvalid = !!(defaultShellError || (shellError && !shellDialogOpen))
  const scrollbackInvalid = !!(!scrollbackDialogOpen && scrollbackError)

  return (
    <section
      className="terminal-settings flex flex-col gap-5"
      aria-labelledby="terminal-settings-title"
    >
      <header className="terminal-settings-heading flex flex-col gap-1 border-b pb-4">
        <h1 id="terminal-settings-title" className="terminal-settings-title settings-page-title">
          终端
        </h1>
        <p className="terminal-settings-subtitle text-xs text-muted-foreground">
          配置默认 Shell 环境、历史输出缓冲区、硬件加速与终端外观。
        </p>
      </header>

      {appearance.error && (
        <appearance.form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <Alert
              id="terminal-appearance-save-error"
              className="terminal-appearance-save-error"
              variant="destructive"
            >
              <AlertDescription className="terminal-appearance-save-error-message">
                {appearance.error}
              </AlertDescription>
              <AlertAction className="terminal-appearance-save-action">
                <Button
                  className="terminal-appearance-retry"
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={
                    !ready ||
                    appearance.saving ||
                    !terminalAppearanceSchema.safeParse(values).success
                  }
                  onClick={() => void appearance.saveAppearance(appearance.form.state.values)}
                >
                  重试保存
                </Button>
              </AlertAction>
            </Alert>
          )}
        </appearance.form.Subscribe>
      )}

      <FieldGroup className="terminal-settings-groups gap-6">
        <section
          className="terminal-settings-general flex flex-col gap-2.5"
          aria-labelledby="terminal-settings-general-title"
        >
          <h2
            id="terminal-settings-general-title"
            className="terminal-settings-general-title settings-section-title"
          >
            常规
          </h2>
          <Card size="sm" className="terminal-settings-card gap-0 divide-y divide-border py-0">
            <TerminalSettingRow
              className="terminal-settings-shell-row"
              textClassName="terminal-settings-shell-text"
              labelId="terminal-settings-shell-label"
              label="默认终端 Shell"
              labelClassName="terminal-settings-shell-label"
              descriptionId={resolvedShellPath ? 'terminal-settings-shell-description' : undefined}
              description={
                resolvedShellPath && (
                  <code
                    className="terminal-settings-shell-path block max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                    title={abbreviateHomePath(resolvedShellPath)}
                  >
                    {abbreviateHomePath(resolvedShellPath)}
                  </code>
                )
              }
              descriptionClassName="terminal-settings-shell-description"
              invalid={shellInvalid}
              error={
                <>
                  {defaultShellError && (
                    <p
                      id="terminal-settings-default-shell-error"
                      className="terminal-settings-default-shell-error text-xs text-destructive"
                      role="alert"
                    >
                      无法读取系统默认 Shell：{defaultShellError}
                    </p>
                  )}
                  {shellError && !shellDialogOpen && (
                    <p
                      id="terminal-settings-shell-error"
                      className="terminal-settings-shell-error text-xs text-destructive"
                      role="alert"
                    >
                      {shellError}
                    </p>
                  )}
                </>
              }
            >
              <div className="terminal-settings-shell-control flex min-h-7 flex-wrap items-center gap-2">
                <Select
                  value={preferences.shellPath === null ? 'default' : 'custom'}
                  disabled={!ready || saving}
                  onValueChange={(val) => {
                    if (val === 'custom') {
                      handleOpenCustomShellDialog()
                    } else if (val === 'default') {
                      setShellError(undefined)
                      void persist({ shellName: null, shellPath: null })
                    }
                  }}
                >
                  <SelectTrigger
                    id="terminal-settings-shell"
                    aria-labelledby="terminal-settings-shell-label"
                    aria-busy={saving}
                    aria-invalid={shellInvalid}
                    aria-describedby={
                      [
                        resolvedShellPath && 'terminal-settings-shell-description',
                        defaultShellError && 'terminal-settings-default-shell-error',
                        shellError && !shellDialogOpen && 'terminal-settings-shell-error',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    title={resolvedShellPath ? abbreviateHomePath(resolvedShellPath) : undefined}
                    className="terminal-settings-select-trigger min-w-0 max-w-64"
                  >
                    <SelectValue className="terminal-settings-shell-value min-w-0 truncate">
                      {preferences.shellPath === null
                        ? defaultShellLabel
                        : (preferences.shellName ?? '自定义')}
                    </SelectValue>
                  </SelectTrigger>

                  <SelectContent
                    align="end"
                    className="terminal-settings-menu max-h-[min(16rem,var(--available-height))]"
                  >
                    <SelectGroup className="terminal-settings-shell-group">
                      <SelectItem value="default" className="terminal-settings-menu-item">
                        {defaultShellLabel}
                      </SelectItem>
                      <SelectItem value="custom" className="terminal-settings-menu-item">
                        自定义
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {preferences.shellPath !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    className="terminal-settings-edit-shell"
                    disabled={!ready || saving}
                    onClick={handleOpenCustomShellDialog}
                  >
                    编辑
                  </Button>
                )}
              </div>
            </TerminalSettingRow>

            <TerminalFontFamilyField
              form={appearance.form}
              ready={ready}
              saving={appearance.saving}
            />
          </Card>
        </section>

        <TerminalAppearanceSettings appearance={appearance} ready={ready} />

        <section
          className="terminal-settings-performance flex flex-col gap-2.5"
          aria-labelledby="terminal-settings-performance-title"
        >
          <h2
            id="terminal-settings-performance-title"
            className="terminal-settings-performance-title settings-section-title"
          >
            性能
          </h2>
          <Card
            size="sm"
            className="terminal-settings-performance-card gap-0 divide-y divide-border py-0"
          >
            <TerminalSettingRow
              className="terminal-settings-scrollback-row"
              textClassName="terminal-settings-scrollback-text"
              labelId="terminal-settings-scrollback-label"
              label="滚动缓冲行数"
              labelClassName="terminal-settings-scrollback-label"
              invalid={scrollbackInvalid}
              error={
                scrollbackInvalid && (
                  <p
                    id="terminal-settings-scrollback-save-error"
                    className="terminal-settings-scrollback-save-error text-xs text-destructive"
                    role="alert"
                  >
                    {scrollbackError}
                  </p>
                )
              }
            >
              <Select
                items={scrollbackItems}
                value={String(preferences.scrollback)}
                disabled={!ready || saving}
                onValueChange={(val) => {
                  if (val === '__custom__') {
                    handleOpenCustomScrollbackDialog()
                  } else {
                    void handleSelectScrollback(Number(val))
                  }
                }}
              >
                <SelectTrigger
                  id="terminal-settings-scrollback"
                  aria-labelledby="terminal-settings-scrollback-label"
                  aria-busy={saving}
                  aria-invalid={scrollbackInvalid}
                  aria-describedby={
                    scrollbackInvalid ? 'terminal-settings-scrollback-save-error' : undefined
                  }
                  className="terminal-settings-select-trigger tabular-nums"
                >
                  <SelectValue className="terminal-settings-scrollback-value" />
                </SelectTrigger>

                <SelectContent
                  align="end"
                  className="terminal-settings-menu max-h-[min(16rem,var(--available-height))]"
                >
                  <SelectGroup className="terminal-settings-scrollback-group">
                    {scrollbackOptions.map((item) => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                        className="terminal-settings-menu-item tabular-nums"
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator className="terminal-settings-scrollback-separator" />
                  <SelectGroup className="terminal-settings-custom-scrollback-group">
                    <SelectItem value="__custom__" className="terminal-settings-menu-item">
                      自定义行数
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </TerminalSettingRow>

            <TerminalSettingRow
              className="terminal-gpu-row"
              textClassName="terminal-gpu-text"
              labelId="terminal-gpu-label"
              label="GPU 加速"
              labelClassName="terminal-gpu-label"
              descriptionId="terminal-gpu-description"
              description="WebGL 不可用时自动回退到兼容渲染。"
              descriptionClassName="terminal-gpu-help"
              invalid={!!renderError}
              error={
                renderError && (
                  <p
                    id="terminal-rendering-error"
                    className="terminal-rendering-error text-xs text-destructive"
                    role="alert"
                  >
                    {renderError}
                  </p>
                )
              }
            >
              <ToggleGroup
                id="terminal-gpu"
                aria-labelledby="terminal-gpu-label"
                aria-busy={saving}
                aria-invalid={!!renderError}
                aria-describedby={
                  renderError
                    ? 'terminal-gpu-description terminal-rendering-error'
                    : 'terminal-gpu-description'
                }
                className="terminal-gpu-options shrink-0"
                variant="outline"
                spacing={0}
                disabled={!ready || saving}
                value={[preferences.terminalGpuAcceleration]}
                onValueChange={([value]) => {
                  if (value !== 'auto' && value !== 'on' && value !== 'off') return
                  setRenderError(undefined)
                  void persist({ terminalGpuAcceleration: value })
                }}
              >
                <ToggleGroupItem value="auto" className="terminal-gpu-option">
                  自动
                </ToggleGroupItem>
                <ToggleGroupItem value="on" className="terminal-gpu-option">
                  开启
                </ToggleGroupItem>
                <ToggleGroupItem value="off" className="terminal-gpu-option">
                  关闭
                </ToggleGroupItem>
              </ToggleGroup>
            </TerminalSettingRow>
          </Card>
        </section>
      </FieldGroup>

      <Dialog
        open={shellDialogOpen}
        onOpenChange={(open, details) => {
          if (persisting.current || shellForm.state.isSubmitting) details.cancel()
          else setShellDialogOpen(open)
        }}
      >
        <DialogContent className="terminal-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义 Shell</DialogTitle>
          </DialogHeader>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void shellForm.handleSubmit()
            }}
            className="terminal-settings-shell-form flex flex-col gap-4"
          >
            <FieldGroup>
              <shellForm.Field name="name">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="terminal-settings-shell-name-field"
                      data-invalid={invalid}
                      data-disabled={saving}
                    >
                      <FieldLabel
                        htmlFor="custom-shell-name"
                        className="terminal-settings-shell-name-label"
                      >
                        名称（选填）
                      </FieldLabel>
                      <Input
                        id="custom-shell-name"
                        name={field.name}
                        maxLength={80}
                        value={field.state.value}
                        placeholder="自定义"
                        className="terminal-settings-shell-name-input"
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'custom-shell-name-error' : undefined}
                      />
                      {invalid && (
                        <FieldError id="custom-shell-name-error" errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </shellForm.Field>
              <shellForm.Field name="path">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="terminal-settings-shell-path-field"
                      data-invalid={invalid}
                      data-disabled={saving}
                    >
                      <FieldLabel
                        htmlFor="custom-shell-input"
                        className="terminal-settings-shell-label"
                      >
                        可执行文件绝对路径
                      </FieldLabel>
                      <Input
                        id="custom-shell-input"
                        name={field.name}
                        required
                        maxLength={4096}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        value={field.state.value}
                        placeholder={
                          isWindows
                            ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
                            : '/opt/homebrew/bin/fish'
                        }
                        className="terminal-settings-shell-input font-mono"
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'custom-shell-path-error' : undefined}
                      />
                      {invalid && (
                        <FieldError id="custom-shell-path-error" errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </shellForm.Field>
            </FieldGroup>

            <FieldError className="terminal-settings-shell-error">{shellError}</FieldError>

            <shellForm.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting] as const}
            >
              {([canSubmit, submitting]) => (
                <DialogFooter className="terminal-settings-dialog-footer mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="terminal-settings-shell-cancel"
                    disabled={saving || submitting}
                    onClick={() => setShellDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="terminal-settings-shell-submit"
                    type="submit"
                    disabled={!canSubmit || saving || submitting}
                  >
                    保存
                  </Button>
                </DialogFooter>
              )}
            </shellForm.Subscribe>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scrollbackDialogOpen}
        onOpenChange={(open, details) => {
          if (persisting.current || scrollbackForm.state.isSubmitting) details.cancel()
          else setScrollbackDialogOpen(open)
        }}
      >
        <DialogContent className="terminal-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义滚动缓冲行数</DialogTitle>
          </DialogHeader>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void scrollbackForm.handleSubmit()
            }}
            className="terminal-settings-scrollback-form flex flex-col gap-4"
          >
            <FieldGroup>
              <scrollbackForm.Field name="scrollback">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="terminal-settings-scrollback-field"
                      data-invalid={invalid}
                      data-disabled={saving}
                    >
                      <FieldLabel
                        htmlFor="custom-scrollback-input"
                        className="terminal-settings-scrollback-label"
                      >
                        缓冲行数
                      </FieldLabel>
                      <InputNumber
                        id="custom-scrollback-input"
                        name={field.name}
                        min={1000}
                        max={20000}
                        step={1}
                        required
                        value={field.state.value === '' ? null : Number(field.state.value)}
                        className="terminal-settings-scrollback-input font-mono tabular-nums"
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onValueChange={(value) =>
                          field.handleChange(value === null ? '' : String(value))
                        }
                        inputProps={{
                          placeholder: '5000',
                          'aria-invalid': invalid,
                          'aria-describedby': invalid ? 'custom-scrollback-error' : undefined,
                        }}
                      />
                      {invalid && (
                        <FieldError id="custom-scrollback-error" errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </scrollbackForm.Field>
            </FieldGroup>

            <FieldError className="terminal-settings-scrollback-error">
              {scrollbackError}
            </FieldError>

            <scrollbackForm.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting] as const}
            >
              {([canSubmit, submitting]) => (
                <DialogFooter className="terminal-settings-dialog-footer mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving || submitting}
                    onClick={() => setScrollbackDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="terminal-settings-scrollback-submit"
                    type="submit"
                    disabled={!canSubmit || saving || submitting}
                  >
                    保存
                  </Button>
                </DialogFooter>
              )}
            </scrollbackForm.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
