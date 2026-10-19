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

export function validateHierarchy(nodes: readonly ParentReference[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Hierarchy contains duplicate identities')
  const complete = new Set<string>()
  for (const node of nodes) {
    const chain = new Set<string>()
    let current: ParentReference | undefined = node
    while (current && !complete.has(current.id)) {
      if (chain.has(current.id)) throw new Error('Hierarchy contains a cycle')
      chain.add(current.id)
      if (current.parentId && !byId.has(current.parentId)) throw new Error(`Unknown parent ${current.parentId}`)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    for (const id of chain) complete.add(id)
  }
}
