import { useRef, useState } from 'react'
import { useWorkspace } from '@/state/workspace'
import type { Preferences } from '../../../../../shared/contracts'
import { FileTypeIcon } from '@/features/files/components/FileTypeIcon'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const iconThemes = [
  { value: 'default', label: '默认' },
  { value: 'material', label: 'Material Icon Theme' },
] as const

const previewItems = [
  { path: 'src', label: 'src', directory: true, open: true },
  { path: 'src/components', label: 'components', directory: true, open: false },
  { path: 'src/components/Button.tsx', label: 'Button.tsx' },
  { path: 'src/App.tsx', label: 'App.tsx' },
  { path: 'src/styles.css', label: 'styles.css' },
  { path: 'package.json', label: 'package.json' },
  { path: 'README.md', label: 'README.md' },
  { path: 'unknown.xyz', label: 'unknown.xyz' },
] as const

const ruleFields = [
  {
    key: 'showIgnored',
    classPrefix: 'file-explorer-ignored',
    id: 'file-explorer-show-ignored',
    labelId: 'file-explorer-show-ignored-label',
    helpId: 'file-explorer-ignored-help',
    label: '显示 Git 忽略的文件',
    description: '显示被 .gitignore 排除的文件，并以弱化样式标识。',
  },
  {
    key: 'followSymlinks',
    classPrefix: 'file-explorer-symlink',
    id: 'file-explorer-follow-symlinks',
    labelId: 'file-explorer-follow-symlinks-label',
    helpId: 'file-explorer-symlink-help',
    label: '跟随符号链接目录',
    description: '仅允许展开指向当前工作区内的符号链接目录。',
  },
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
      className="file-explorer-settings flex flex-col gap-5"
      aria-labelledby="file-explorer-settings-title"
    >
      <header className="file-explorer-settings-heading flex flex-col gap-1 border-b pb-4">
        <h1
          id="file-explorer-settings-title"
          className="file-explorer-settings-title settings-page-title"
        >
          文件浏览器
        </h1>
        <p className="file-explorer-settings-subtitle text-xs text-muted-foreground">
          控制工作区文件树的过滤规则、符号链接展开行为与文件图标主题。
        </p>
      </header>
      {error && (
        <Alert
          id="file-explorer-settings-error"
          className="file-explorer-settings-error"
          variant="destructive"
        >
          <AlertDescription className="file-explorer-settings-error-message">
            {error}
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup className="file-explorer-settings-groups gap-6">
        <section
          className="file-explorer-settings-group flex flex-col gap-2.5"
          aria-labelledby="file-explorer-settings-group-title"
        >
          <h2
            id="file-explorer-settings-group-title"
            className="file-explorer-settings-group-title settings-section-title"
          >
            浏览规则
          </h2>
          <Card size="sm" className="file-explorer-settings-card gap-0 divide-y divide-border py-0">
            {ruleFields.map(({ key, classPrefix, id, labelId, helpId, label, description }) => (
              <div
                key={key}
                className={`${classPrefix}-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3`}
              >
                <div
                  className={`${classPrefix}-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5`}
                >
                  <span
                    id={labelId}
                    className={`${classPrefix}-label text-xs leading-5 font-medium text-foreground`}
                  >
                    {label}
                  </span>
                  <p
                    id={helpId}
                    className={`${classPrefix}-description text-xs text-muted-foreground`}
                  >
                    {description}
                  </p>
                </div>
                <Switch
                  id={id}
                  aria-labelledby={labelId}
                  className={`${classPrefix}-switch`}
                  checked={options[key]}
                  disabled={!ready || saving}
                  aria-busy={saving}
                  aria-describedby={error ? `${helpId} file-explorer-settings-error` : helpId}
                  onCheckedChange={(checked) =>
                    void update({ fileExplorer: { ...options, [key]: checked } })
                  }
                />
              </div>
            ))}
          </Card>
        </section>
        <section
          className="file-explorer-appearance-group flex flex-col gap-2.5"
          aria-labelledby="file-explorer-appearance-title"
        >
          <h2
            id="file-explorer-appearance-title"
            className="file-explorer-appearance-title settings-section-title"
          >
            图标
          </h2>
          <Card
            size="sm"
            className="file-explorer-appearance-card gap-0 divide-y divide-border py-0"
          >
            <div className="file-icon-theme-row flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <div className="file-icon-theme-text flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5">
                <span
                  id="file-icon-theme-label"
                  className="file-icon-theme-label text-xs leading-5 font-medium text-foreground"
                >
                  文件图标主题
                </span>
                <p
                  id="file-icon-theme-help"
                  className="file-icon-theme-description text-xs text-muted-foreground"
                >
                  统一设置文件浏览器、Git 变更与文件预览中的文件和文件夹图标。
                </p>
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
                  id="file-icon-theme"
                  className="file-icon-theme-select min-w-0 max-w-full"
                  aria-labelledby="file-icon-theme-label"
                  aria-busy={saving}
                  aria-describedby={
                    error
                      ? 'file-icon-theme-help file-explorer-settings-error'
                      : 'file-icon-theme-help'
                  }
                >
                  <SelectValue className="file-icon-theme-value min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent className="file-icon-theme-options max-h-[min(16rem,var(--available-height))]">
                  <SelectGroup className="file-icon-theme-options-group">
                    {iconThemes.map(({ value, label }) => (
                      <SelectItem className="file-icon-theme-option" key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <ul
              className="file-icon-theme-preview grid grid-cols-2 gap-x-4 gap-y-2 bg-muted/25 px-4 py-3 sm:grid-cols-4"
              aria-label="文件图标主题预览"
            >
              {previewItems.map((item) => (
                <li
                  key={item.path}
                  className="file-icon-theme-preview-item flex min-w-0 items-center gap-2 text-xs"
                >
                  <FileTypeIcon
                    path={item.path}
                    directory={'directory' in item ? item.directory : false}
                    open={'open' in item ? item.open : false}
                  />
                  <span className="file-explorer-entry-name min-w-0 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </FieldGroup>
    </section>
  )
}
