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

export function gitChangeRows<T extends { path: string }>(
  nodes: GitChangeNode<T>[],
  collapsed: ReadonlySet<string>,
) {
  const rows: {
    key: string
    node: GitChangeNode<T>
    depth: number
    parent?: string
    position: number
    siblings: number
  }[] = []
  function visit(children: GitChangeNode<T>[], depth: number, parent?: string) {
    children.forEach((node, index) => {
      const key = `${node.kind}:${node.path}`
      rows.push({ key, node, depth, parent, position: index + 1, siblings: children.length })
      if (node.kind === 'directory' && !collapsed.has(node.path)) {
        visit(node.children, depth + 1, key)
      }
    })
  }
  visit(nodes, 0)
  return rows
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
  function compact(node: GitChangeNode<T>): GitChangeNode<T> {
    if (node.kind === 'file') return node
    let directory = node
    let name = node.name
    while (directory.children.length === 1 && directory.children[0].kind === 'directory') {
      directory = directory.children[0]
      name += `/${directory.name}`
    }
    return { ...directory, name, children: directory.children.map(compact) }
  }
  return root.map(compact)
}
