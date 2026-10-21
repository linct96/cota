import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { shellFormSchema, scrollbackFormSchema } from '../lib/form-schemas'
import { isWindows } from '../lib/platform'
import { Check, SquareTerminal } from 'lucide-react'
import { unwrap, type Preferences } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
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
  const shellForm = useForm({
    defaultValues: { name: '', path: '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
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

  async function persist(patch: Partial<Preferences>) {
    if (persisting.current) return false
    persisting.current = true
    setSaving(true)
    try {
      await useWorkspace.getState().savePreferences({
        ...useWorkspace.getState().preferences,
        ...patch,
      })
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
    shellForm.reset({ name: preferences.shellName ?? '', path: preferences.shellPath || '' })
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
    <div className="terminal-settings flex flex-col gap-3">
      <div className="terminal-settings-header flex items-center justify-between pb-1">
        <h3 className="terminal-settings-title text-base font-semibold text-foreground">终端</h3>

        <div
          className="terminal-settings-status flex shrink-0 items-center gap-1.5 text-xs select-none"
          aria-live="polite"
        >
          {!saving && savedRecently ? (
            <Badge
              variant="outline"
              className="terminal-settings-saved gap-1 border-transparent font-medium text-emerald-600 dark:text-emerald-400"
            >
              <Check className="terminal-settings-saved-icon size-3" />
              <span className="terminal-settings-saved-label">已保存</span>
            </Badge>
          ) : null}
        </div>
      </div>

      <Card className="terminal-settings-card divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 bg-card py-0 shadow-xs ring-0">
        <div className="terminal-settings-row flex min-h-[4.25rem] items-center justify-between gap-4 px-5 py-4">
          <div className="terminal-settings-row-text flex min-w-0 flex-col gap-0.5 pr-2">
            <span className="terminal-settings-row-title text-sm font-medium text-foreground">
              默认终端 Shell
            </span>
            <span className="terminal-settings-row-desc text-xs text-muted-foreground">
              新建终端时启动的命令行解释器，以交互式登录模式启动（-il）
            </span>
          </div>

          <div className="terminal-settings-row-control flex shrink-0 items-center gap-2">
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
                aria-label="默认终端 Shell"
                className="terminal-settings-select-trigger h-8 max-w-64 gap-2 rounded-lg px-3 text-xs font-normal"
              >
                <SquareTerminal className="terminal-settings-shell-icon size-3.5 text-muted-foreground" />
                <SelectValue className="terminal-settings-shell-value truncate">
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
                size="sm"
                className="terminal-settings-edit-shell"
                disabled={saving}
                onClick={handleOpenCustomShellDialog}
              >
                编辑
              </Button>
            )}
          </div>
        </div>

        <div className="terminal-settings-row flex min-h-[4.25rem] items-center justify-between gap-4 px-5 py-4">
          <div className="terminal-settings-row-text flex min-w-0 flex-col gap-0.5 pr-2">
            <span className="terminal-settings-row-title text-sm font-medium text-foreground">
              滚动缓冲行数
            </span>
            <span className="terminal-settings-row-desc text-xs text-muted-foreground">
              终端保留的最大历史输出行数（范围 1,000–20,000，减小会丢弃旧输出）
            </span>
          </div>

          <div className="terminal-settings-row-control flex shrink-0 items-center">
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
              <SelectTrigger className="terminal-settings-select-trigger h-8 gap-2 rounded-lg px-3 text-xs font-normal">
                <SelectValue>{currentScrollbackLabel()}</SelectValue>
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
                <SelectSeparator />
                <SelectGroup className="terminal-settings-custom-scrollback-group">
                  <SelectItem value="__custom__" className="terminal-settings-menu-item">
                    自定义行数…
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <section
        aria-labelledby="terminal-rendering-title"
        className="terminal-rendering-settings mt-3 flex flex-col gap-3"
      >
        <h4
          id="terminal-rendering-title"
          className="terminal-rendering-title text-sm font-semibold"
        >
          渲染
        </h4>
        <Card className="terminal-rendering-card overflow-hidden rounded-2xl border border-border/80 bg-card py-0 shadow-xs ring-0">
          <Field className="terminal-gpu-field flex-row flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="terminal-gpu-description flex min-w-0 flex-1 flex-col gap-0.5">
              <FieldLabel id="terminal-gpu-label" className="terminal-gpu-label">
                GPU 加速
              </FieldLabel>
              <FieldDescription id="terminal-gpu-description" className="terminal-gpu-help text-xs">
                WebGL不可用时回退到兼容渲染。切换即时生效。
              </FieldDescription>
            </div>
            <ToggleGroup
              aria-labelledby="terminal-gpu-label"
              aria-describedby="terminal-gpu-description"
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
          </Field>
        </Card>
        {renderError && (
          <p role="alert" className="terminal-rendering-error text-xs text-destructive">
            {renderError}
          </p>
        )}
      </section>

      {defaultShellError && (
        <p role="alert" className="terminal-settings-default-shell-error text-xs text-destructive">
          无法读取系统默认 Shell：{defaultShellError}
        </p>
      )}
      {shellError && !shellDialogOpen && (
        <p role="alert" className="terminal-settings-shell-error text-xs text-destructive">
          {shellError}
        </p>
      )}

      <Dialog
        open={shellDialogOpen}
        onOpenChange={(open, details) => {
          if (persisting.current) details.cancel()
          else setShellDialogOpen(open)
        }}
      >
        <DialogContent className="terminal-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义 Shell</DialogTitle>
            <DialogDescription>名称仅用于显示，终端将使用指定路径启动。</DialogDescription>
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

            {shellError && (
              <p role="alert" className="terminal-settings-shell-error text-xs text-destructive">
                {shellError}
              </p>
            )}

            <DialogFooter className="terminal-settings-dialog-footer mt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setShellDialogOpen(false)}
              >
                取消
              </Button>
              <Button className="terminal-settings-shell-submit" type="submit" disabled={saving}>
                保存
              </Button>
            </DialogFooter>
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

            {scrollbackError && (
              <p
                role="alert"
                className="terminal-settings-scrollback-error text-xs text-destructive"
              >
                {scrollbackError}
              </p>
            )}

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
    </div>
  )
}
