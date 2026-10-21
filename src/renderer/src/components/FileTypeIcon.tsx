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
  FolderGit2,
  KeyRound,
  Package,
  type LucideIcon,
} from 'lucide-react'
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
  type SimpleIcon,
} from 'simple-icons'
import { fileIconKind, type FileIconKind } from '../lib/file-icon'

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

export function FileTypeIcon({ path, submodule = false }: { path: string; submodule?: boolean }) {
  const kind = fileIconKind(path, submodule)
  const icon = icons[kind]
  if ('path' in icon) {
    return (
      <svg
        className="file-type-icon"
        data-kind={kind}
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
  return <Glyph className="file-type-icon" data-kind={kind} aria-hidden="true" focusable="false" />
}
