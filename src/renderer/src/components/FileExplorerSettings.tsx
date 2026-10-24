import { useRef, useState } from 'react'
import { useWorkspace } from '../store'
import type { Preferences } from '../../../shared/contracts'
import { FileTypeIcon } from './FileTypeIcon'
import { Card, CardContent } from './ui/card'
import { Field, FieldDescription, FieldError, FieldGroup } from './ui/field'
import { FileTree, FileTreeFile, FileTreeFolder, FileTreeIcon, FileTreeName } from './ui/file-tree'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Separator } from './ui/separator'
import { Switch } from './ui/switch'

const iconThemes = [
  { value: 'default', label: '默认' },
  { value: 'material', label: 'Material Icon Theme（占位）' },
] as const

export function FileExplorerSettings() {
  const options = useWorkspace((state) => state.preferences.fileExplorer)
  const iconTheme = useWorkspace((state) => state.preferences.fileIconTheme)
  const ready = useWorkspace((state) => state.ready)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  async function update(patch: Partial<Pick<Preferences, 'fileExplorer' | 'fileIconTheme'>>) {
    if (pending.current || !useWorkspace.getState().ready) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    try {
      const preferences = useWorkspace.getState().preferences
      await useWorkspace.getState().savePreferences({
        ...preferences,
        ...patch,
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
              className="file-explorer-ignored-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              disabled={!ready || saving}
              data-disabled={!ready || saving}
              aria-busy={saving}
            >
              <div className="file-explorer-ignored-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="file-explorer-show-ignored-label"
                  className="file-explorer-ignored-label text-sm leading-5 font-medium"
                >
                  显示 Git 忽略的文件
                </span>
                <p
                  id="file-explorer-ignored-help"
                  className="file-explorer-ignored-description text-xs text-muted-foreground"
                >
                  显示被 .gitignore 等 Git 忽略规则排除的文件与目录，并以弱化颜色标识。
                </p>
              </div>
              <Switch
                id="file-explorer-show-ignored"
                aria-labelledby="file-explorer-show-ignored-label"
                className="file-explorer-ignored-switch my-2"
                checked={options.showIgnored}
                disabled={!ready || saving}
                aria-describedby="file-explorer-ignored-help"
                onCheckedChange={(checked) =>
                  void update({ fileExplorer: { ...options, showIgnored: checked } })
                }
              />
            </Field>
            <Separator className="file-explorer-settings-separator" />
            <Field
              className="file-explorer-symlink-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
              disabled={!ready || saving}
              data-disabled={!ready || saving}
              aria-busy={saving}
            >
              <div className="file-explorer-symlink-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="file-explorer-follow-symlinks-label"
                  className="file-explorer-symlink-label text-sm leading-5 font-medium"
                >
                  跟随符号链接目录
                </span>
                <p
                  id="file-explorer-symlink-help"
                  className="file-explorer-symlink-description text-xs text-muted-foreground"
                >
                  允许展开指向当前工作区内部的符号链接目录；循环链接和工作区外部目录仍不可展开。
                </p>
              </div>
              <Switch
                id="file-explorer-follow-symlinks"
                aria-labelledby="file-explorer-follow-symlinks-label"
                className="file-explorer-symlink-switch my-2"
                checked={options.followSymlinks}
                disabled={!ready || saving}
                aria-describedby="file-explorer-symlink-help"
                onCheckedChange={(checked) =>
                  void update({ fileExplorer: { ...options, followSymlinks: checked } })
                }
              />
            </Field>
          </Card>
        </section>
        <section
          className="file-explorer-appearance-group flex flex-col gap-3"
          aria-labelledby="file-explorer-appearance-title"
        >
          <h4
            id="file-explorer-appearance-title"
            className="file-explorer-appearance-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
          >
            外观
          </h4>
          <Card className="file-explorer-appearance-card">
            <CardContent className="file-explorer-appearance-content flex flex-col gap-4">
              <Field
                className="file-icon-theme-field flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2"
                disabled={!ready || saving}
                data-disabled={!ready || saving}
                aria-busy={saving}
              >
                <div className="file-icon-theme-text flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                  <span
                    id="file-icon-theme-label"
                    className="file-icon-theme-label text-sm leading-5 font-medium"
                  >
                    文件图标主题
                  </span>
                  <FieldDescription
                    id="file-icon-theme-help"
                    className="file-icon-theme-description"
                  >
                    统一设置文件浏览器、Git 变更与文件预览中的文件和文件夹图标。
                  </FieldDescription>
                </div>
                <Select
                  items={iconThemes}
                  value={iconTheme}
                  disabled={!ready || saving}
                  onValueChange={(value) => {
                    if (value && value !== iconTheme) void update({ fileIconTheme: value })
                  }}
                >
                  <SelectTrigger
                    className="file-icon-theme-select max-w-full"
                    aria-labelledby="file-icon-theme-label"
                    aria-describedby="file-icon-theme-help file-icon-theme-placeholder file-explorer-settings-error"
                  >
                    <SelectValue className="file-icon-theme-value" />
                  </SelectTrigger>
                  <SelectContent className="file-icon-theme-options" align="end">
                    <SelectGroup className="file-icon-theme-options-group">
                      {iconThemes.map(({ value, label }) => (
                        <SelectItem className="file-icon-theme-option" key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <p
                id="file-icon-theme-placeholder"
                className="file-icon-theme-placeholder text-xs text-muted-foreground"
              >
                Material Icon Theme 暂未接入图标资源，当前使用通用文件和文件夹图标占位。
              </p>
            </CardContent>
            <Separator className="file-icon-theme-preview-separator" />
            <CardContent className="file-icon-theme-preview-content flex flex-col gap-2">
              <p
                id="file-icon-theme-preview-label"
                className="file-icon-theme-preview-label text-xs text-muted-foreground"
              >
                预览
              </p>
              <FileTree
                className="file-icon-theme-preview"
                aria-labelledby="file-icon-theme-preview-label"
              >
                <FileTreeFolder
                  path="src"
                  name="src"
                  defaultOpen
                  icon={(open) => <FileTypeIcon path="src" directory open={open} />}
                >
                  <FileTreeFolder
                    path="src/components"
                    name="components"
                    icon={(open) => <FileTypeIcon path="src/components" directory open={open} />}
                  >
                    <FileTreeFile
                      path="src/components/Button.tsx"
                      className="file-icon-theme-preview-file"
                    >
                      <FileTreeIcon>
                        <FileTypeIcon path="src/components/Button.tsx" />
                      </FileTreeIcon>
                      <FileTreeName className="file-explorer-entry-name">Button.tsx</FileTreeName>
                    </FileTreeFile>
                  </FileTreeFolder>
                  {['App.tsx', 'styles.css'].map((name) => (
                    <FileTreeFile
                      key={name}
                      path={`src/${name}`}
                      className="file-icon-theme-preview-file"
                    >
                      <FileTreeIcon>
                        <FileTypeIcon path={`src/${name}`} />
                      </FileTreeIcon>
                      <FileTreeName className="file-explorer-entry-name">{name}</FileTreeName>
                    </FileTreeFile>
                  ))}
                </FileTreeFolder>
                {['package.json', 'README.md', 'unknown.xyz'].map((name) => (
                  <FileTreeFile key={name} path={name} className="file-icon-theme-preview-file">
                    <FileTreeIcon>
                      <FileTypeIcon path={name} />
                    </FileTreeIcon>
                    <FileTreeName className="file-explorer-entry-name">{name}</FileTreeName>
                  </FileTreeFile>
                ))}
              </FileTree>
            </CardContent>
          </Card>
        </section>
        <FieldError id="file-explorer-settings-error" className="file-explorer-settings-error">
          {error}
        </FieldError>
      </FieldGroup>
    </section>
  )
}
