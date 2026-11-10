import {
  Braces,
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileMusic,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderGit2,
  FolderOpen,
  KeyRound,
  Package,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  siCss3,
  siDocker,
  siGit,
  siGo,
  siHtml5,
  siJavascript,
  siMarkdown,
  siNpm,
  siPnpm,
  siPython,
  siReact,
  siRust,
  siTypescript,
  siVuedotjs,
} from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'
import { fileIconKind } from '@/features/files/lib/file-icon'
import type { FileIconKind } from '@/features/files/lib/file-icon'
import { useWorkspace } from '@/state/workspace'

const icons: Record<FileIconKind, SimpleIcon | LucideIcon> = {
  javascript: siJavascript,
  typescript: siTypescript,
  declaration: FileCode2,
  react: siReact,
  vue: siVuedotjs,
  html: siHtml5,
  css: siCss3,
  python: siPython,
  go: siGo,
  rust: siRust,
  code: FileCode2,
  json: Braces,
  config: FileCog,
  env: KeyRound,
  git: siGit,
  docker: siDocker,
  npm: siNpm,
  pnpm: siPnpm,
  package: Package,
  shell: FileTerminal,
  markdown: siMarkdown,
  text: FileText,
  image: FileImage,
  audio: FileMusic,
  video: FileVideo,
  font: FileType,
  archive: FileArchive,
  file: File,
  submodule: FolderGit2,
}

export function FileTypeIcon({
  path,
  submodule = false,
  directory = false,
  open = false,
}: {
  path: string
  submodule?: boolean
  directory?: boolean
  open?: boolean
}) {
  const theme = useWorkspace((state) => state.preferences.fileIconTheme)
  if (directory) {
    const Glyph = open ? FolderOpen : Folder
    return (
      <Glyph
        className="file-type-icon file-type-folder-icon size-3.5 shrink-0"
        data-theme={theme}
        aria-hidden="true"
        focusable="false"
      />
    )
  }
  // shortcut: Material 资源接入前统一使用通用图标，接入后替换此主题分支。
  const kind = theme === 'material' ? 'file' : fileIconKind(path, submodule)
  const icon = icons[kind]
  if ('path' in icon) {
    return (
      <svg
        className="file-type-icon size-3.5 shrink-0"
        data-kind={kind}
        data-theme={theme}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path className="file-type-icon-path" d={icon.path} />
      </svg>
    )
  }
  const Glyph = icon
  return (
    <Glyph
      className="file-type-icon size-3.5 shrink-0"
      data-kind={kind}
      data-theme={theme}
      aria-hidden="true"
      focusable="false"
    />
  )
}
