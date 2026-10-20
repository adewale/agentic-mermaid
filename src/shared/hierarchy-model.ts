import { assertDiagramWorkLimit } from './diagram-limits.ts'

/** Authored tree references shared by Treemap and Ishikawa, without placement policy. */
export interface ParentReference {
  id: string
  parentId?: string
}

export function hierarchyChildren<T extends ParentReference>(nodes: readonly T[]): Map<string | undefined, T[]> {
  const children = new Map<string | undefined, T[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  return children
}

export function hierarchyDescendants(nodes: readonly ParentReference[], root: string): Set<string> {
  const children = hierarchyChildren(nodes)
  const result = new Set<string>()
  const pending = [root]
  while (pending.length) {
    const id = pending.pop()!
    if (result.has(id)) throw new Error('Hierarchy contains a cycle')
    result.add(id)
    for (const child of children.get(id) ?? []) pending.push(child.id)
  }
  return result
}

export function validateHierarchy<T extends ParentReference>(nodes: readonly T[], isContainer?: (node: T) => boolean): void {
  assertDiagramWorkLimit('nodes', nodes.length)
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Hierarchy contains duplicate identities')
  const parents = new Set(nodes.map(node => node.parentId))
  const depths = new Map<string, number>()
  for (const node of nodes) {
    const chain = new Set<string>()
    const container = isContainer?.(node) ?? parents.has(node.id)
    let current: T | undefined = node
    while (current && !depths.has(current.id)) {
      if (chain.has(current.id)) throw new Error('Hierarchy contains a cycle')
      chain.add(current.id)
      // A path longer than the budget cannot become valid after its ancestors
      // are resolved. Check while walking, before allocating an unbounded chain.
      assertDiagramWorkLimit('nesting', chain.size - (container ? 0 : 1))
      if (current.parentId && !byId.has(current.parentId)) throw new Error(`Unknown parent ${current.parentId}`)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    let depth = current ? depths.get(current.id)! : 0
    for (const id of [...chain].reverse()) {
      const item = byId.get(id)!
      depth += (isContainer?.(item) ?? parents.has(id)) ? 1 : 0
      assertDiagramWorkLimit('nesting', depth)
      depths.set(id, depth)
    }
  }
}
