import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, SquareTerminal } from 'lucide-react'
import type { Preferences } from '../../../shared/contracts'
import { useWorkspace } from '../store'
import { Badge } from './ui/badge'
import { AgentHookSettings } from './AgentHookSettings'
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
import { Field, FieldGroup, FieldLabel } from './ui/field'
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

interface ShellPreset {
  id: string
  label: string
  path: string | null
}

const PRESET_SHELLS: ShellPreset[] = [
  { id: 'default', label: '系统默认 (zsh)', path: null },
  { id: 'zsh', label: 'zsh (/bin/zsh)', path: '/bin/zsh' },
  { id: 'bash', label: 'bash (/bin/bash)', path: '/bin/bash' },
  { id: 'fish', label: 'fish (/opt/homebrew/bin/fish)', path: '/opt/homebrew/bin/fish' },
  { id: 'brew-bash', label: 'bash (/opt/homebrew/bin/bash)', path: '/opt/homebrew/bin/bash' },
]

interface ScrollbackOption {
  value: number
  label: string
}

const PRESET_SCROLLBACKS: ScrollbackOption[] = [
  { value: 1000, label: '1,000 行（轻量）' },
  { value: 5000, label: '5,000 行（默认）' },
  { value: 10000, label: '10,000 行' },
  { value: 20000, label: '20,000 行（最大）' },
]

