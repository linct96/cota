import { useState } from 'react'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export function Settings() {
  const preferences = useWorkspace((state) => state.preferences)
  const [customShell, setCustomShell] = useState(preferences.shellPath !== null)
  const [shellPath, setShellPath] = useState(preferences.shellPath || '')
  const [scrollback, setScrollback] = useState(String(preferences.scrollback))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) useWorkspace.setState({ settingsOpen: false })
      }}
    >
      <DialogContent
        className="settings-dialog"
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault()
        }}
      >
        <DialogHeader className="settings-header">
          <DialogTitle className="settings-title">设置</DialogTitle>
          <DialogDescription className="settings-description">
            设置仅保存在本机。Shell 变更只影响新建的终端。
          </DialogDescription>
        </DialogHeader>
        <form
          className="settings-form flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (saving) return
            setSaving(true)
            setError(undefined)
            try {
              await useWorkspace.getState().savePreferences({
                shellPath: customShell ? shellPath.trim() : null,
                scrollback: Number(scrollback),
              })
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
              setSaving(false)
            }
          }}
        >
          <fieldset disabled={saving} className="settings-shell-group flex flex-col gap-3">
            <legend className="settings-shell-legend mb-3 font-medium">Shell</legend>
            <label className="settings-radio-label flex items-center gap-2">
              <input
                type="radio"
                name="shell"
                className="settings-radio-input"
                checked={!customShell}
                onChange={() => setCustomShell(false)}
              />
              系统默认（SHELL，回退 zsh）
            </label>
            <label className="settings-radio-label flex items-center gap-2">
              <input
                type="radio"
                name="shell"
                className="settings-radio-input"
                checked={customShell}
                onChange={() => setCustomShell(true)}
              />
              自定义可执行文件
            </label>
            <label htmlFor="shell-path" className="settings-shell-path-label sr-only">
              Shell 绝对路径
            </label>
            <Input
              id="shell-path"
              className="settings-shell-path-input"
              value={shellPath}
              onChange={(event) => setShellPath(event.target.value)}
              placeholder="/opt/homebrew/bin/fish"
              disabled={!customShell}
              required={customShell}
            />
            <p className="settings-shell-hint text-xs text-muted-foreground">
              仅填写绝对路径，不接受命令参数。所有 Shell 均以交互式登录模式启动（-il）。
            </p>
          </fieldset>
          <div className="settings-scrollback-group flex flex-col gap-2">
            <label htmlFor="scrollback" className="settings-scrollback-label font-medium">
              终端滚动缓冲行数
            </label>
            <Input
              id="scrollback"
              className="settings-scrollback-input"
              type="number"
              min={1000}
              max={20000}
              step={1}
              required
              disabled={saving}
              value={scrollback}
              onChange={(event) => setScrollback(event.target.value)}
            />
            <p className="settings-scrollback-hint text-xs text-muted-foreground">
              范围 1,000–20,000，默认 5,000；减小会丢弃超出范围的旧输出。
            </p>
          </div>
          {error && (
            <p role="alert" className="settings-error-alert text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="settings-actions">
            <Button
              type="button"
              variant="outline"
              className="settings-cancel-button"
              disabled={saving}
              onClick={() => useWorkspace.setState({ settingsOpen: false })}
            >
              取消
            </Button>
            <Button type="submit" className="settings-submit-button" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
