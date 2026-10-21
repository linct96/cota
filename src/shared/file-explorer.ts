export interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'link' | 'other'
  ignored?: boolean
}

export type FilePreview =
  | { kind: 'text'; content: string }
  | { kind: 'link'; target: string }
  | { kind: 'unavailable'; reason: string }

export type FileAction = 'copy-relative' | 'copy-absolute' | 'reveal'
export type FileWatchEvent =
  | { kind: 'ready' }
  | { kind: 'change'; paths: string[] }
  | { kind: 'unavailable'; error: string }

export function fileParent(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}
