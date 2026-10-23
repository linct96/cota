export type TerminalPane =
  | { type: 'terminal'; id: string }
  | {
      type: 'split'
      id: string
      direction: 'horizontal' | 'vertical'
      ratio: number
      children: [TerminalPane, TerminalPane]
    }

export interface TerminalLayout {
  id: string
  root: TerminalPane
  activePaneId: string
}

export function terminalPaneIds(node: TerminalPane): string[] {
  return node.type === 'terminal' ? [node.id] : node.children.flatMap(terminalPaneIds)
}

export function mapTerminalPane(
  node: TerminalPane,
  id: string,
  update: (node: TerminalPane) => TerminalPane,
): TerminalPane {
  if (node.id === id) return update(node)
  if (node.type === 'terminal') return node
  return {
    ...node,
    children: [
      mapTerminalPane(node.children[0], id, update),
      mapTerminalPane(node.children[1], id, update),
    ],
  }
}

export function pruneTerminalPane(node: TerminalPane, ids: Set<string>): TerminalPane | undefined {
  if (node.type === 'terminal') return ids.has(node.id) ? node : undefined
  const left = pruneTerminalPane(node.children[0], ids)
  const right = pruneTerminalPane(node.children[1], ids)
  return left && right ? { ...node, children: [left, right] } : left || right
}

export function removeTerminalPanes(layouts: TerminalLayout[], ids: Set<string>): TerminalLayout[] {
  return pruneTerminalLayouts(
    layouts,
    new Set(layouts.flatMap((group) => terminalPaneIds(group.root)).filter((id) => !ids.has(id))),
  )
}

export function pruneTerminalLayouts(
  layouts: TerminalLayout[],
  ids: Set<string>,
): TerminalLayout[] {
  return layouts.flatMap((group) => {
    const root = pruneTerminalPane(group.root, ids)
    if (!root) return []
    return [
      {
        ...group,
        root,
        activePaneId: terminalPaneIds(root).includes(group.activePaneId)
          ? group.activePaneId
          : terminalPaneIds(root)[0],
      },
    ]
  })
}
