import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import type { FileExplorerPreferences } from '../../../shared/contracts'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Switch } from './ui/switch'

export function FileExplorerSettings() {
  const options = useWorkspace((state) => state.preferences.fileExplorer)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  async function update(patch: Partial<FileExplorerPreferences>) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    try {
      const preferences = useWorkspace.getState().preferences
      await useWorkspace.getState().savePreferences({
        ...preferences,
        fileExplorer: { ...preferences.fileExplorer, ...patch },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <section
      className="file-explorer-settings flex flex-col gap-6"
      aria-labelledby="file-explorer-settings-title"
    >
      <h3
        id="file-explorer-settings-title"
        className="file-explorer-settings-title text-base font-semibold"
      >
        文件浏览器
      </h3>
      <FieldGroup className="file-explorer-settings-fields">
        <Field className="file-explorer-ignored-field" disabled={!ready || saving}>
          <div className="file-explorer-ignored-control flex items-center justify-between gap-4">
            <FieldLabel
              htmlFor="file-explorer-show-ignored"
              className="file-explorer-ignored-label"
            >
              显示 Git 忽略的文件
            </FieldLabel>
            <Switch
              id="file-explorer-show-ignored"
              className="file-explorer-ignored-switch"
              checked={options.showIgnored}
              aria-describedby="file-explorer-ignored-help"
              onCheckedChange={(checked) => void update({ showIgnored: checked })}
            />
          </div>
          <FieldDescription
            id="file-explorer-ignored-help"
            className="file-explorer-ignored-description"
          >
            显示被 .gitignore 等 Git 忽略规则排除的文件与目录，并以弱化颜色标识。
          </FieldDescription>
        </Field>
        <Field className="file-explorer-symlink-field" disabled={!ready || saving}>
          <div className="file-explorer-symlink-control flex items-center justify-between gap-4">
            <FieldLabel
              htmlFor="file-explorer-follow-symlinks"
              className="file-explorer-symlink-label"
            >
              跟随符号链接目录
            </FieldLabel>
            <Switch
              id="file-explorer-follow-symlinks"
              className="file-explorer-symlink-switch"
              checked={options.followSymlinks}
              aria-describedby="file-explorer-symlink-help"
              onCheckedChange={(checked) => void update({ followSymlinks: checked })}
            />
          </div>
          <FieldDescription
            id="file-explorer-symlink-help"
            className="file-explorer-symlink-description"
          >
            允许展开指向当前工作区内部的符号链接目录；循环链接和工作区外部目录仍不可展开。
          </FieldDescription>
        </Field>
        <FieldError className="file-explorer-settings-error">{error}</FieldError>
      </FieldGroup>
    </section>
  )
}