export function GeneralSettings() {
  const preferences = useWorkspace((state) => state.preferences)
  const [saving, setSaving] = useState(false)
  const [savedRecently, setSavedRecently] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 自定义 Shell 弹窗状态
  const [shellDialogOpen, setShellDialogOpen] = useState(false)
  const [customShellInput, setCustomShellInput] = useState('')
  const [shellError, setShellError] = useState<string>()

  // 自定义缓冲行数弹窗状态
  const [scrollbackDialogOpen, setScrollbackDialogOpen] = useState(false)
  const [customScrollbackInput, setCustomScrollbackInput] = useState('')
  const [scrollbackError, setScrollbackError] = useState<string>()

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
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
    if (saving) return false
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
      return false
    } finally {
      setSaving(false)
    }
  }

  // Shell 显示名称
  function currentShellLabel(): string {
    if (preferences.shellPath === null) return '系统默认 (zsh)'
    const matched = PRESET_SHELLS.find((item) => item.path === preferences.shellPath)
    if (matched) return matched.label
    return preferences.shellPath
  }

  // 缓冲行数显示名称
  function currentScrollbackLabel(): string {
    const matched = PRESET_SCROLLBACKS.find((item) => item.value === preferences.scrollback)
    if (matched) return matched.label
    return `${preferences.scrollback.toLocaleString()} 行`
  }

  async function handleSelectShell(path: string | null) {
    await persist({ shellPath: path })
  }

  function handleOpenCustomShellDialog() {
    setCustomShellInput(preferences.shellPath || '')
    setShellError(undefined)
    setShellDialogOpen(true)
  }

  async function handleCustomShellSubmit(event: React.FormEvent) {
    event.preventDefault()
    setShellError(undefined)
    const trimmed = customShellInput.trim()
    if (!trimmed) {
      setShellError('请输入 Shell 可执行文件路径。')
      return
    }
    if (!trimmed.startsWith('/')) {
      setShellError('Shell 路径需为以 / 开头的绝对路径。')
      return
    }
    const success = await persist({ shellPath: trimmed })
    if (success) {
      setShellDialogOpen(false)
    }
  }

  async function handleSelectScrollback(value: number) {
    await persist({ scrollback: value })
  }

  function handleOpenCustomScrollbackDialog() {
    setCustomScrollbackInput(String(preferences.scrollback))
    setScrollbackError(undefined)
    setScrollbackDialogOpen(true)
  }

  async function handleCustomScrollbackSubmit(event: React.FormEvent) {
    event.preventDefault()
    setScrollbackError(undefined)
    const num = Number(customScrollbackInput)
    if (!Number.isInteger(num) || num < 1000 || num > 20000) {
      setScrollbackError('滚动缓冲行数需为 1,000 至 20,000 之间的整数。')
      return
    }
    const success = await persist({ scrollback: num })
    if (success) {
      setScrollbackDialogOpen(false)
    }
  }

  return (
    <div className="general-settings flex flex-col gap-3">
      {/* 顶部标题与保存状态 */}
      <div className="general-settings-header flex items-center justify-between pb-1">
        <h3 className="general-settings-title text-base font-semibold text-foreground">常规</h3>

        <div
          className="general-settings-status flex shrink-0 items-center gap-1.5 text-xs select-none"
          aria-live="polite"
        >
          {saving ? (
            <Badge
              variant="outline"
              className="gap-1 border-transparent font-normal text-muted-foreground"
            >
              <Loader2 className="size-3 animate-spin" />
              <span>保存中…</span>
            </Badge>
          ) : savedRecently ? (
            <Badge
              variant="outline"
              className="gap-1 border-transparent font-medium text-emerald-600 dark:text-emerald-400"
            >
              <Check className="size-3" />
              <span>已保存</span>
            </Badge>
          ) : null}
        </div>
      </div>

      {/* 分组卡片：完全还原设计稿的大圆角 Inset Card 风格 */}
      <Card className="general-settings-card divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 bg-card py-0 shadow-xs ring-0">
        {/* 设置行 1：终端 Shell */}
        <div className="general-settings-row flex min-h-[4.25rem] items-center justify-between gap-4 px-5 py-4">
          <div className="general-settings-row-text flex min-w-0 flex-col gap-0.5 pr-2">
            <span className="general-settings-row-title text-sm font-medium text-foreground">
              默认终端 Shell
            </span>
            <span className="general-settings-row-desc text-xs text-muted-foreground">
              新建终端时启动的命令行解释器，以交互式登录模式启动（-il）
            </span>
          </div>

          <div className="general-settings-row-control flex shrink-0 items-center">
            <Select
              value={preferences.shellPath ?? '__default__'}
              disabled={saving}
              onValueChange={(val) => {
                if (val === '__custom__') {
                  handleOpenCustomShellDialog()
                } else {
                  void handleSelectShell(val === '__default__' ? null : val)
                }
              }}
            >
              <SelectTrigger className="general-settings-select-trigger h-8 max-w-64 gap-2 rounded-lg px-3 text-xs font-normal">
                <SquareTerminal className="size-3.5 text-muted-foreground" />
                <SelectValue>{currentShellLabel()}</SelectValue>
              </SelectTrigger>

              <SelectContent align="end" className="general-settings-menu w-60">
                <SelectGroup className="general-settings-shell-group">
                  {PRESET_SHELLS.map((shell) => (
                    <SelectItem
                      key={shell.id}
                      value={shell.path ?? '__default__'}
                      className="general-settings-menu-item"
                    >
                      {shell.label}
                    </SelectItem>
                  ))}
                  {preferences.shellPath !== null &&
                    !PRESET_SHELLS.some((item) => item.path === preferences.shellPath) && (
                      <SelectItem
                        value={preferences.shellPath}
                        className="general-settings-menu-item"
                      >
                        {preferences.shellPath}
                      </SelectItem>
                    )}
                </SelectGroup>
                <SelectSeparator />
                <SelectItem value="__custom__" className="general-settings-menu-item">
                  自定义路径…
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 设置行 2：滚动缓冲行数 */}
        <div className="general-settings-row flex min-h-[4.25rem] items-center justify-between gap-4 px-5 py-4">
          <div className="general-settings-row-text flex min-w-0 flex-col gap-0.5 pr-2">
            <span className="general-settings-row-title text-sm font-medium text-foreground">
              滚动缓冲行数
            </span>
            <span className="general-settings-row-desc text-xs text-muted-foreground">
              终端保留的最大历史输出行数（范围 1,000–20,000，减小会丢弃旧输出）
            </span>
          </div>

          <div className="general-settings-row-control flex shrink-0 items-center">
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
              <SelectTrigger className="general-settings-select-trigger h-8 gap-2 rounded-lg px-3 text-xs font-normal">
                <SelectValue>{currentScrollbackLabel()}</SelectValue>
              </SelectTrigger>

              <SelectContent align="end" className="general-settings-menu w-48">
                <SelectGroup className="general-settings-scrollback-group">
                  {PRESET_SCROLLBACKS.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={String(item.value)}
                      className="general-settings-menu-item"
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                  {!PRESET_SCROLLBACKS.some((item) => item.value === preferences.scrollback) && (
                    <SelectItem
                      value={String(preferences.scrollback)}
                      className="general-settings-menu-item"
                    >
                      {`${preferences.scrollback.toLocaleString()} 行`}
                    </SelectItem>
                  )}
                </SelectGroup>
                <SelectSeparator />
                <SelectItem value="__custom__" className="general-settings-menu-item">
                  自定义行数…
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <AgentHookSettings />
      </Card>

      {/* 自定义 Shell 弹窗 */}
      <Dialog open={shellDialogOpen} onOpenChange={setShellDialogOpen}>
        <DialogContent className="general-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义 Shell 路径</DialogTitle>
            <DialogDescription>输入本机可执行文件的绝对路径（如 /bin/zsh）</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => void handleCustomShellSubmit(event)}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="custom-shell-input" className="text-xs">
                  可执行文件绝对路径
                </FieldLabel>
                <Input
                  id="custom-shell-input"
                  required
                  maxLength={4096}
                  value={customShellInput}
                  placeholder="/opt/homebrew/bin/fish"
                  className="font-mono text-xs"
                  onChange={(event) => setCustomShellInput(event.target.value)}
                />
              </Field>
            </FieldGroup>

            {shellError && (
              <p role="alert" className="text-xs text-destructive">
                {shellError}
              </p>
            )}

            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setShellDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 自定义缓冲行数弹窗 */}
      <Dialog open={scrollbackDialogOpen} onOpenChange={setScrollbackDialogOpen}>
        <DialogContent className="general-settings-dialog max-w-sm">
          <DialogHeader>
            <DialogTitle>自定义滚动缓冲行数</DialogTitle>
            <DialogDescription>
              请输入 1,000 至 20,000 之间的整数（减小会丢弃旧输出）
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => void handleCustomScrollbackSubmit(event)}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="custom-scrollback-input" className="text-xs">
                  缓冲行数
                </FieldLabel>
                <Input
                  id="custom-scrollback-input"
                  type="number"
                  min={1000}
                  max={20000}
                  step={1}
                  required
                  value={customScrollbackInput}
                  placeholder="5000"
                  className="font-mono text-xs"
                  onChange={(event) => setCustomScrollbackInput(event.target.value)}
                />
              </Field>
            </FieldGroup>

            {scrollbackError && (
              <p role="alert" className="text-xs text-destructive">
                {scrollbackError}
              </p>
            )}

            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setScrollbackDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
