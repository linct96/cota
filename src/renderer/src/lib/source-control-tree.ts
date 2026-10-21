import type { GitChange } from '../../../shared/source-control'

export type GitChangeNode<T extends { path: string } = GitChange> =
  | { kind: 'file'; name: string; path: string; entry: T }
  | {
      kind: 'directory'
      name: string
      path: string
      children: GitChangeNode<T>[]
      entries: T[]
    }

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildGitChangeTree<T extends { path: string }>(
  entries: readonly T[],
): GitChangeNode<T>[] {
  const root: GitChangeNode<T>[] = []
  const directories = new Map<string, Extract<GitChangeNode<T>, { kind: 'directory' }>>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    const name = parts.pop()!
    let children = root
    let path = ''
    for (const segment of parts) {
      path = path ? `${path}/${segment}` : segment
      let directory = directories.get(path)
      if (!directory) {
        directory = { kind: 'directory', name: segment, path, children: [], entries: [] }
        directories.set(path, directory)
        children.push(directory)
      }
      directory.entries.push(entry)
      children = directory.children
    }
    children.push({ kind: 'file', name, path: entry.path, entry })
  }
  for (const children of [root, ...Array.from(directories.values(), (node) => node.children)]) {
    children.sort((a, b) =>
      a.kind === b.kind
        ? names.compare(a.name, b.name) || a.name.localeCompare(b.name)
        : a.kind === 'directory'
          ? -1
          : 1,
    )
  }
  return root
}
