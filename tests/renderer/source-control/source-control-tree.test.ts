import { describe, expect, it } from 'vitest'
import {
  buildGitChangeTree,
  gitChangeRows,
} from '../../../src/renderer/src/features/source-control/lib/source-control-tree'
import type { GitChange } from '../../../src/shared/source-control'

function changeEntries() {
  const change = (path: string): GitChange => ({
    path,
    area: 'unstaged',
    status: 'M',
    submodule: false,
  })
  const readme = change('README.md')
  const file10 = {
    ...change('src/components/file10.tsx'),
    oldPath: 'old/path.tsx',
    stats: { additions: 2, deletions: 1 },
  }
  const file2 = change('src/components/file2.tsx')
  const state = change('src/lib/state.ts')
  const prototype = change('__proto__/constructor.txt')
  const unicode = change('中文/空 格\t换行\n.txt')
  const backslash = change('back\\slash.txt')
  return {
    readme,
    file10,
    file2,
    state,
    prototype,
    unicode,
    backslash,
    entries: [readme, file10, file2, state, prototype, unicode, backslash],
  }
}

describe('Git change tree', () => {
  it('sorts directories and files naturally while retaining change metadata', () => {
    const { entries, file10, file2, state } = changeEntries()
    const tree = buildGitChangeTree(entries)
    expect(tree.map((node) => node.kind)).toEqual([
      'directory',
      'directory',
      'directory',
      'file',
      'file',
    ])
    const source = tree.find((node) => node.path === 'src')
    if (source?.kind !== 'directory') throw new Error('Missing src directory')
    expect(source.children.map((node) => node.name)).toEqual(['components', 'lib'])
    const components = source.children.find((node) => node.name === 'components')
    if (components?.kind !== 'directory') throw new Error('Missing components directory')
    expect(components.children.map((node) => node.name)).toEqual(['file2.tsx', 'file10.tsx'])
    expect(components.children.find((node) => node.name === 'file10.tsx')).toMatchObject({
      kind: 'file',
      entry: file10,
    })
    expect(source.entries).toEqual([file10, file2, state])
    expect(components.entries).toEqual([file10, file2])
  })

  it('does not include similarly prefixed sibling directories in a directory scope', () => {
    const { entries, readme, file10, file2, state } = changeEntries()
    const sibling = { ...readme, path: 'src-extra/sibling.ts' }
    const scoped = buildGitChangeTree([...entries, sibling]).find((node) => node.path === 'src')
    if (scoped?.kind !== 'directory') throw new Error('Missing scoped src directory')
    expect(scoped.entries).toEqual([file10, file2, state])
  })

  it('preserves prototype-like, Unicode and backslash paths', () => {
    const { entries, prototype, unicode, backslash } = changeEntries()
    const tree = buildGitChangeTree(entries)
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '__proto__',
        children: [expect.objectContaining({ name: 'constructor.txt', entry: prototype })],
      }),
    )
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '中文',
        children: [expect.objectContaining({ name: '空 格\t换行\n.txt', entry: unicode })],
      }),
    )
    expect(tree).toContainEqual(expect.objectContaining({ kind: 'file', entry: backslash }))
  })

  it('retains original change identities without mutating the input', () => {
    const { entries } = changeEntries()
    const original = structuredClone(entries)
    const leaves: GitChange[] = []
    const pending = [...buildGitChangeTree(entries)]
    while (pending.length) {
      const node = pending.pop()!
      if (node.kind === 'directory') {
        expect(node.entries).toEqual(
          entries.filter((entry) => entry.path.startsWith(`${node.path}/`)),
        )
        expect(node.entries.every((entry) => entries.includes(entry))).toBe(true)
        pending.push(...node.children)
      } else leaves.push(node.entry)
    }
    expect(leaves).toHaveLength(entries.length)
    expect(leaves.every((entry) => entries.includes(entry))).toBe(true)
    expect(entries).toEqual(original)
  })

  it('flattens rows and excludes children of collapsed directories', () => {
    const { entries, file2 } = changeEntries()
    const tree = buildGitChangeTree(entries)
    const rows = gitChangeRows(tree, new Set())
    expect(rows.find((row) => row.key === 'file:src/components/file2.tsx')).toMatchObject({
      node: { entry: file2 },
      depth: 2,
      parent: 'directory:src/components',
      position: 1,
      siblings: 2,
    })
    const collapsed = new Set(['src/components'])
    const visible = gitChangeRows(tree, collapsed)
    expect(visible.map((row) => row.node.path)).toEqual(
      rows
        .filter((row) => !row.node.path.startsWith('src/components/'))
        .map((row) => row.node.path),
    )
    expect(visible.find((row) => row.node.path === 'src/lib')?.parent).toBe('directory:src')
    expect(gitChangeRows(tree, new Set(['src'])).map((row) => row.node.path)).not.toContain(
      'src/lib',
    )
    expect(gitChangeRows(tree, new Set())).toEqual(rows)
    expect([...collapsed]).toEqual(['src/components'])
  })

  it('keeps distinct row keys when a file and directory have the same path', () => {
    const { entries, readme } = changeEntries()
    const rows = gitChangeRows(
      buildGitChangeTree([...entries, { ...readme, path: 'src' }]),
      new Set(),
    )
    expect(rows.filter((row) => row.node.path === 'src').map((row) => row.key)).toEqual([
      'directory:src',
      'file:src',
    ])
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it('handles empty and single-file trees', () => {
    const { readme } = changeEntries()
    expect(gitChangeRows([], new Set())).toEqual([])
    expect(buildGitChangeTree([])).toEqual([])
    expect(buildGitChangeTree([readme])).toEqual([
      { kind: 'file', name: 'README.md', path: 'README.md', entry: readme },
    ])
  })

  it('compacts single-child directories while preserving entries and collapsed rows', () => {
    const button = { path: 'src/components/ui/button.tsx' }
    const input = { path: 'src/components/ui/input.tsx' }
    const entries = [
      button,
      input,
      { path: 'packages/app/main.ts' },
      { path: 'packages/README.md' },
      { path: 'README.md' },
    ]
    const original = structuredClone(entries)
    const tree = buildGitChangeTree(entries)
    expect(tree.map((node) => node.name)).toEqual(['packages', 'src/components/ui', 'README.md'])
    const source = tree.find((node) => node.path === 'src/components/ui')
    if (source?.kind !== 'directory') throw new Error('Missing compact src directory')
    expect(source.path).toBe('src/components/ui')
    expect(source.entries).toEqual([button, input])
    expect(source.entries.find((entry) => entry.path === button.path)).toBe(button)
    expect(source.children.map((node) => node.name)).toEqual(['button.tsx', 'input.tsx'])
    expect(gitChangeRows(tree, new Set())).toContainEqual(
      expect.objectContaining({
        key: 'file:src/components/ui/button.tsx',
        node: expect.objectContaining({ entry: button }),
        depth: 1,
        parent: 'directory:src/components/ui',
        position: 1,
        siblings: 2,
      }),
    )
    const collapsed = gitChangeRows(tree, new Set(['src/components/ui']))
    expect(collapsed.map((row) => row.node.path)).toEqual([
      'packages',
      'packages/app',
      'packages/app/main.ts',
      'packages/README.md',
      'src/components/ui',
      'README.md',
    ])
    expect(entries).toEqual(original)
  })
})
