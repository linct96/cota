import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { shellFormSchema, scrollbackFormSchema } from '../lib/form-schemas'
import { isWindows } from '../lib/platform'
import { Check, SquareTerminal } from 'lucide-react'
import { unwrap, type Preferences } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { TerminalAppearanceSettings } from './TerminalAppearanceSettings'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Separator } from './ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './ui/select'

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
  const [saving, setSaving] = useState(false)
  const [savedRecently, setSavedRecently] = useState(false)
  const [renderError, setRenderError] = useState<string>()
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 自定义 Shell 弹窗状态
  const [shellDialogOpen, setShellDialogOpen] = useState(false)
  const [shellError, setShellError] = useState<string>()
  const [defaultShellPath, setDefaultShellPath] = useState<string>()
  const [defaultShellError, setDefaultShellError] = useState<string>()
  const defaultShellLabel = defaultShellPath
    ? `系统默认（${defaultShellPath}）`
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
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

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

  function markSaved() {
    setSavedRecently(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => {
      setSavedRecently(false)
    }, 2000)
  }

  function savePreferences(patch: Partial<Preferences>) {
    // 串行合并最新配置，避免常规设置与外观自动保存互相覆盖。
    const operation = pendingPreferences.current.then(() => {
      const state = useWorkspace.getState()
      return state.savePreferences({ ...state.preferences, ...patch })
    })
    pendingPreferences.current = operation.catch(() => {})
    return operation
  }

  async function persist(patch: Partial<Preferences>) {
    if (persisting.current) return false
    persisting.current = true
    setSaving(true)
    try {
      await savePreferences(patch)
      markSaved()
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

  // 缓冲行数显示名称
  function currentScrollbackLabel(): string {
    return `${preferences.scrollback.toLocaleString()} 行`
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

  return (
    <section
      className="terminal-settings flex flex-col gap-6"
      aria-labelledby="terminal-settings-title"
    >
      <div className="terminal-settings-header flex flex-wrap items-center justify-between gap-3">
        <div className="terminal-settings-heading typeset">
          <h1 id="terminal-settings-title" className="terminal-settings-title">
            终端
          </h1>
        </div>

        <div
          className="terminal-settings-status flex shrink-0 items-center gap-1.5 text-xs select-none"
          aria-live="polite"
        >
          {!saving && savedRecently ? (
            <Badge variant="outline" className="terminal-settings-saved">
              <Check className="terminal-settings-saved-icon" />
              <span className="terminal-settings-saved-label">已保存</span>
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="terminal-settings-groups flex w-full flex-col gap-8">
        <section
          className="terminal-settings-general flex flex-col gap-3"
          aria-labelledby="terminal-settings-general-title"
        >
          <h2
            id="terminal-settings-general-title"
            className="terminal-settings-general-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
          >
            常规
          </h2>
          <Card className="terminal-settings-card" aria-busy={saving}>
            <div className="terminal-settings-shell-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5">
              <div className="terminal-settings-shell-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="terminal-settings-shell-label"
                  className="terminal-settings-shell-label text-sm leading-5 font-medium"
                >
                  默认终端 Shell
                </span>
                <p
                  id="terminal-settings-shell-description"
                  className="terminal-settings-shell-description text-xs text-muted-foreground"
                >
                  新建终端时使用的 Shell。
                </p>
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
              </div>

              <div className="terminal-settings-shell-control flex min-h-8 max-w-full flex-wrap items-center gap-2">
                <Select
                  value={preferences.shellPath === null ? 'default' : 'custom'}
                  disabled={saving}
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
                    aria-describedby="terminal-settings-shell-description terminal-settings-default-shell-error terminal-settings-shell-error"
                    className="terminal-settings-select-trigger min-w-0 max-w-64"
                  >
                    <SquareTerminal className="terminal-settings-shell-icon" />
                    <SelectValue className="terminal-settings-shell-value min-w-0">
                      <span
                        className="terminal-settings-shell-label truncate"
                        title={preferences.shellPath ?? defaultShellPath}
                      >
                        {preferences.shellPath === null
                          ? defaultShellLabel
                          : (preferences.shellName ?? '自定义')}
                      </span>
                    </SelectValue>
                  </SelectTrigger>

                  <SelectContent align="end" className="terminal-settings-menu max-w-sm">
                    <SelectGroup className="terminal-settings-shell-group">
                      <SelectItem value="default" className="terminal-settings-menu-item">
                        <span className="terminal-settings-default-shell-label break-all">
                          {defaultShellLabel}
                        </span>
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
                    disabled={saving}
                    onClick={handleOpenCustomShellDialog}
                  >
                    编辑
                  </Button>
                )}
              </div>
            </div>

            <Separator className="terminal-settings-separator" />

            <div className="terminal-settings-scrollback-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5">
              <div className="terminal-settings-scrollback-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="terminal-settings-scrollback-label"
                  className="terminal-settings-scrollback-label text-sm leading-5 font-medium"
                >
                  滚动缓冲行数
                </span>
                <p
                  id="terminal-settings-scrollback-description"
                  className="terminal-settings-scrollback-description text-xs text-muted-foreground"
                >
                  终端保留的最大历史输出行数（范围 1,000–20,000，减小会丢弃旧输出）
                </p>
                {!scrollbackDialogOpen && scrollbackError && (
                  <p
                    id="terminal-settings-scrollback-save-error"
                    className="terminal-settings-scrollback-save-error text-xs text-destructive"
                    role="alert"
                  >
                    {scrollbackError}
                  </p>
                )}
              </div>

              <Select
                value={String(preferences.scrollback)}
                disabled={saving}
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
                  aria-describedby="terminal-settings-scrollback-description terminal-settings-scrollback-save-error"
                  className="terminal-settings-select-trigger"
                >
                  <SelectValue className="terminal-settings-scrollback-value">
                    {currentScrollbackLabel()}
                  </SelectValue>
                </SelectTrigger>

                <SelectContent align="end" className="terminal-settings-menu w-48">
                  <SelectGroup className="terminal-settings-scrollback-group">
                    {PRESET_SCROLLBACKS.map((item) => (
                      <SelectItem
                        key={item.value}
                        value={String(item.value)}
                        className="terminal-settings-menu-item"
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                    {!PRESET_SCROLLBACKS.some((item) => item.value === preferences.scrollback) && (
                      <SelectItem
                        value={String(preferences.scrollback)}
                        className="terminal-settings-menu-item"
                      >
                        {`${preferences.scrollback.toLocaleString()} 行`}
                      </SelectItem>
                    )}
                  </SelectGroup>
                  <SelectSeparator className="terminal-settings-scrollback-separator" />
                  <SelectGroup className="terminal-settings-custom-scrollback-group">
                    <SelectItem value="__custom__" className="terminal-settings-menu-item">
                      自定义行数
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <Separator className="terminal-settings-separator" />

            <div className="terminal-gpu-row flex min-h-8 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5">
              <div className="terminal-gpu-description flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                <p
                  id="terminal-gpu-label"
                  className="terminal-gpu-label text-sm leading-5 font-medium"
                >
                  GPU 加速
                </p>
                <p
                  id="terminal-gpu-description"
                  className="terminal-gpu-help text-xs text-muted-foreground"
                >
                  WebGL 不可用时回退到兼容渲染。切换即时生效。
                </p>
                {renderError && (
                  <p
                    id="terminal-rendering-error"
                    className="terminal-rendering-error text-xs text-destructive"
                    role="alert"
                  >
                    {renderError}
                  </p>
                )}
              </div>
              <ToggleGroup
                aria-labelledby="terminal-gpu-label"
                aria-describedby="terminal-gpu-description terminal-rendering-error"
                className="terminal-gpu-options shrink-0"
                variant="outline"
                size="lg"
                spacing={0}
                disabled={saving}
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
            </div>
          </Card>
        </section>
        <TerminalAppearanceSettings savePreferences={savePreferences} />
      </div>

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
                    {submitting ? '保存中…' : '保存'}
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
          if (persisting.current) details.cancel()
          else setScrollbackDialogOpen(open)
        }}
      >
        <DialogContent className="terminal-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义滚动缓冲行数</DialogTitle>
            <DialogDescription>
              请输入 1,000 至 20,000 之间的整数（减小会丢弃旧输出）
            </DialogDescription>
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
                      <Input
                        id="custom-scrollback-input"
                        name={field.name}
                        type="number"
                        min={1000}
                        max={20000}
                        step={1}
                        required
                        value={field.state.value}
                        placeholder="5000"
                        className="terminal-settings-scrollback-input font-mono"
                        disabled={saving}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'custom-scrollback-error' : undefined}
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

            <DialogFooter className="terminal-settings-dialog-footer mt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setScrollbackDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                className="terminal-settings-scrollback-submit"
                type="submit"
                disabled={saving}
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
