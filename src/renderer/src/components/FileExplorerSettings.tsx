import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import type { FileExplorerPreferences } from '../../../shared/contracts'
import { Card } from './ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Separator } from './ui/separator'
import { Switch } from './ui/switch'

export function FileExplorerSettings() {
  const options = useWorkspace((state) => state.preferences.fileExplorer)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  async function update(patch: Partial<FileExplorerPreferences>) {
    if (pending.current || !useWorkspace.getState().ready) return
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
      <div className="file-explorer-settings-heading typeset">
        <h1 id="file-explorer-settings-title" className="file-explorer-settings-title">
          文件浏览器
        </h1>
      </div>
      <FieldGroup className="file-explorer-settings-groups gap-8">
        <section
          className="file-explorer-settings-group flex flex-col gap-3"
          aria-labelledby="file-explorer-settings-group-title"
        >
          <div className="file-explorer-settings-group-header flex flex-wrap items-start justify-between gap-3">
            <h4
              id="file-explorer-settings-group-title"
              className="file-explorer-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
            >
              常规
            </h4>
          </div>
          <Card className="file-explorer-settings-card">
            <Field
              className="file-explorer-ignored-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
              disabled={!ready}
              data-disabled={!ready}
              aria-busy={saving}
            >
              <div className="file-explorer-ignored-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <FieldLabel
                  htmlFor="file-explorer-show-ignored"
                  className="file-explorer-ignored-label min-h-8 text-sm leading-5"
                >
                  显示 Git 忽略的文件
                </FieldLabel>
                <FieldDescription
                  id="file-explorer-ignored-help"
                  className="file-explorer-ignored-description"
                >
                  显示被 .gitignore 等 Git 忽略规则排除的文件与目录，并以弱化颜色标识。
                </FieldDescription>
              </div>
              <div className="file-explorer-ignored-control flex min-h-8 items-center">
                <Switch
                  id="file-explorer-show-ignored"
                  className="file-explorer-ignored-switch"
                  checked={options.showIgnored}
                  disabled={!ready}
                  aria-describedby="file-explorer-ignored-help"
                  onCheckedChange={(checked) => void update({ showIgnored: checked })}
                />
              </div>
            </Field>
            <Separator className="file-explorer-settings-separator" />
            <Field
              className="file-explorer-symlink-field flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5"
              disabled={!ready}
              data-disabled={!ready}
              aria-busy={saving}
            >
              <div className="file-explorer-symlink-text flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <FieldLabel
                  htmlFor="file-explorer-follow-symlinks"
                  className="file-explorer-symlink-label min-h-8 text-sm leading-5"
                >
                  跟随符号链接目录
                </FieldLabel>
                <FieldDescription
                  id="file-explorer-symlink-help"
                  className="file-explorer-symlink-description"
                >
                  允许展开指向当前工作区内部的符号链接目录；循环链接和工作区外部目录仍不可展开。
                </FieldDescription>
              </div>
              <div className="file-explorer-symlink-control flex min-h-8 items-center">
                <Switch
                  id="file-explorer-follow-symlinks"
                  className="file-explorer-symlink-switch"
                  checked={options.followSymlinks}
                  disabled={!ready}
                  aria-describedby="file-explorer-symlink-help"
                  onCheckedChange={(checked) => void update({ followSymlinks: checked })}
                />
              </div>
            </Field>
          </Card>
          <FieldError className="file-explorer-settings-error">{error}</FieldError>
        </section>
      </FieldGroup>
    </section>
  )
}
