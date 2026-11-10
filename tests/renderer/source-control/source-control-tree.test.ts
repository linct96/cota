import { describe, expect, it } from 'vitest'
import {
  buildGitChangeTree,
  gitChangeRows,
} from '../../../src/renderer/src/features/source-control/lib/source-control-tree'
import type { GitChange } from '../../../src/shared/source-control'

describe('Git change tree', () => {
  it('builds sorted Git directory trees without changing file identity or paths', () => {
    const entries: GitChange[] = [
      'README.md',
      'src/components/file10.tsx',
      'src/components/file2.tsx',
      'src/lib/state.ts',
      '__proto__/constructor.txt',
      '中文/空 格\t换行\n.txt',
      'back\\slash.txt',
    ].map((path) => ({ path, area: 'unstaged', status: 'M', submodule: false }))
    entries[1].oldPath = 'old/path.tsx'
    entries[1].stats = { additions: 2, deletions: 1 }
    const original = structuredClone(entries)
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
    const components = source.children[0]
    if (components.kind !== 'directory') throw new Error('Missing components directory')
    expect(components.children.map((node) => node.name)).toEqual(['file2.tsx', 'file10.tsx'])
    expect(components.children[1]).toMatchObject({ kind: 'file', entry: entries[1] })
    expect(source.entries).toEqual(entries.slice(1, 4))
    expect(components.entries).toEqual(entries.slice(1, 3))
    const sibling = { ...entries[0], path: 'src-extra/sibling.ts' }
    const scoped = buildGitChangeTree([...entries, sibling]).find((node) => node.path === 'src')
    if (scoped?.kind !== 'directory') throw new Error('Missing scoped src directory')
    expect(scoped.entries).toEqual(entries.slice(1, 4))
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '__proto__',
        children: [
          expect.objectContaining({
            name: 'constructor.txt',
            entry: entries[4],
          }),
        ],
      }),
    )
    expect(tree).toContainEqual(
      expect.objectContaining({
        kind: 'directory',
        path: '中文',
        children: [
          expect.objectContaining({
            name: '空 格\t换行\n.txt',
            entry: entries[5],
          }),
        ],
      }),
    )
    const leaves: GitChange[] = []
    const pending = [...tree]
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
    const rows = gitChangeRows(tree, new Set())
    expect(rows.find((row) => row.key === 'file:src/components/file2.tsx')).toMatchObject({
      node: { entry: entries[2] },
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
    // 文件替换为目录时，Git 可在同组同时返回删除的文件和新增的子文件。
    const replacement = gitChangeRows(
      buildGitChangeTree([...entries, { ...entries[0], path: 'src' }]),
      new Set(),
    )
    expect(replacement.filter((row) => row.node.path === 'src').map((row) => row.key)).toEqual([
      'directory:src',
      'file:src',
    ])
    expect(new Set(replacement.map((row) => row.key)).size).toBe(replacement.length)
    expect(gitChangeRows([], new Set())).toEqual([])
    expect(entries).toEqual(original)
    expect(buildGitChangeTree([])).toEqual([])
    expect(buildGitChangeTree([entries[0]])).toEqual([
      { kind: 'file', name: 'README.md', path: 'README.md', entry: entries[0] },
    ])

    const compactEntries = [
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
      'packages/app/main.ts',
      'packages/README.md',
      'README.md',
    ].map((path) => ({ path }))
    const compactOriginal = structuredClone(compactEntries)
    const compactTree = buildGitChangeTree(compactEntries)
    expect(compactTree.map((node) => node.name)).toEqual([
      'packages',
      'src/components/ui',
      'README.md',
    ])
    const compactSource = compactTree[1]
    if (compactSource.kind !== 'directory') throw new Error('Missing compact src directory')
    expect(compactSource.path).toBe('src/components/ui')
    expect(compactSource.entries).toEqual(compactEntries.slice(0, 2))
    expect(compactSource.entries[0]).toBe(compactEntries[0])
    expect(compactSource.children.map((node) => node.name)).toEqual(['button.tsx', 'input.tsx'])
    expect(gitChangeRows(compactTree, new Set())).toContainEqual(
      expect.objectContaining({
        key: 'file:src/components/ui/button.tsx',
        node: expect.objectContaining({ entry: compactEntries[0] }),
        depth: 1,
        parent: 'directory:src/components/ui',
        position: 1,
        siblings: 2,
      }),
    )
    const compactCollapsed = gitChangeRows(compactTree, new Set(['src/components/ui']))
    expect(compactCollapsed.map((row) => row.node.path)).toEqual([
      'packages',
      'packages/app',
      'packages/app/main.ts',
      'packages/README.md',
      'src/components/ui',
      'README.md',
    ])
    expect(compactEntries).toEqual(compactOriginal)
  })
})
