import { hierarchyChildren, validateHierarchy } from '../shared/hierarchy-model.ts'
import type { TreeviewNode } from './types.ts'

/** Shared authored traversal; each renderer owns its own units and geometry. */
export function treeviewRows(nodes: readonly TreeviewNode[]) {
  validateHierarchy(nodes)
  const children = hierarchyChildren(nodes)
  const rows: { node: TreeviewNode; depth: number; ancestorsContinue: boolean[]; last: boolean }[] = []
  const pending = [...(children.get(undefined) ?? [])].reverse().map((node, index) => ({ node, depth: 0, ancestorsContinue: [] as boolean[], last: index === 0 }))
  while (pending.length) {
    const row = pending.pop()!
    rows.push(row)
    const inner = children.get(row.node.id) ?? []
    for (let index = inner.length - 1; index >= 0; index--) pending.push({ node: inner[index]!, depth: row.depth + 1, ancestorsContinue: row.depth ? [...row.ancestorsContinue, !row.last] : [], last: index === inner.length - 1 })
  }
  return rows
}

export function treeviewIconLabel(icon: string | undefined, nodeType: 'file' | 'directory', showIcons = false): string | undefined {
  if (icon === 'none' || icon === '') return undefined
  if (icon === 'folder' || icon === 'directory' || (icon === undefined && showIcons && nodeType === 'directory')) return '▱'
  if (icon === 'file' || (icon === undefined && showIcons)) return '▤'
  return icon ? `[${icon}]` : undefined
}
